import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  clicks,
  partners,
  type NewClickRow,
} from "../db";
import { FraudService } from "./fraud-service";

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
        email: partners.email,
      })
      .from(partners)
      .where(eq(partners.referralCode, referralCode.toUpperCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Record a click event with fraud detection.
   * Returns the click ID and whether it was unique.
   */
  async recordClick(data: {
    partnerId: string;
    projectId: string;
    referralCode: string;
    ip?: string;
    userAgent?: string;
    referrer?: string;
    landingPage?: string;
    country?: string;
    botScore?: number;
  }): Promise<{ clickId: string; isUnique: boolean }> {
    const id = crypto.randomUUID();
    const hashedIp = data.ip ? await hashIP(data.ip) : null;
    const fraudService = new FraudService(this.db);

    // Click deduplication: check if same IP + referral code clicked recently
    let isUnique = true;
    if (hashedIp) {
      const isDuplicate = await fraudService.isClickDuplicate(
        hashedIp,
        data.referralCode.toUpperCase(),
      );
      isUnique = !isDuplicate;
    }

    const row: NewClickRow = {
      id,
      partnerId: data.partnerId,
      projectId: data.projectId,
      referralCode: data.referralCode.toUpperCase(),
      ip: hashedIp,
      userAgent: data.userAgent ?? null,
      referrer: data.referrer ?? null,
      landingPage: data.landingPage ?? null,
      isUnique,
      country: data.country ?? null,
      botScore: data.botScore ?? null,
    };
    await this.db.insert(clicks).values(row);

    // Post-insert fraud checks (non-blocking — we still return the click)
    if (hashedIp) {
      const floodResult = await fraudService.checkClickFlood(
        hashedIp,
        data.projectId,
      );
      if (floodResult) {
        await fraudService.createFlag({
          projectId: data.projectId,
          partnerId: data.partnerId,
          type: floodResult.type,
          severity: floodResult.severity,
          details: floodResult.details,
          relatedClickId: id,
        });
      }
    }

    const botResult = fraudService.checkBotClick(
      data.botScore,
      data.userAgent,
    );
    if (botResult) {
      await fraudService.createFlag({
        projectId: data.projectId,
        partnerId: data.partnerId,
        type: botResult.type,
        severity: botResult.severity,
        details: botResult.details,
        relatedClickId: id,
      });
    }

    return { clickId: id, isUnique };
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

export { hashIP };
