import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { partners, syncLogs } from "../db";
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

interface StripeInvoice {
  id: string;
  amount_paid: number; // in cents
  currency: string;
  status: string;
  customer: string;
  subscription: string | null;
  created: number; // unix timestamp
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name?: string | null;
  metadata?: Record<string, string>;
}

// ─── Customer browsing types ────────────────────────────────────────────────

export interface StripeCustomerRow {
  stripeCustomerId: string;
  name: string | null;
  email: string | null;
  subscriptionStatus: string | null;
  latestPaymentAmount: number | null; // in cents
  latestPaymentDate: number | null; // unix timestamp
  metadata: Record<string, string>;
}

export interface StripeCustomerListResult {
  customers: StripeCustomerRow[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface CustomerSyncResult {
  customersProcessed: number;
  commissionsCreated: number;
  duplicatesSkipped: number;
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
  invoicesFetched: number;
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
   * Sync a single project: search Stripe charges/subscriptions by metadata keys,
   * match to referrals, create commissions. Returns a detailed summary.
   *
   * @param fullResync - ignore lastSyncAt and search all time
   */
  async syncProject(
    projectId: string,
    options?: { fullResync?: boolean },
  ): Promise<SyncSummary> {
    const logId = crypto.randomUUID();
    const startedAt = new Date();

    const summary: SyncSummary = {
      processedCount: 0,
      chargesFetched: 0,
      subscriptionsFetched: 0,
      invoicesFetched: 0,
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
      // fullResync: search all time. Otherwise use lastSyncAt for incremental,
      // or undefined (no time filter) on first sync.
      const sinceTimestamp =
        options?.fullResync
          ? undefined
          : conn?.lastSyncAt
            ? Math.floor(conn.lastSyncAt.getTime() / 1000)
            : undefined;

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

      // ─── Fetch all Stripe data in parallel ──────────────────────────────────
      const doCharges = mappings.source === "charge_metadata" || mappings.source === "both";
      const doInvoices = mappings.source === "subscription_metadata" || mappings.source === "both";

      const [chargesResult, subscriptionsResult, invoicesResult] = await Promise.all([
        doCharges
          ? this.searchCharges(apiKey, mappings.referralCodeKeys, sinceTimestamp)
          : Promise.resolve([]),
        doInvoices
          ? this.searchSubscriptions(apiKey, mappings.referralCodeKeys, undefined)
          : Promise.resolve([]),
        doInvoices
          ? this.listPaidInvoices(apiKey, sinceTimestamp)
          : Promise.resolve([]),
      ]);

      // ─── Process charges ────────────────────────────────────────────────────
      if (doCharges) {
        const charges = chargesResult;
        summary.chargesFetched = charges.length;

        for (const charge of charges) {
          if (charge.status !== "succeeded") {
            summary.failedChargeStatusCount++;
            continue;
          }
          // Skip charges linked to an invoice — these will be handled by the
          // invoice path to avoid creating duplicate commissions for the same payment.
          if (charge.invoice && mappings.source === "both") {
            continue;
          }
          if (!charge.customer) {
            summary.noCustomerCount++;
            continue;
          }

          // Get customer email (cached)
          const email = await this.getCachedCustomerEmail(
            apiKey,
            charge.customer,
            emailCache,
          );
          summary.customersLookedUp++;
          if (!email) {
            summary.emailLookupFailures++;
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
            eventDate: new Date(charge.created * 1000),
          });

          if (result.isDuplicate) {
            summary.duplicateEventsSkipped++;
          } else {
            summary.processedCount++;
          }
        }
      }

      // ─── Process invoices for subscription-based recurring commissions ──────
      if (doInvoices) {
        const subscriptions = subscriptionsResult;
        summary.subscriptionsFetched = subscriptions.length;

        // Pre-populate the subscription metadata cache from search results
        const subMetadataCache = new Map<string, Record<string, string> | null>();
        for (const sub of subscriptions) {
          subMetadataCache.set(sub.id, sub.metadata ?? null);
        }

        const invoices = invoicesResult;
        summary.invoicesFetched = invoices.length;

        for (const invoice of invoices) {
          // Skip one-off invoices without a subscription (handled by charge path)
          if (!invoice.subscription) continue;

          if (!invoice.customer) {
            summary.noCustomerCount++;
            continue;
          }

          // If the subscription was NOT found by the metadata search, it has
          // no referral code — skip the expensive individual API lookup.
          if (!subMetadataCache.has(invoice.subscription)) {
            summary.noMetadataCount++;
            continue;
          }

          // Get subscription metadata from the pre-populated cache
          const subMetadata = subMetadataCache.get(invoice.subscription) ?? null;

          // Try to match via referral code in subscription metadata
          const refCode = this.extractReferralCode(subMetadata ?? undefined, mappings);
          if (refCode) {
            summary.metadataFound++;
            refCodeCounts.set(refCode, (refCodeCounts.get(refCode) ?? 0) + 1);
            this.trackMetadataKey(subMetadata ?? undefined, mappings, summary);
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

          // Get customer email (cached)
          const email = await this.getCachedCustomerEmail(
            apiKey,
            invoice.customer,
            emailCache,
          );
          summary.customersLookedUp++;
          if (!email) {
            summary.emailLookupFailures++;
            continue;
          }

          summary.partnersMatched++;
          const revenueInDollars = invoice.amount_paid / 100;
          if (revenueInDollars === 0) continue;

          // Use invoice.id as eventId — unique per billing period, so each
          // monthly payment creates its own commission and re-syncs are safe.
          const result = await commissionService.recordConversion({
            partnerId: matchedPartner.id,
            projectId,
            customerEmail: email.toLowerCase(),
            revenue: revenueInDollars,
            customerStatus: "paid",
            eventId: invoice.id,
            eventDate: new Date(invoice.created * 1000),
          });

          if (result.isDuplicate) {
            summary.duplicateEventsSkipped++;
          } else {
            summary.processedCount++;
          }
        }
      }

      // Build the referral codes summary from collected data
      summary.referralCodes = Array.from(refCodeCounts.entries()).map(
        ([code, count]) => {
          const upperCode = code.toUpperCase();
          const partner = partnerByCode.get(upperCode);
          return {
            code,
            count,
            matched: !!partner,
            partnerName: partner?.name,
          };
        },
      );

      await this.finalizeSyncLog(logId, summary.processedCount, "success");
      await this.stripeService.updateSyncStatus(
        projectId,
        "idle",
        undefined,
        new Date(),
      );

      return summary;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      summary.error = errorMessage;
      await this.finalizeSyncLog(logId, 0, "error", errorMessage);
      await this.stripeService.updateSyncStatus(
        projectId,
        "error",
        errorMessage,
      );
      return summary;
    }
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
   * Build a Stripe Search query that matches objects having any of the
   * configured metadata keys, optionally filtered by created timestamp.
   */
  private buildMetadataSearchQuery(
    metadataKeys: string[],
    sinceTimestamp?: number,
  ): string {
    const keyClauses = metadataKeys.map(
      (key) => `-metadata["${key}"]:null`,
    );
    const metadataQuery = keyClauses.join(" OR ");

    if (sinceTimestamp) {
      return `created>${sinceTimestamp} AND (${metadataQuery})`;
    }
    return metadataQuery;
  }

  /**
   * Search charges via Stripe Search API — only returns charges
   * that have at least one of the configured metadata keys.
   */
  private async searchCharges(
    apiKey: string,
    metadataKeys: string[],
    sinceTimestamp?: number,
  ): Promise<StripeCharge[]> {
    const query = this.buildMetadataSearchQuery(metadataKeys, sinceTimestamp);
    const allCharges: StripeCharge[] = [];
    let page: string | undefined;

    do {
      const params = new URLSearchParams({ query, limit: "100" });
      if (page) params.set("page", page);

      const response = await fetch(
        `https://api.stripe.com/v1/charges/search?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Stripe search charges error: ${response.status} ${body}`,
        );
      }

      const data = (await response.json()) as {
        data: StripeCharge[];
        has_more: boolean;
        next_page?: string;
      };
      allCharges.push(...data.data);
      page = data.has_more ? data.next_page : undefined;
    } while (page);

    return allCharges;
  }

  /**
   * Search subscriptions via Stripe Search API — only returns subscriptions
   * that have at least one of the configured metadata keys.
   */
  private async searchSubscriptions(
    apiKey: string,
    metadataKeys: string[],
    sinceTimestamp?: number,
  ): Promise<StripeSubscription[]> {
    const query = this.buildMetadataSearchQuery(metadataKeys, sinceTimestamp);
    const allSubs: StripeSubscription[] = [];
    let page: string | undefined;

    do {
      const params = new URLSearchParams({ query, limit: "100" });
      if (page) params.set("page", page);

      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/search?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Stripe search subscriptions error: ${response.status} ${body}`,
        );
      }

      const data = (await response.json()) as {
        data: StripeSubscription[];
        has_more: boolean;
        next_page?: string;
      };
      allSubs.push(...data.data);
      page = data.has_more ? data.next_page : undefined;
    } while (page);

    return allSubs;
  }

  /**
   * List paid invoices from Stripe with pagination and optional time filter.
   */
  private async listPaidInvoices(
    apiKey: string,
    sinceTimestamp?: number,
  ): Promise<StripeInvoice[]> {
    const allInvoices: StripeInvoice[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({ status: "paid", limit: "100" });
      if (sinceTimestamp) {
        params.set("created[gt]", sinceTimestamp.toString());
      }
      if (startingAfter) {
        params.set("starting_after", startingAfter);
      }

      const response = await fetch(
        `https://api.stripe.com/v1/invoices?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Stripe list invoices error: ${response.status} ${body}`,
        );
      }

      const data = (await response.json()) as {
        data: StripeInvoice[];
        has_more: boolean;
      };
      allInvoices.push(...data.data);
      hasMore = data.has_more;
      if (data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      }
    }

    return allInvoices;
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
        throw new Error(
          `Stripe API error fetching subscriptions: ${response.status}`,
        );
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
  ): Promise<{ email: string | null; name: string | null; id: string; metadata: Record<string, string> }> {
    const response = await fetch(
      `https://api.stripe.com/v1/customers/${customerId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) return { email: null, name: null, id: customerId, metadata: {} };

    const customer = (await response.json()) as StripeCustomer;
    return {
      email: customer.email,
      name: customer.name ?? null,
      id: customerId,
      metadata: customer.metadata ?? {},
    };
  }

  // ─── Customer browsing & assignment ─────────────────────────────────────────

  /**
   * Search Stripe customers by query string. Runs 3 parallel searches:
   * 1. Customer Search API (name/email)
   * 2. Charge Search API (metadata values)
   * 3. Subscription Search API (metadata values)
   * Merges + deduplicates by customer ID, batch-fetches customer details.
   */
  async searchStripeCustomers(
    apiKey: string,
    query: string,
    metadataKeys: string[],
    limit: number = 20,
  ): Promise<StripeCustomerListResult> {
    // Support "key=value" syntax for explicit metadata search.
    // e.g. "referral_code=lvm-skool" fetches all objects with any configured metadata key,
    // then filters in-memory for exact value match.
    // This avoids Stripe Search API tokenization issues with hyphens/special chars.
    const eqIndex = query.indexOf("=");
    const isMetadataSearch = eqIndex > 0;
    const explicitValue = isMetadataSearch
      ? query.substring(eqIndex + 1).trim()
      : null;

    let customerResults: StripeCustomer[] = [];
    let chargeResults: StripeCharge[] = [];
    let subResults: StripeSubscription[] = [];

    if (isMetadataSearch) {
      // Metadata search: fetch all objects where any configured metadata key exists,
      // then filter in-memory by exact value (if provided).
      [chargeResults, subResults] = await Promise.all([
        this.searchChargesByMetadataKeyExists(apiKey, metadataKeys, explicitValue || null, limit),
        this.searchSubscriptionsByMetadataKeyExists(apiKey, metadataKeys, explicitValue || null, limit),
      ]);
    } else {
      // Free-text search: use Stripe Search API value matching + name/email search
      const searchTerm = query.replace(/"/g, '\\"');
      [customerResults, chargeResults, subResults] = await Promise.all([
        this.searchCustomersByNameEmail(apiKey, searchTerm, limit),
        this.searchChargesByMetadataValue(apiKey, metadataKeys, searchTerm, limit),
        this.searchSubscriptionsByMetadataValue(apiKey, metadataKeys, searchTerm, limit),
      ]);
    }

    // Collect unique customer IDs from charges and subscriptions
    const customerIdsFromCharges = new Set<string>();
    const chargeMetadataByCustomer = new Map<string, Record<string, string>>();
    for (const charge of chargeResults) {
      if (charge.customer) {
        customerIdsFromCharges.add(charge.customer);
        if (!chargeMetadataByCustomer.has(charge.customer) && charge.metadata) {
          chargeMetadataByCustomer.set(charge.customer, charge.metadata);
        }
      }
    }

    const subMetadataByCustomer = new Map<string, Record<string, string>>();
    const subStatusByCustomer = new Map<string, string>();
    for (const sub of subResults) {
      customerIdsFromCharges.add(sub.customer);
      if (!subMetadataByCustomer.has(sub.customer) && sub.metadata) {
        subMetadataByCustomer.set(sub.customer, sub.metadata);
      }
      subStatusByCustomer.set(sub.customer, sub.status);
    }

    // Build merged customer set: start with customer search results
    const customerMap = new Map<string, StripeCustomerRow>();

    for (const cust of customerResults) {
      customerMap.set(cust.id, {
        stripeCustomerId: cust.id,
        name: cust.name ?? null,
        email: cust.email,
        subscriptionStatus: null,
        latestPaymentAmount: null,
        latestPaymentDate: null,
        metadata: chargeMetadataByCustomer.get(cust.id) ?? subMetadataByCustomer.get(cust.id) ?? {},
      });
    }

    // Batch-fetch customer details for IDs found from charge/sub search that aren't already in the map
    const missingIds = [...customerIdsFromCharges].filter((id) => !customerMap.has(id));
    if (missingIds.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const batch = missingIds.slice(i, i + batchSize);
        const details = await Promise.all(
          batch.map((id) => this.getCustomerInfo(apiKey, id)),
        );
        for (const detail of details) {
          if (detail.email) {
            // Merge metadata: customer-level as base, charge/sub metadata overrides
            const objectMetadata = chargeMetadataByCustomer.get(detail.id) ?? subMetadataByCustomer.get(detail.id) ?? {};
            const mergedMetadata = { ...detail.metadata, ...objectMetadata };
            customerMap.set(detail.id, {
              stripeCustomerId: detail.id,
              name: detail.name,
              email: detail.email,
              subscriptionStatus: subStatusByCustomer.get(detail.id) ?? null,
              latestPaymentAmount: null,
              latestPaymentDate: null,
              metadata: mergedMetadata,
            });
          }
        }
      }
    }

    // Enrich subscription status for customer search results
    for (const [cusId, row] of customerMap) {
      if (subStatusByCustomer.has(cusId)) {
        row.subscriptionStatus = subStatusByCustomer.get(cusId) ?? null;
      }
      if (chargeMetadataByCustomer.has(cusId) && Object.keys(row.metadata).length === 0) {
        row.metadata = chargeMetadataByCustomer.get(cusId)!;
      }
      if (subMetadataByCustomer.has(cusId) && Object.keys(row.metadata).length === 0) {
        row.metadata = subMetadataByCustomer.get(cusId)!;
      }
    }

    const customers = [...customerMap.values()].slice(0, limit);
    return { customers, hasMore: customerMap.size > limit };
  }

  /**
   * List default customers (no search query). Two filter modes:
   * - "recent": customers who had charges in the last 30 days
   * - "active_subscribers": customers with active subscriptions
   */
  async listDefaultCustomers(
    apiKey: string,
    filter: "recent" | "active_subscribers",
    limit: number = 20,
    startingAfter?: string,
  ): Promise<StripeCustomerListResult> {
    if (filter === "active_subscribers") {
      return this.listActiveSubscriberCustomers(apiKey, limit, startingAfter);
    }
    return this.listRecentCustomers(apiKey, limit, startingAfter);
  }

  /**
   * Sync all historical charges + invoices for a specific customer,
   * creating commissions linked to the specified partner.
   */
  async syncCustomerHistory(
    apiKey: string,
    projectId: string,
    partnerId: string,
    stripeCustomerId: string,
  ): Promise<{ commissionsCreated: number; duplicatesSkipped: number }> {
    const commissionService = new CommissionService(this.db);

    // Fetch customer email
    const customerInfo = await this.getCustomerInfo(apiKey, stripeCustomerId);
    if (!customerInfo.email) {
      return { commissionsCreated: 0, duplicatesSkipped: 0 };
    }
    const email = customerInfo.email.toLowerCase();

    // Fetch all charges and paid invoices in parallel
    const [charges, invoices] = await Promise.all([
      this.listCustomerCharges(apiKey, stripeCustomerId),
      this.listCustomerInvoices(apiKey, stripeCustomerId),
    ]);

    let commissionsCreated = 0;
    let duplicatesSkipped = 0;

    // Determine if we have invoices — if so, skip charges that have an invoice
    const hasInvoices = invoices.length > 0;

    // Process charges
    for (const charge of charges) {
      if (charge.status !== "succeeded") continue;
      if (charge.amount === 0) continue;
      // Skip charges with an invoice if we also have invoices (avoid double-counting)
      if (hasInvoices && charge.invoice) continue;

      const revenue = charge.amount / 100;
      const result = await commissionService.recordConversion({
        partnerId,
        projectId,
        customerEmail: email,
        revenue,
        customerStatus: "paid",
        eventId: charge.id,
        eventDate: new Date(charge.created * 1000),
      });

      if (result.isDuplicate) {
        duplicatesSkipped++;
      } else {
        commissionsCreated++;
      }
    }

    // Process invoices
    for (const invoice of invoices) {
      if (invoice.amount_paid === 0) continue;

      const revenue = invoice.amount_paid / 100;
      const result = await commissionService.recordConversion({
        partnerId,
        projectId,
        customerEmail: email,
        revenue,
        customerStatus: "paid",
        eventId: invoice.id,
        eventDate: new Date(invoice.created * 1000),
      });

      if (result.isDuplicate) {
        duplicatesSkipped++;
      } else {
        commissionsCreated++;
      }
    }

    return { commissionsCreated, duplicatesSkipped };
  }

  // ─── Private helpers for customer browsing ──────────────────────────────────

  private async searchCustomersByNameEmail(
    apiKey: string,
    query: string,
    limit: number,
  ): Promise<StripeCustomer[]> {
    const searchQuery = `email~"${query}" OR name~"${query}"`;
    const params = new URLSearchParams({ query: searchQuery, limit: String(limit) });

    const response = await fetch(
      `https://api.stripe.com/v1/customers/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      console.error(
        `Stripe customer name/email search failed (${response.status}):`,
        await response.text().catch(() => ""),
      );
      return [];
    }

    const data = (await response.json()) as { data: StripeCustomer[] };
    return data.data;
  }

  private async searchChargesByMetadataValue(
    apiKey: string,
    metadataKeys: string[],
    value: string,
    limit: number,
  ): Promise<StripeCharge[]> {
    if (metadataKeys.length === 0) return [];

    const clauses = metadataKeys.map((key) => `metadata["${key}"]:"${value}"`);
    const query = clauses.join(" OR ");
    const params = new URLSearchParams({ query, limit: String(limit) });

    const response = await fetch(
      `https://api.stripe.com/v1/charges/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      console.error(
        `Stripe charge metadata search failed (${response.status}):`,
        await response.text().catch(() => ""),
      );
      return [];
    }

    const data = (await response.json()) as { data: StripeCharge[] };
    return data.data;
  }

  private async searchSubscriptionsByMetadataValue(
    apiKey: string,
    metadataKeys: string[],
    value: string,
    limit: number,
  ): Promise<StripeSubscription[]> {
    if (metadataKeys.length === 0) return [];

    const clauses = metadataKeys.map((key) => `metadata["${key}"]:"${value}"`);
    const query = clauses.join(" OR ");
    const params = new URLSearchParams({ query, limit: String(limit) });

    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      console.error(
        `Stripe subscription metadata search failed (${response.status}):`,
        await response.text().catch(() => ""),
      );
      return [];
    }

    const data = (await response.json()) as { data: StripeSubscription[] };
    return data.data;
  }

  /**
   * Fetch all charges where any of the configured metadata keys exist,
   * paginating through Stripe Search API results.
   * If exactValue is provided, filters in-memory for exact match (case-insensitive).
   * If exactValue is null, returns all charges with any metadata key present.
   *
   * This bypasses Stripe Search API tokenization issues with special characters
   * (hyphens, underscores, etc.) in metadata values.
   */
  private async searchChargesByMetadataKeyExists(
    apiKey: string,
    metadataKeys: string[],
    exactValue: string | null,
    limit: number,
  ): Promise<StripeCharge[]> {
    if (metadataKeys.length === 0) return [];

    const query = this.buildMetadataSearchQuery(metadataKeys);
    const matched: StripeCharge[] = [];
    let page: string | undefined;
    const valueLower = exactValue?.toLowerCase() ?? null;

    do {
      const params = new URLSearchParams({ query, limit: "100" });
      if (page) params.set("page", page);

      const response = await fetch(
        `https://api.stripe.com/v1/charges/search?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        console.error(
          `Stripe charge metadata key-exists search failed (${response.status}):`,
          await response.text().catch(() => ""),
        );
        break;
      }

      const data = (await response.json()) as {
        data: StripeCharge[];
        has_more: boolean;
        next_page?: string;
      };

      for (const charge of data.data) {
        if (!valueLower) {
          // No value filter — return all with metadata key present
          matched.push(charge);
        } else {
          // Check if any configured key has the exact value
          for (const key of metadataKeys) {
            const metaVal = charge.metadata?.[key];
            if (metaVal != null && metaVal.toLowerCase() === valueLower) {
              matched.push(charge);
              break;
            }
          }
        }
        if (matched.length >= limit) break;
      }

      page = matched.length >= limit ? undefined : (data.has_more ? data.next_page : undefined);
    } while (page);

    return matched.slice(0, limit);
  }

  /**
   * Fetch all subscriptions where any of the configured metadata keys exist,
   * paginating through Stripe Search API results.
   * If exactValue is provided, filters in-memory for exact match (case-insensitive).
   * If exactValue is null, returns all subscriptions with any metadata key present.
   *
   * This bypasses Stripe Search API tokenization issues with special characters
   * (hyphens, underscores, etc.) in metadata values.
   */
  private async searchSubscriptionsByMetadataKeyExists(
    apiKey: string,
    metadataKeys: string[],
    exactValue: string | null,
    limit: number,
  ): Promise<StripeSubscription[]> {
    if (metadataKeys.length === 0) return [];

    const query = this.buildMetadataSearchQuery(metadataKeys);
    const matched: StripeSubscription[] = [];
    let page: string | undefined;
    const valueLower = exactValue?.toLowerCase() ?? null;

    do {
      const params = new URLSearchParams({ query, limit: "100" });
      if (page) params.set("page", page);

      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/search?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        console.error(
          `Stripe subscription metadata key-exists search failed (${response.status}):`,
          await response.text().catch(() => ""),
        );
        break;
      }

      const data = (await response.json()) as {
        data: StripeSubscription[];
        has_more: boolean;
        next_page?: string;
      };

      for (const sub of data.data) {
        if (!valueLower) {
          matched.push(sub);
        } else {
          for (const key of metadataKeys) {
            const metaVal = sub.metadata?.[key];
            if (metaVal != null && metaVal.toLowerCase() === valueLower) {
              matched.push(sub);
              break;
            }
          }
        }
        if (matched.length >= limit) break;
      }

      page = matched.length >= limit ? undefined : (data.has_more ? data.next_page : undefined);
    } while (page);

    return matched.slice(0, limit);
  }

  private async listRecentCustomers(
    apiKey: string,
    limit: number,
    startingAfter?: string,
  ): Promise<StripeCustomerListResult> {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const params = new URLSearchParams({
      limit: String(limit),
      "created[gt]": thirtyDaysAgo.toString(),
    });
    if (startingAfter) params.set("starting_after", startingAfter);

    const response = await fetch(
      `https://api.stripe.com/v1/charges?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) return { customers: [], hasMore: false };

    const data = (await response.json()) as { data: StripeCharge[]; has_more: boolean };

    // Deduplicate by customer ID, resolve details
    const seen = new Map<string, StripeCharge>();
    for (const charge of data.data) {
      if (charge.customer && !seen.has(charge.customer)) {
        seen.set(charge.customer, charge);
      }
    }

    // Batch fetch customer details
    const customerIds = [...seen.keys()];
    const customers: StripeCustomerRow[] = [];

    const batchSize = 10;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map((id) => this.getCustomerInfo(apiKey, id)),
      );
      for (const detail of details) {
        const charge = seen.get(detail.id);
        // Merge metadata: customer-level as base, charge-level overrides
        const mergedMetadata = { ...detail.metadata, ...(charge?.metadata ?? {}) };
        customers.push({
          stripeCustomerId: detail.id,
          name: detail.name,
          email: detail.email,
          subscriptionStatus: charge?.status ?? null,
          latestPaymentAmount: charge?.amount ?? null,
          latestPaymentDate: charge?.created ?? null,
          metadata: mergedMetadata,
        });
      }
    }

    const lastCharge = data.data[data.data.length - 1];
    return {
      customers,
      hasMore: data.has_more,
      nextCursor: lastCharge?.id,
    };
  }

  private async listActiveSubscriberCustomers(
    apiKey: string,
    limit: number,
    startingAfter?: string,
  ): Promise<StripeCustomerListResult> {
    const params = new URLSearchParams({
      status: "active",
      limit: String(limit),
    });
    if (startingAfter) params.set("starting_after", startingAfter);

    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) return { customers: [], hasMore: false };

    const data = (await response.json()) as { data: StripeSubscription[]; has_more: boolean };

    // Deduplicate by customer
    const seen = new Map<string, StripeSubscription>();
    for (const sub of data.data) {
      if (!seen.has(sub.customer)) {
        seen.set(sub.customer, sub);
      }
    }

    // Batch fetch customer details
    const customerIds = [...seen.keys()];
    const customers: StripeCustomerRow[] = [];

    const batchSize = 10;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map((id) => this.getCustomerInfo(apiKey, id)),
      );
      for (const detail of details) {
        const sub = seen.get(detail.id);
        const price = sub?.items?.data?.[0]?.price?.unit_amount ?? null;
        // Merge metadata: customer-level as base, subscription-level overrides
        const mergedMetadata = { ...detail.metadata, ...(sub?.metadata ?? {}) };
        customers.push({
          stripeCustomerId: detail.id,
          name: detail.name,
          email: detail.email,
          subscriptionStatus: sub?.status ?? "active",
          latestPaymentAmount: price,
          latestPaymentDate: null,
          metadata: mergedMetadata,
        });
      }
    }

    const lastSub = data.data[data.data.length - 1];
    return {
      customers,
      hasMore: data.has_more,
      nextCursor: lastSub?.id,
    };
  }

  /**
   * List all charges for a specific customer (paginated, all history).
   */
  private async listCustomerCharges(
    apiKey: string,
    customerId: string,
  ): Promise<StripeCharge[]> {
    const allCharges: StripeCharge[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({ customer: customerId, limit: "100" });
      if (startingAfter) params.set("starting_after", startingAfter);

      const response = await fetch(
        `https://api.stripe.com/v1/charges?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) break;

      const data = (await response.json()) as { data: StripeCharge[]; has_more: boolean };
      allCharges.push(...data.data);
      hasMore = data.has_more;
      if (data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      }
    }

    return allCharges;
  }

  /**
   * List all paid invoices for a specific customer (paginated, all history).
   */
  private async listCustomerInvoices(
    apiKey: string,
    customerId: string,
  ): Promise<StripeInvoice[]> {
    const allInvoices: StripeInvoice[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        customer: customerId,
        status: "paid",
        limit: "100",
      });
      if (startingAfter) params.set("starting_after", startingAfter);

      const response = await fetch(
        `https://api.stripe.com/v1/invoices?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) break;

      const data = (await response.json()) as { data: StripeInvoice[]; has_more: boolean };
      allInvoices.push(...data.data);
      hasMore = data.has_more;
      if (data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      }
    }

    return allInvoices;
  }

}
