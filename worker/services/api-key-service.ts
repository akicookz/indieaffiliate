import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { apiKeys, type ApiKeyRow } from "../db";

export class ApiKeyService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Generate a new API key for a project.
   * Returns the full plaintext key (only shown once) and the stored row.
   */
  async generateKey(
    projectId: string,
    name: string,
  ): Promise<{ key: string; row: ApiKeyRow }> {
    const rawKey = generateRawKey();
    const prefix = rawKey.slice(0, 11); // "ia_" + 8 chars
    const keyHash = await hashKey(rawKey);

    const id = crypto.randomUUID();
    await this.db.insert(apiKeys).values({
      id,
      projectId,
      keyHash,
      prefix,
      name,
    });

    const row = await this.getById(id);
    return { key: rawKey, row: row! };
  }

  /**
   * Verify an API key. Returns the projectId if valid, null otherwise.
   * Also updates lastUsedAt.
   */
  async verifyKey(key: string): Promise<{ projectId: string; keyId: string } | null> {
    const keyHash = await hashKey(key);
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Update last used timestamp
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`(unixepoch())` })
      .where(eq(apiKeys.id, row.id));

    return { projectId: row.projectId, keyId: row.id };
  }

  /**
   * List API keys for a project (without hashes).
   */
  async listByProject(projectId: string): Promise<ApiKeyRow[]> {
    return this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.projectId, projectId));
  }

  /**
   * Revoke (delete) an API key.
   */
  async revoke(id: string): Promise<boolean> {
    const row = await this.getById(id);
    if (!row) return false;
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
    return true;
  }

  private async getById(id: string): Promise<ApiKeyRow | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}

/**
 * Generate a raw API key: "ia_" + 32 hex chars.
 */
function generateRawKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ia_${hex}`;
}

/**
 * Hash an API key using SHA-256 for storage.
 */
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
