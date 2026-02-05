import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  clicks,
  partners,
  type NewClickRow,
} from "../db";

export class TrackingService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Look up a partner by referral code. Returns partner + projectId or null.
   */
  async getPartnerByReferralCode(referralCode: string) {
    const rows = await this.db
      .select({
        id: partners.id,
        projectId: partners.projectId,
        status: partners.status,
        referralCode: partners.referralCode,
      })
      .from(partners)
      .where(eq(partners.referralCode, referralCode.toUpperCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Record a click event. Returns the click ID.
   */
  async recordClick(data: {
    partnerId: string;
    projectId: string;
    referralCode: string;
    ip?: string;
    userAgent?: string;
    referrer?: string;
    landingPage?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const row: NewClickRow = {
      id,
      partnerId: data.partnerId,
      projectId: data.projectId,
      referralCode: data.referralCode.toUpperCase(),
      ip: data.ip ? await hashIP(data.ip) : null,
      userAgent: data.userAgent ?? null,
      referrer: data.referrer ?? null,
      landingPage: data.landingPage ?? null,
    };
    await this.db.insert(clicks).values(row);
    return id;
  }
}

/**
 * Hash IP address for privacy using SHA-256 (truncated to hex).
 */
async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
