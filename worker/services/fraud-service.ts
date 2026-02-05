import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, ne, gte } from "drizzle-orm";
import {
  fraudFlags,
  clicks,
  commissions,
  partners,
  projects,
  customers,
  type FraudFlagRow,
  type NewFraudFlagRow,
} from "../db";
import * as authSchema from "../db/auth.schema";

// Known bot user-agent patterns
const BOT_UA_PATTERNS = [
  /bot\b/i,
  /crawl/i,
  /spider/i,
  /scrape/i,
  /headless/i,
  /phantom/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /wget/i,
  /curl\//i,
  /python-requests/i,
  /go-http-client/i,
  /java\//i,
  /libwww/i,
  /httpclient/i,
  /node-fetch/i,
  /axios\//i,
];

interface FraudCheckResult {
  type: NewFraudFlagRow["type"];
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
}

export class FraudService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Detection Methods ────────────────────────────────────────────────────

  /**
   * Check if partner email matches customer email (self-referral).
   */
  checkSelfReferral(
    partnerEmail: string,
    customerEmail: string,
  ): FraudCheckResult | null {
    if (partnerEmail.toLowerCase() === customerEmail.toLowerCase()) {
      return {
        type: "self_referral",
        severity: "high",
        details: { email: customerEmail.toLowerCase() },
      };
    }
    return null;
  }

  /**
   * Check if partner email matches the project owner's email.
   */
  async checkOwnerAsPartner(
    partnerEmail: string,
    projectId: string,
  ): Promise<FraudCheckResult | null> {
    const projectRows = await this.db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projectRows[0]) return null;

    const userRows = await this.db
      .select({ email: authSchema.users.email })
      .from(authSchema.users)
      .where(eq(authSchema.users.id, projectRows[0].userId))
      .limit(1);
    if (!userRows[0]) return null;

    if (userRows[0].email.toLowerCase() === partnerEmail.toLowerCase()) {
      return {
        type: "owner_as_partner",
        severity: "high",
        details: {
          ownerEmail: userRows[0].email.toLowerCase(),
          partnerEmail: partnerEmail.toLowerCase(),
        },
      };
    }
    return null;
  }

  /**
   * Check if a commission with this eventId already exists (idempotency).
   * Returns the existing commission ID if found.
   */
  async checkDuplicateCommission(
    projectId: string,
    eventId: string,
  ): Promise<{ commissionId: string; customerId: string; commissionAmount: number } | null> {
    const rows = await this.db
      .select({
        id: commissions.id,
        customerId: commissions.customerId,
        amount: commissions.amount,
      })
      .from(commissions)
      .where(
        and(
          eq(commissions.projectId, projectId),
          eq(commissions.externalEventId, eventId),
        ),
      )
      .limit(1);

    if (rows[0]) {
      return {
        commissionId: rows[0].id,
        customerId: rows[0].customerId,
        commissionAmount: rows[0].amount,
      };
    }
    return null;
  }

  /**
   * Check if a click from this IP + referral code already exists within the
   * dedup window. Returns true if duplicate.
   */
  async isClickDuplicate(
    hashedIp: string,
    referralCode: string,
    windowHours: number = 24,
  ): Promise<boolean> {
    const sinceUnix = Math.floor(
      (Date.now() - windowHours * 60 * 60 * 1000) / 1000,
    );
    const rows = await this.db
      .select({ id: clicks.id })
      .from(clicks)
      .where(
        and(
          eq(clicks.ip, hashedIp),
          eq(clicks.referralCode, referralCode),
          gte(clicks.createdAt, sql`${sinceUnix}`),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Check for click flood — too many clicks from one IP in a time window.
   */
  async checkClickFlood(
    hashedIp: string,
    projectId: string,
    threshold: number = 20,
    windowMinutes: number = 60,
  ): Promise<FraudCheckResult | null> {
    const sinceUnix = Math.floor(
      (Date.now() - windowMinutes * 60 * 1000) / 1000,
    );
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(clicks)
      .where(
        and(
          eq(clicks.ip, hashedIp),
          eq(clicks.projectId, projectId),
          gte(clicks.createdAt, sql`${sinceUnix}`),
        ),
      );

    const count = rows[0]?.count ?? 0;
    if (count >= threshold) {
      return {
        type: "click_flood",
        severity: "medium",
        details: { clickCount: count, windowMinutes, threshold, ip: hashedIp },
      };
    }
    return null;
  }

  /**
   * Check if a click looks like a bot based on CF bot score and user-agent.
   */
  checkBotClick(
    botScore: number | undefined | null,
    userAgent: string | undefined | null,
  ): FraudCheckResult | null {
    // CF bot score: 1 = definitely bot, 99 = definitely human
    if (botScore !== undefined && botScore !== null && botScore < 30) {
      return {
        type: "bot_click",
        severity: "medium",
        details: { botScore, userAgent: userAgent?.slice(0, 200) ?? null },
      };
    }

    if (userAgent) {
      for (const pattern of BOT_UA_PATTERNS) {
        if (pattern.test(userAgent)) {
          return {
            type: "bot_click",
            severity: "medium",
            details: {
              botScore: botScore ?? null,
              userAgent: userAgent.slice(0, 200),
              matchedPattern: pattern.source,
            },
          };
        }
      }
    }

    // No user-agent at all is suspicious
    if (!userAgent) {
      return {
        type: "bot_click",
        severity: "low",
        details: { botScore: botScore ?? null, userAgent: null },
      };
    }

    return null;
  }

  /**
   * Check for geographic mismatch between a partner's recent clicks and a conversion.
   */
  async checkGeoMismatch(
    partnerId: string,
    projectId: string,
    conversionCountry: string | undefined | null,
  ): Promise<FraudCheckResult | null> {
    if (!conversionCountry) return null;

    // Get the most common click country for this partner in the last 30 days
    const sinceUnix = Math.floor(
      (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000,
    );
    const rows = await this.db
      .select({
        country: clicks.country,
        count: sql<number>`count(*)`.as("cnt"),
      })
      .from(clicks)
      .where(
        and(
          eq(clicks.partnerId, partnerId),
          eq(clicks.projectId, projectId),
          gte(clicks.createdAt, sql`${sinceUnix}`),
          sql`${clicks.country} is not null`,
        ),
      )
      .groupBy(clicks.country)
      .orderBy(sql`cnt desc`)
      .limit(1);

    if (!rows[0]?.country) return null;

    const clickCountry = rows[0].country;
    if (clickCountry.toUpperCase() !== conversionCountry.toUpperCase()) {
      return {
        type: "geo_mismatch",
        severity: "low",
        details: { clickCountry, conversionCountry },
      };
    }
    return null;
  }

  /**
   * Check for velocity spike — too many conversions from one partner in a short window.
   */
  async checkVelocitySpike(
    partnerId: string,
    projectId: string,
    threshold: number = 50,
    windowMinutes: number = 60,
  ): Promise<FraudCheckResult | null> {
    const sinceUnix = Math.floor(
      (Date.now() - windowMinutes * 60 * 1000) / 1000,
    );
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(commissions)
      .where(
        and(
          eq(commissions.partnerId, partnerId),
          eq(commissions.projectId, projectId),
          gte(commissions.createdAt, sql`${sinceUnix}`),
        ),
      );

    const count = rows[0]?.count ?? 0;
    if (count >= threshold) {
      return {
        type: "velocity_spike",
        severity: "medium",
        details: {
          conversionCount: count,
          windowMinutes,
          threshold,
        },
      };
    }
    return null;
  }

  /**
   * Check if multiple partners on the same project share a registration IP.
   */
  async checkMultiAccount(
    hashedIp: string,
    projectId: string,
    excludePartnerId: string,
  ): Promise<FraudCheckResult | null> {
    const rows = await this.db
      .select({ id: partners.id, name: partners.name, email: partners.email })
      .from(partners)
      .where(
        and(
          eq(partners.projectId, projectId),
          eq(partners.registrationIp, hashedIp),
          ne(partners.id, excludePartnerId),
        ),
      );

    if (rows.length > 0) {
      return {
        type: "multi_account",
        severity: "medium",
        details: {
          partnerCount: rows.length + 1, // include current partner
          otherPartners: rows.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
          })),
        },
      };
    }
    return null;
  }

  /**
   * Check if a customer email has been attributed to multiple different partners.
   */
  async checkCustomerReuse(
    customerEmail: string,
    currentPartnerId: string,
  ): Promise<FraudCheckResult | null> {
    const rows = await this.db
      .select({ partnerId: customers.partnerId })
      .from(customers)
      .where(
        and(
          eq(customers.email, customerEmail.toLowerCase()),
          ne(customers.partnerId, currentPartnerId),
        ),
      );

    const uniquePartnerIds = [...new Set(rows.map((r) => r.partnerId))];
    if (uniquePartnerIds.length > 0) {
      return {
        type: "customer_reuse",
        severity: "low",
        details: {
          email: customerEmail.toLowerCase(),
          partnerCount: uniquePartnerIds.length + 1, // include current
        },
      };
    }
    return null;
  }

  /**
   * Check if a single conversion revenue exceeds a cap.
   */
  checkRevenueCap(
    revenue: number,
    threshold: number = 10_000,
  ): FraudCheckResult | null {
    if (revenue > threshold) {
      return {
        type: "revenue_cap",
        severity: "medium",
        details: { revenue, threshold },
      };
    }
    return null;
  }

  // ─── Flag CRUD ────────────────────────────────────────────────────────────

  /**
   * Create a fraud flag record.
   */
  async createFlag(data: {
    projectId: string;
    partnerId?: string | null;
    type: NewFraudFlagRow["type"];
    severity: "low" | "medium" | "high";
    status?: "open" | "dismissed" | "confirmed";
    details: Record<string, unknown>;
    relatedCommissionId?: string | null;
    relatedClickId?: string | null;
  }): Promise<FraudFlagRow> {
    const id = crypto.randomUUID();
    const row: NewFraudFlagRow = {
      id,
      projectId: data.projectId,
      partnerId: data.partnerId ?? null,
      type: data.type,
      severity: data.severity,
      status: data.status ?? "open",
      details: JSON.stringify(data.details),
      relatedCommissionId: data.relatedCommissionId ?? null,
      relatedClickId: data.relatedClickId ?? null,
    };
    await this.db.insert(fraudFlags).values(row);
    const result = await this.db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.id, id))
      .limit(1);
    return result[0]!;
  }

  /**
   * Get fraud flags for a project with optional filters.
   */
  async getFlagsByProject(
    projectId: string,
    filters?: {
      status?: string;
      type?: string;
      severity?: string;
    },
  ): Promise<
    (FraudFlagRow & {
      partnerName: string;
      partnerEmail: string;
      projectName: string;
    })[]
  > {
    const conditions = [eq(fraudFlags.projectId, projectId)];

    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(
          fraudFlags.status,
          filters.status as "open" | "dismissed" | "confirmed",
        ),
      );
    }
    if (filters?.type && filters.type !== "all") {
      conditions.push(eq(fraudFlags.type, filters.type as NewFraudFlagRow["type"]));
    }
    if (filters?.severity && filters.severity !== "all") {
      conditions.push(
        eq(fraudFlags.severity, filters.severity as "low" | "medium" | "high"),
      );
    }

    const rows = await this.db
      .select()
      .from(fraudFlags)
      .where(and(...conditions))
      .orderBy(sql`${fraudFlags.createdAt} desc`);

    // Fetch partner names
    const partnerIds = [
      ...new Set(rows.filter((r) => r.partnerId).map((r) => r.partnerId!)),
    ];
    const partnerRows =
      partnerIds.length > 0
        ? await this.db
            .select({
              id: partners.id,
              name: partners.name,
              email: partners.email,
            })
            .from(partners)
            .where(inArray(partners.id, partnerIds))
        : [];
    const partnerMap = new Map(
      partnerRows.map((p) => [p.id, { name: p.name, email: p.email }]),
    );

    // Get project name
    const projectRows = await this.db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const projectName = projectRows[0]?.name ?? "Unknown";

    return rows.map((row) => ({
      ...row,
      partnerName: row.partnerId
        ? (partnerMap.get(row.partnerId)?.name ?? "Unknown")
        : "—",
      partnerEmail: row.partnerId
        ? (partnerMap.get(row.partnerId)?.email ?? "")
        : "",
      projectName,
    }));
  }

  /**
   * Get aggregate stats for fraud flags on a project.
   */
  async getFlagStats(projectId: string) {
    const rows = await this.db
      .select({
        total: sql<number>`count(*)`,
        open: sql<number>`sum(case when ${fraudFlags.status} = 'open' then 1 else 0 end)`,
        high: sql<number>`sum(case when ${fraudFlags.severity} = 'high' and ${fraudFlags.status} = 'open' then 1 else 0 end)`,
        dismissed: sql<number>`sum(case when ${fraudFlags.status} = 'dismissed' then 1 else 0 end)`,
        confirmed: sql<number>`sum(case when ${fraudFlags.status} = 'confirmed' then 1 else 0 end)`,
      })
      .from(fraudFlags)
      .where(eq(fraudFlags.projectId, projectId));

    const row = rows[0];
    return {
      total: row?.total ?? 0,
      open: row?.open ?? 0,
      high: row?.high ?? 0,
      dismissed: row?.dismissed ?? 0,
      confirmed: row?.confirmed ?? 0,
    };
  }

  /**
   * Update a fraud flag's status (dismiss or confirm).
   */
  async updateFlagStatus(
    flagId: string,
    status: "dismissed" | "confirmed",
  ): Promise<FraudFlagRow | null> {
    await this.db
      .update(fraudFlags)
      .set({ status })
      .where(eq(fraudFlags.id, flagId));

    const rows = await this.db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.id, flagId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get a single flag by ID (for ownership verification).
   */
  async getFlagById(flagId: string): Promise<FraudFlagRow | null> {
    const rows = await this.db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.id, flagId))
      .limit(1);
    return rows[0] ?? null;
  }
}
