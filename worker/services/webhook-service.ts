import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import {
  webhookEndpoints,
  webhookLogs,
  type WebhookEndpointRow,
  type NewWebhookEndpointRow,
  type NewWebhookLogRow,
} from "../db";

export const WEBHOOK_EVENTS = [
  "partner.created",
  "partner.approved",
  "customer.created",
  "commission.created",
  "commission.approved",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "click.recorded",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: string;
  timestamp: string; // ISO
  data: Record<string, unknown>;
}

const MAX_RESPONSE_BODY_LENGTH = 2000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class WebhookService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getEndpointsByProjectId(projectId: string): Promise<WebhookEndpointRow[]> {
    return this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.projectId, projectId))
      .orderBy(desc(webhookEndpoints.createdAt));
  }

  async getEndpointById(id: string): Promise<WebhookEndpointRow | null> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createEndpoint(data: {
    projectId: string;
    url: string;
    events: string[];
  }): Promise<WebhookEndpointRow> {
    const id = crypto.randomUUID();
    const secret = this.generateSecret();
    const row: NewWebhookEndpointRow = {
      id,
      projectId: data.projectId,
      url: data.url,
      secret,
      events: JSON.stringify(data.events),
      isActive: true,
    };
    await this.db.insert(webhookEndpoints).values(row);
    return (await this.getEndpointById(id))!;
  }

  async updateEndpoint(
    id: string,
    updates: { url?: string; events?: string[]; isActive?: boolean },
  ): Promise<WebhookEndpointRow | null> {
    const set: Partial<NewWebhookEndpointRow> = {};
    if (updates.url !== undefined) set.url = updates.url;
    if (updates.events !== undefined) set.events = JSON.stringify(updates.events);
    if (updates.isActive !== undefined) set.isActive = updates.isActive;
    if (Object.keys(set).length === 0) return this.getEndpointById(id);
    await this.db.update(webhookEndpoints).set(set).where(eq(webhookEndpoints.id, id));
    return this.getEndpointById(id);
  }

  async deleteEndpoint(id: string): Promise<boolean> {
    const r = await this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    return (r as { changes?: number }).changes !== undefined
      ? (r as unknown as { changes: number }).changes > 0
      : true;
  }

  async getLogsByEndpointId(
    endpointId: string,
    limit = 50,
  ): Promise<{ id: string; event: string; statusCode: number | null; attempt: number; createdAt: Date; payload: string; responseBody: string | null }[]> {
    const rows = await this.db
      .select()
      .from(webhookLogs)
      .where(eq(webhookLogs.endpointId, endpointId))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      statusCode: r.statusCode,
      attempt: r.attempt,
      createdAt: r.createdAt,
      payload: r.payload,
      responseBody: r.responseBody,
    }));
  }

  /** Fire an event to all active endpoints subscribed to it. */
  async fireEvent(
    projectId: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
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
    const payloadStr = JSON.stringify(payload);

    await Promise.allSettled(
      endpoints.map(async (ep) => {
        try {
          const events = JSON.parse(ep.events) as string[];
          if (!events.includes(event)) return;
          await this.deliverWithRetry(ep, payloadStr);
        } catch (err) {
          console.error(`Webhook fireEvent endpoint ${ep.id}:`, err);
        }
      }),
    );
  }

  private async deliverWithRetry(
    endpoint: WebhookEndpointRow,
    payloadStr: string,
  ): Promise<void> {
    const signature = await hmacSha256Hex(endpoint.secret, payloadStr);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `sha256=${signature}`,
          },
          body: payloadStr,
        });

        const bodyText = await res.text();
        const responseBody =
          bodyText.length > MAX_RESPONSE_BODY_LENGTH
            ? bodyText.slice(0, MAX_RESPONSE_BODY_LENGTH) + "..."
            : bodyText;

        await this.logDelivery({
          endpointId: endpoint.id,
          event: (JSON.parse(payloadStr) as WebhookPayload).event,
          payload: payloadStr,
          statusCode: res.status,
          responseBody,
          attempt,
        });

        if (res.ok) return;
      } catch (err) {
        await this.logDelivery({
          endpointId: endpoint.id,
          event: JSON.parse(payloadStr).event,
          payload: payloadStr,
          statusCode: null,
          responseBody: err instanceof Error ? err.message : String(err),
          attempt,
        });
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
      }
    }
  }

  private async logDelivery(params: {
    endpointId: string;
    event: string;
    payload: string;
    statusCode: number | null;
    responseBody: string | null;
    attempt: number;
  }): Promise<void> {
    const row: NewWebhookLogRow = {
      id: crypto.randomUUID(),
      endpointId: params.endpointId,
      event: params.event,
      payload: params.payload,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
      attempt: params.attempt,
    };
    await this.db.insert(webhookLogs).values(row);
  }

  async sendTestWebhook(endpointId: string): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
    const endpoint = await this.getEndpointById(endpointId);
    if (!endpoint) return { ok: false, error: "Endpoint not found" };

    const payload: WebhookPayload = {
      event: "partner.created",
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: "This is a test webhook from UnlockAffiliate",
      },
    };
    const payloadStr = JSON.stringify(payload);
    const signature = await hmacSha256Hex(endpoint.secret, payloadStr);

    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
        },
        body: payloadStr,
      });

      const bodyText = await res.text();
      const responseBody =
        bodyText.length > MAX_RESPONSE_BODY_LENGTH
          ? bodyText.slice(0, MAX_RESPONSE_BODY_LENGTH) + "..."
          : bodyText;

      await this.logDelivery({
        endpointId,
        event: "partner.created",
        payload: payloadStr,
        statusCode: res.status,
        responseBody,
        attempt: 1,
      });

      return { ok: res.ok, statusCode: res.status };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.logDelivery({
        endpointId,
        event: "partner.created",
        payload: payloadStr,
        statusCode: null,
        responseBody: error,
        attempt: 1,
      });
      return { ok: false, error };
    }
  }

  private generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
