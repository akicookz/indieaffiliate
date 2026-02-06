import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { partners, customers, syncLogs } from "../db";
import { StripeService, type MetadataMappings } from "./stripe-service";
import { CommissionService } from "./commission-service";

interface StripeCharge {
  id: string;
  amount: number; // in cents
  currency: string;
  customer: string | null;
  status: string;
  created: number; // unix timestamp
  metadata?: Record<string, string>;
  invoice?: string | null;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  items?: {
    data: Array<{
      price?: { unit_amount: number | null };
    }>;
  };
}

interface StripeCustomer {
  id: string;
  email: string | null;
}

export interface ReferralCodeInfo {
  code: string;
  count: number;
  matched: boolean;
  partnerName?: string;
}

export interface SyncSummary {
  processedCount: number;
  chargesFetched: number;
  subscriptionsFetched: number;
  customersLookedUp: number;
  existingCustomersSkipped: number;
  metadataFound: number;
  metadataKeys: Record<string, number>; // key -> count of charges/subs with that key
  partnersMatched: number;
  unmatchedReferralCodes: string[];
  referralCodes: ReferralCodeInfo[]; // all discovered referral codes with counts + match status
  noMetadataCount: number;
  noCustomerCount: number;
  failedChargeStatusCount: number;
  emailLookupFailures: number;
  duplicateEventsSkipped: number;
  error?: string;
}

export class StripeSyncService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private stripeService: StripeService,
  ) {}

  /**
   * Sync a single project: fetch new Stripe charges (and optionally subscriptions),
   * match to referrals, create commissions. Returns a detailed summary.
   */
  async syncProject(projectId: string): Promise<SyncSummary> {
    const logId = crypto.randomUUID();
    const startedAt = new Date();

    const summary: SyncSummary = {
      processedCount: 0,
      chargesFetched: 0,
      subscriptionsFetched: 0,
      customersLookedUp: 0,
      existingCustomersSkipped: 0,
      metadataFound: 0,
      metadataKeys: {},
      partnersMatched: 0,
      unmatchedReferralCodes: [],
      referralCodes: [],
      noMetadataCount: 0,
      noCustomerCount: 0,
      failedChargeStatusCount: 0,
      emailLookupFailures: 0,
      duplicateEventsSkipped: 0,
    };

    // Record sync start
    await this.db.insert(syncLogs).values({
      id: logId,
      projectId,
      source: "stripe",
      status: "success", // will be updated on error
      processedCount: 0,
      startedAt,
    });

    await this.stripeService.updateSyncStatus(projectId, "syncing");

    try {
      const apiKey = await this.stripeService.getDecryptedKey(projectId);
      if (!apiKey) {
        throw new Error("Stripe API key not found");
      }

      const mappings = await this.stripeService.getMetadataMappings(projectId);
      const conn = await this.stripeService.getConnection(projectId);
      // For first sync, look back 1 year to catch older subscriptions/charges.
      // Subsequent syncs use lastSyncAt for incremental fetching.
      const sinceTimestamp = conn?.lastSyncAt
        ? Math.floor(conn.lastSyncAt.getTime() / 1000)
        : Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);

      // Get all partners for this project (to match referrals)
      const projectPartners = await this.db
        .select()
        .from(partners)
        .where(eq(partners.projectId, projectId));

      // Cache customer emails to avoid N+1 Stripe API calls
      const emailCache = new Map<string, string | null>();

      const commissionService = new CommissionService(this.db);

      // Build a map of referral codes -> partner for fast matching
      const partnerByCode = new Map(
        projectPartners.map((p) => [p.referralCode.toUpperCase(), p]),
      );

      // Track all discovered referral codes with counts
      const refCodeCounts = new Map<string, number>();

      // ─── Fetch & process charges ─────────────────────────────────────────
      if (mappings.source === "charge_metadata" || mappings.source === "both") {
        const charges = await this.fetchCharges(apiKey, sinceTimestamp);
        summary.chargesFetched = charges.length;

        for (const charge of charges) {
          if (charge.status !== "succeeded") {
            summary.failedChargeStatusCount++;
            continue;
          }
          if (!charge.customer) {
            summary.noCustomerCount++;
            continue;
          }

          // Get customer email (cached)
          const email = await this.getCachedCustomerEmail(apiKey, charge.customer, emailCache);
          summary.customersLookedUp++;
          if (!email) {
            summary.emailLookupFailures++;
            continue;
          }

          // Check if this customer already exists in our system for this project
          const existingCustomers = await this.db
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.projectId, projectId),
                eq(customers.email, email.toLowerCase()),
              ),
            )
            .limit(1);

          if (existingCustomers[0]) {
            summary.existingCustomersSkipped++;
            continue;
          }

          // Try to match via referral: check charge metadata using configured keys
          const refCode = this.extractReferralCode(charge.metadata, mappings);
          if (refCode) {
            summary.metadataFound++;
            refCodeCounts.set(refCode, (refCodeCounts.get(refCode) ?? 0) + 1);
            // Track which metadata key was found
            this.trackMetadataKey(charge.metadata, mappings, summary);
          } else {
            summary.noMetadataCount++;
            continue;
          }

          const matchedPartner = partnerByCode.get(refCode.toUpperCase());
          if (!matchedPartner) {
            if (!summary.unmatchedReferralCodes.includes(refCode)) {
              summary.unmatchedReferralCodes.push(refCode);
            }
            continue;
          }

          summary.partnersMatched++;
          const revenueInDollars = charge.amount / 100;

          const result = await commissionService.recordConversion({
            partnerId: matchedPartner.id,
            projectId,
            customerEmail: email.toLowerCase(),
            revenue: revenueInDollars,
            customerStatus: "paid",
            eventId: charge.id,
          });

          if (result.isDuplicate) {
            summary.duplicateEventsSkipped++;
          } else {
            summary.processedCount++;
          }
        }
      }

      // ─── Fetch & process subscriptions ───────────────────────────────────
      if (mappings.source === "subscription_metadata" || mappings.source === "both") {
        const subscriptions = await this.fetchSubscriptions(apiKey, {
          status: "all",
          createdAfter: sinceTimestamp,
        });
        summary.subscriptionsFetched = subscriptions.length;

        for (const sub of subscriptions) {
          if (!sub.customer) {
            summary.noCustomerCount++;
            continue;
          }

          // Get customer email (cached)
          const email = await this.getCachedCustomerEmail(apiKey, sub.customer, emailCache);
          summary.customersLookedUp++;
          if (!email) {
            summary.emailLookupFailures++;
            continue;
          }

          // Check if this customer already exists in our system for this project
          const existingCustomers = await this.db
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.projectId, projectId),
                eq(customers.email, email.toLowerCase()),
              ),
            )
            .limit(1);

          if (existingCustomers[0]) {
            summary.existingCustomersSkipped++;
            continue;
          }

          // Try to match via referral: check subscription metadata using configured keys
          const refCode = this.extractReferralCode(sub.metadata, mappings);
          if (refCode) {
            summary.metadataFound++;
            refCodeCounts.set(refCode, (refCodeCounts.get(refCode) ?? 0) + 1);
            this.trackMetadataKey(sub.metadata, mappings, summary);
          } else {
            summary.noMetadataCount++;
            continue;
          }

          const matchedPartner = partnerByCode.get(refCode.toUpperCase());
          if (!matchedPartner) {
            if (!summary.unmatchedReferralCodes.includes(refCode)) {
              summary.unmatchedReferralCodes.push(refCode);
            }
            continue;
          }

          summary.partnersMatched++;

          // Calculate revenue from subscription items
          const revenueInDollars = (sub.items?.data ?? []).reduce((sum, item) => {
            return sum + (item.price?.unit_amount ?? 0) / 100;
          }, 0);

          if (revenueInDollars === 0) continue;

          const result = await commissionService.recordConversion({
            partnerId: matchedPartner.id,
            projectId,
            customerEmail: email.toLowerCase(),
            revenue: revenueInDollars,
            customerStatus: sub.status === "active" ? "paid" : "trialing",
            eventId: sub.id,
          });

          if (result.isDuplicate) {
            summary.duplicateEventsSkipped++;
          } else {
            summary.processedCount++;
          }
        }
      }

      // Build the referral codes summary from collected data
      summary.referralCodes = Array.from(refCodeCounts.entries()).map(([code, count]) => {
        const upperCode = code.toUpperCase();
        const partner = partnerByCode.get(upperCode);
        return {
          code,
          count,
          matched: !!partner,
          partnerName: partner?.name,
        };
      });

      await this.finalizeSyncLog(logId, summary.processedCount, "success");
      await this.stripeService.updateSyncStatus(projectId, "idle", undefined, new Date());

      return summary;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      summary.error = errorMessage;
      await this.finalizeSyncLog(logId, 0, "error", errorMessage);
      await this.stripeService.updateSyncStatus(projectId, "error", errorMessage);
      return summary;
    }
  }

  /**
   * Fetch charges from Stripe API with pagination.
   */
  private async fetchCharges(
    apiKey: string,
    sinceTimestamp: number,
  ): Promise<StripeCharge[]> {
    const allCharges: StripeCharge[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        "created[gte]": sinceTimestamp.toString(),
        limit: "100",
      });
      if (startingAfter) {
        params.set("starting_after", startingAfter);
      }

      const response = await fetch(
        `https://api.stripe.com/v1/charges?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        throw new Error(`Stripe API error fetching charges: ${response.status}`);
      }

      const data = await response.json() as {
        data: StripeCharge[];
        has_more: boolean;
      };
      allCharges.push(...data.data);
      hasMore = data.has_more;
      if (data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      }
    }

    return allCharges;
  }

  /**
   * Get a Stripe customer's email, with caching to avoid duplicate API calls.
   */
  private async getCachedCustomerEmail(
    apiKey: string,
    customerId: string,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (cache.has(customerId)) {
      return cache.get(customerId)!;
    }

    const response = await fetch(
      `https://api.stripe.com/v1/customers/${customerId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      cache.set(customerId, null);
      return null;
    }

    const customer = (await response.json()) as StripeCustomer;
    cache.set(customerId, customer.email);
    return customer.email;
  }

  /**
   * Update a sync log with final status.
   */
  private async finalizeSyncLog(
    logId: string,
    processedCount: number,
    status: "success" | "error",
    errorMessage?: string,
  ): Promise<void> {
    await this.db
      .update(syncLogs)
      .set({
        processedCount,
        status,
        errorMessage: errorMessage ?? null,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, logId));
  }

  /**
   * Extract a referral code from metadata using configured keys.
   */
  private extractReferralCode(
    metadata: Record<string, string> | undefined,
    mappings: MetadataMappings,
  ): string | undefined {
    if (!metadata) return undefined;
    for (const key of mappings.referralCodeKeys) {
      const value = metadata[key];
      if (value) return value;
    }
    return undefined;
  }

  /**
   * Track which metadata key was actually found (for summary reporting).
   */
  private trackMetadataKey(
    metadata: Record<string, string> | undefined,
    mappings: MetadataMappings,
    summary: SyncSummary,
  ): void {
    if (!metadata) return;
    for (const key of mappings.referralCodeKeys) {
      if (metadata[key]) {
        summary.metadataKeys[key] = (summary.metadataKeys[key] ?? 0) + 1;
        return;
      }
    }
  }

  /**
   * Fetch subscriptions from Stripe API with pagination and optional filters.
   */
  async fetchSubscriptions(
    apiKey: string,
    filters?: {
      status?: "active" | "canceled" | "all";
      createdAfter?: number;
      createdBefore?: number;
    },
  ): Promise<StripeSubscription[]> {
    const allSubs: StripeSubscription[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({ limit: "100" });
      if (filters?.status) {
        params.set("status", filters.status);
      }
      if (filters?.createdAfter) {
        params.set("created[gte]", filters.createdAfter.toString());
      }
      if (filters?.createdBefore) {
        params.set("created[lte]", filters.createdBefore.toString());
      }
      if (startingAfter) {
        params.set("starting_after", startingAfter);
      }

      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        throw new Error(`Stripe API error fetching subscriptions: ${response.status}`);
      }

      const data = (await response.json()) as {
        data: StripeSubscription[];
        has_more: boolean;
      };
      allSubs.push(...data.data);
      hasMore = data.has_more;
      if (data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      }
    }

    return allSubs;
  }

  /**
   * Get a Stripe customer's full info (email + name).
   */
  async getCustomerInfo(
    apiKey: string,
    customerId: string,
  ): Promise<{ email: string | null; name: string | null; id: string }> {
    const response = await fetch(
      `https://api.stripe.com/v1/customers/${customerId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) return { email: null, name: null, id: customerId };

    const customer = (await response.json()) as StripeCustomer & { name?: string | null };
    return { email: customer.email, name: customer.name ?? null, id: customerId };
  }
}
