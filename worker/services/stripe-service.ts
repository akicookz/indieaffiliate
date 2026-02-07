import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { stripeConnections, type StripeConnectionRow } from "../db";

export class StripeService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private encryptionKey: string,
    private salt: string,
  ) {}

  /**
   * Validate a restricted Stripe API key by confirming access to
   * customers, subscriptions, and charges.
   */
  async validateStripeKey(apiKey: string): Promise<boolean> {
    try {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const endpoints = [
        "https://api.stripe.com/v1/customers?limit=1",
        "https://api.stripe.com/v1/subscriptions?limit=1",
        "https://api.stripe.com/v1/charges?limit=1",
        "https://api.stripe.com/v1/invoices?limit=1",
      ];
      const results = await Promise.all(
        endpoints.map((url) => fetch(url, { headers })),
      );
      return results.every((r) => r.ok);
    } catch {
      return false;
    }
  }

  /**
   * Save or update a Stripe connection for a project.
   */
  async saveConnection(
    projectId: string,
    apiKey: string,
  ): Promise<StripeConnectionRow> {
    const encrypted = await encrypt(apiKey, this.encryptionKey, this.salt);

    // Check if connection already exists
    const existing = await this.getConnection(projectId);
    if (existing) {
      await this.db
        .update(stripeConnections)
        .set({
          encryptedApiKey: encrypted,
          syncStatus: "idle",
          syncError: null,
        })
        .where(eq(stripeConnections.projectId, projectId));
      return (await this.getConnection(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(stripeConnections).values({
      id,
      projectId,
      encryptedApiKey: encrypted,
    });
    return (await this.getConnection(projectId))!;
  }

  /**
   * Get a Stripe connection for a project (metadata only, no decrypted key).
   */
  async getConnection(projectId: string): Promise<StripeConnectionRow | null> {
    const rows = await this.db
      .select()
      .from(stripeConnections)
      .where(eq(stripeConnections.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get the decrypted Stripe API key for a project.
   */
  async getDecryptedKey(projectId: string): Promise<string | null> {
    const conn = await this.getConnection(projectId);
    if (!conn) return null;
    return decrypt(conn.encryptedApiKey, this.encryptionKey, this.salt);
  }

  /**
   * Remove a Stripe connection.
   */
  async removeConnection(projectId: string): Promise<boolean> {
    const conn = await this.getConnection(projectId);
    if (!conn) return false;
    await this.db
      .delete(stripeConnections)
      .where(eq(stripeConnections.projectId, projectId));
    return true;
  }

  /**
   * Update sync status for a connection.
   */
  async updateSyncStatus(
    projectId: string,
    status: "idle" | "syncing" | "error",
    error?: string,
    lastSyncAt?: Date,
  ): Promise<void> {
    const updates: Partial<StripeConnectionRow> = {
      syncStatus: status,
      syncError: error ?? null,
    };
    if (lastSyncAt) {
      updates.lastSyncAt = lastSyncAt;
    }
    await this.db
      .update(stripeConnections)
      .set(updates)
      .where(eq(stripeConnections.projectId, projectId));
  }

  /**
   * Get all connections (for cron sync).
   */
  async getAllConnections(): Promise<StripeConnectionRow[]> {
    return this.db.select().from(stripeConnections);
  }

  /**
   * Get metadata mappings for a project's Stripe connection.
   */
  async getMetadataMappings(projectId: string): Promise<MetadataMappings> {
    const conn = await this.getConnection(projectId);
    if (!conn?.metadataMappings) {
      return DEFAULT_METADATA_MAPPINGS;
    }
    try {
      return {
        ...DEFAULT_METADATA_MAPPINGS,
        ...JSON.parse(conn.metadataMappings),
      };
    } catch {
      return DEFAULT_METADATA_MAPPINGS;
    }
  }

  /**
   * Persist the last sync summary JSON on the stripe connection.
   */
  async updateLastSyncSummary(
    projectId: string,
    summary: object,
  ): Promise<void> {
    await this.db
      .update(stripeConnections)
      .set({ lastSyncSummary: JSON.stringify(summary) })
      .where(eq(stripeConnections.projectId, projectId));
  }

  /**
   * Get the persisted last sync summary for a project.
   */
  async getLastSyncSummary(projectId: string): Promise<object | null> {
    const conn = await this.getConnection(projectId);
    if (!conn?.lastSyncSummary) return null;
    try {
      return JSON.parse(conn.lastSyncSummary);
    } catch {
      return null;
    }
  }

  /**
   * Update metadata mappings for a project's Stripe connection.
   */
  async updateMetadataMappings(
    projectId: string,
    mappings: MetadataMappings,
  ): Promise<void> {
    await this.db
      .update(stripeConnections)
      .set({ metadataMappings: JSON.stringify(mappings) })
      .where(eq(stripeConnections.projectId, projectId));
  }
}

// ─── Metadata Mappings Types ─────────────────────────────────────────────────

export interface MetadataMappings {
  referralCodeKeys: string[];
  source: "charge_metadata" | "subscription_metadata" | "both";
}

export const DEFAULT_METADATA_MAPPINGS: MetadataMappings = {
  referralCodeKeys: ["ref", "referral_code"],
  source: "both",
};

// ─── AES-GCM Encryption Helpers ──────────────────────────────────────────────

async function getKey(secret: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.padEnd(32, "0").slice(0, 32)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(
  plaintext: string,
  secret: string,
  salt: string,
): Promise<string> {
  const key = await getKey(secret, salt);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  // Encode as base64: iv + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(
  ciphertext: string,
  secret: string,
  salt: string,
): Promise<string> {
  const key = await getKey(secret, salt);
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}
