import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import {
  webhookEndpoints,
  webhookLogs,
  type WebhookEndpointRow,
  type NewWebhookEndpointRow,
  type NewWebhookLogRow,
  type WebhookLogRow,
} from "../db";

export type WebhookEvent =
  | "partner.created"
  | "partner.approved"
  | "customer.created"
  | "commission.created"
  | "commission.approved"
  | "payout.created"
  | "click.recorded";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get all webhook endpoints for a project.
   */
  async getEndpointsByProjectId(
    projectId: string,
  ): Promise<WebhookEndpointRow[]> {
    return this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.projectId, projectId))
      .orderBy(desc(webhookEndpoints.createdAt));
  }

  /**
   * Get a single webhook endpoint by ID.
   */
  async getEndpointById(id: string): Promise<WebhookEndpointRow | null> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Create a new webhook endpoint.
   */
  async createEndpoint(
    data: Omit<NewWebhookEndpointRow, "id" | "createdAt" | "secret">,
  ): Promise<WebhookEndpointRow> {
    const id = crypto.randomUUID();
    const secret = this.generateSecret();
    const row: NewWebhookEndpointRow = {
      id,
      secret,
      ...data,
    };
    await this.db.insert(webhookEndpoints).values(row);
    return (await this.getEndpointById(id))!;
  }

  /**
   * Update a webhook endpoint.
   */
  async updateEndpoint(
    id: string,
    updates: Partial<
      Pick<WebhookEndpointRow, "url" | "events" | "isActive">
    >,
  ): Promise<WebhookEndpointRow | null> {
    await this.db
      .update(webhookEndpoints)
      .set(updates)
      .where(eq(webhookEndpoints.id, id));
    return this.getEndpointById(id);
  }

  /**
   * Delete a webhook endpoint.
   */
  async deleteEndpoint(id: string): Promise<boolean> {
    const endpoint = await this.getEndpointById(id);
    if (!endpoint) return false;
    await this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    return true;
  }

  /**
   * Get webhook delivery logs for an endpoint.
   */
  async getLogsByEndpointId(
    endpointId: string,
    limit = 100,
  ): Promise<WebhookLogRow[]> {
    return this.db
      .select()
      .from(webhookLogs)
      .where(eq(webhookLogs.endpointId, endpointId))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit);
  }

  /**
   * Fire a webhook event to all active endpoints that subscribe to it.
   * Uses exponential backoff retry (3 attempts max).
   */
  async fireEvent(
    projectId: string,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Get all active endpoints for this project that subscribe to this event
    const endpoints = await this.db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.projectId, projectId),
          eq(webhookEndpoints.isActive, true),
        ),
      );

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Fire webhooks in parallel (non-blocking)
    const promises = endpoints.map(async (endpoint) => {
      try {
        const events = JSON.parse(endpoint.events) as string[];
        if (!events.includes(event)) return;

        // Fire with retry logic
        await this.deliverWithRetry(endpoint, payload);
      } catch (error) {
        console.error(`Failed to parse events for endpoint ${endpoint.id}:`, error);
      }
    });

    // Don't await - fire and forget
    void Promise.allSettled(promises);
  }

  /**
   * Deliver webhook with exponential backoff retry (3 attempts).
   */
  private async deliverWithRetry(
    endpoint: WebhookEndpointRow,
    payload: WebhookPayload,
  ): Promise<void> {
    const maxAttempts = 3;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      try {
        const signature = await this.generateSignature(
          JSON.stringify(payload),
          endpoint.secret,
        );

        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": payload.event,
          },
          body: JSON.stringify(payload),
        });

        const responseBody = await response.text();
        const truncatedBody =
          responseBody.length > 1000
            ? responseBody.slice(0, 1000) + "..."
            : responseBody;

        // Log the delivery attempt
        await this.logDelivery({
          endpointId: endpoint.id,
          event: payload.event,
          payload: JSON.stringify(payload),
          statusCode: response.status,
          responseBody: truncatedBody,
          attempt,
        });

        // Success (2xx status)
        if (response.status >= 200 && response.status < 300) {
          return;
        }

        // If not successful and not last attempt, retry with exponential backoff
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        // Log the error
        await this.logDelivery({
          endpointId: endpoint.id,
          event: payload.event,
          payload: JSON.stringify(payload),
          statusCode: null,
          responseBody: error instanceof Error ? error.message : String(error),
          attempt,
        });

        // If not last attempt, retry with exponential backoff
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      attempt++;
    }
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload verification.
   */
  private async generateSignature(
    payload: string,
    secret: string,
  ): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const payloadData = encoder.encode(payload);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, payloadData);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Log a webhook delivery attempt.
   */
  private async logDelivery(data: {
    endpointId: string;
    event: string;
    payload: string;
    statusCode: number | null;
    responseBody: string;
    attempt: number;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const log: NewWebhookLogRow = {
      id,
      endpointId: data.endpointId,
      event: data.event,
      payload: data.payload,
      statusCode: data.statusCode,
      responseBody: data.responseBody,
      attempt: data.attempt,
    };
    await this.db.insert(webhookLogs).values(log);
  }

  /**
   * Generate a random secret for webhook signature verification.
   */
  private generateSecret(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Send a test webhook to an endpoint.
   */
  async sendTestWebhook(endpointId: string): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
  }> {
    const endpoint = await this.getEndpointById(endpointId);
    if (!endpoint) {
      return { success: false, error: "Endpoint not found" };
    }

    const testPayload: WebhookPayload = {
      event: "partner.created",
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: "This is a test webhook from UnlockAffiliate",
      },
    };

    try {
      const signature = await this.generateSignature(
        JSON.stringify(testPayload),
        endpoint.secret,
      );

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": testPayload.event,
        },
        body: JSON.stringify(testPayload),
      });

      const responseBody = await response.text();
      const truncatedBody =
        responseBody.length > 1000
          ? responseBody.slice(0, 1000) + "..."
          : responseBody;

      await this.logDelivery({
        endpointId: endpoint.id,
        event: testPayload.event,
        payload: JSON.stringify(testPayload),
        statusCode: response.status,
        responseBody: truncatedBody,
        attempt: 1,
      });

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
      };
    } catch (error) {
      await this.logDelivery({
        endpointId: endpoint.id,
        event: testPayload.event,
        payload: JSON.stringify(testPayload),
        statusCode: null,
        responseBody: error instanceof Error ? error.message : String(error),
        attempt: 1,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
