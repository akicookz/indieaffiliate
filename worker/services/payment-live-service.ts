// Live-pull Stripe payments for the Payments page. Nothing is persisted here
// — we hit the Stripe REST API on every request and merge with assignment
// state from the local `payments` table.

import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { payments, type PaymentRow } from "../db";

export type Kind = "subscription" | "one_time";
export type AssignedFilter = "all" | "assigned";

type ParsedQuery =
  | { kind: "metadata"; key: string; value: string | null }
  | { kind: "text"; text: string };

function parseQuery(raw: string | undefined): ParsedQuery | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) return { kind: "metadata", key, value: value || null };
  }
  return { kind: "text", text: trimmed };
}

// Stripe Search query strings are double-quoted; escape user input so a stray
// quote can't break the query or be used to inject extra clauses.
function escapeQuery(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export interface LiveListOptions {
  limit: number;
  cursor?: string;
  /** Free-text search: parses "key=value" as metadata search; otherwise matches name/email/metadata. */
  query?: string;
  /** Project-configured metadata keys (e.g. ["referral_code"]) used for free-text metadata matching. */
  referralCodeKeys?: string[];
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name?: string | null;
}

interface StripePrice {
  unit_amount: number | null;
  nickname?: string | null;
  product?: string | null;
  recurring?: {
    interval?: "day" | "week" | "month" | "year";
    interval_count?: number;
  } | null;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  billing_cycle_anchor?: number;
  current_period_start?: number;
  current_period_end?: number;
  start_date?: number;
  metadata?: Record<string, string>;
  items?: { data: Array<{ price?: StripePrice }> };
}

interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  customer: string | null;
  status: string;
  created: number;
  description?: string | null;
  invoice?: string | null;
  metadata?: Record<string, string>;
}

interface StripeInvoice {
  id: string;
  amount_paid: number;
  status: string;
  customer: string;
  subscription: string | null;
  created: number;
}

export interface LivePaymentRow {
  source: "stripe";
  externalPaymentId: string;
  kind: Kind;
  customer: { stripeCustomerId: string | null; email: string | null; name: string | null };
  metadata: Record<string, string>;
  status?: string;
  billingCycleAnchor?: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  startedAt?: number;
  plan?: {
    name: string | null;
    unitAmount: number | null;
    interval: string | null;
    intervalCount: number | null;
  };
  amount?: number;
  created?: number;
  description?: string | null;
  assignment: {
    paymentId: string;
    partnerId: string;
    commissionProgramId: string | null;
    programType: "recurring" | "lifetime" | "one-time" | null;
    durationMonths: number | null;
    rate: number | null;
    flagReason: string | null;
  } | null;
}

export interface LiveListResult {
  data: LivePaymentRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export class PaymentLiveService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async listSubscriptions(
    apiKey: string,
    projectId: string,
    opts: LiveListOptions,
    assigned: AssignedFilter,
  ): Promise<LiveListResult> {
    const subs = await this.fetchSubscriptions(apiKey, opts);
    const customers = await this.batchFetchCustomers(
      apiKey,
      subs.data.map((s) => s.customer).filter(Boolean),
    );
    const ids = subs.data.map((s) => s.id);
    const assignmentMap = await this.loadAssignments(projectId, ids);

    let rows: LivePaymentRow[] = subs.data.map((s) => {
      const item = s.items?.data?.[0];
      const price = item?.price;
      const cust = customers.get(s.customer) ?? null;
      const assignment = assignmentMap.get(s.id) ?? null;
      return {
        source: "stripe",
        externalPaymentId: s.id,
        kind: "subscription",
        customer: {
          stripeCustomerId: s.customer,
          email: cust?.email ?? null,
          name: cust?.name ?? null,
        },
        metadata: s.metadata ?? {},
        status: s.status,
        billingCycleAnchor: s.billing_cycle_anchor ?? s.start_date,
        currentPeriodStart: s.current_period_start,
        currentPeriodEnd: s.current_period_end,
        startedAt: s.start_date,
        plan: price
          ? {
              name: price.nickname ?? price.product ?? null,
              unitAmount: price.unit_amount,
              interval: price.recurring?.interval ?? null,
              intervalCount: price.recurring?.interval_count ?? null,
            }
          : undefined,
        assignment: assignment ? this.mapAssignment(assignment) : null,
      };
    });

    if (assigned === "assigned") rows = rows.filter((r) => r.assignment !== null);
    return { data: rows, hasMore: subs.hasMore, nextCursor: subs.nextCursor };
  }

  async listOneTimeCharges(
    apiKey: string,
    projectId: string,
    opts: LiveListOptions,
    assigned: AssignedFilter,
  ): Promise<LiveListResult> {
    const charges = await this.fetchCharges(apiKey, opts);
    // Filter: only succeeded, no invoice (not subscription-driven)
    const filtered = charges.data.filter(
      (c) => c.status === "succeeded" && !c.invoice,
    );
    const customers = await this.batchFetchCustomers(
      apiKey,
      filtered.map((c) => c.customer).filter((id): id is string => id !== null),
    );
    const ids = filtered.map((c) => c.id);
    const assignmentMap = await this.loadAssignments(projectId, ids);

    let rows: LivePaymentRow[] = filtered.map((c) => {
      const cust = c.customer ? customers.get(c.customer) ?? null : null;
      const assignment = assignmentMap.get(c.id) ?? null;
      return {
        source: "stripe",
        externalPaymentId: c.id,
        kind: "one_time",
        customer: {
          stripeCustomerId: c.customer,
          email: cust?.email ?? null,
          name: cust?.name ?? null,
        },
        metadata: c.metadata ?? {},
        amount: c.amount,
        created: c.created,
        description: c.description ?? null,
        assignment: assignment ? this.mapAssignment(assignment) : null,
      };
    });

    if (assigned === "assigned") rows = rows.filter((r) => r.assignment !== null);
    return { data: rows, hasMore: charges.hasMore, nextCursor: charges.nextCursor };
  }

  // ─── Stripe HTTP ────────────────────────────────────────────────────────

  private async fetchSubscriptions(
    apiKey: string,
    opts: LiveListOptions,
  ): Promise<{ data: StripeSubscription[]; hasMore: boolean; nextCursor: string | null }> {
    const parsed = parseQuery(opts.query);
    if (parsed) {
      const data = await this.searchSubscriptions(
        apiKey,
        parsed,
        opts.referralCodeKeys ?? [],
        opts.limit,
      );
      // Search results are not paginated here — the Search API has its own
      // tokenized cursor and combining it across multiple parallel queries
      // doesn't compose. Bound results to `limit` and surface a single page.
      return { data, hasMore: false, nextCursor: null };
    }

    const params = new URLSearchParams({
      status: "all",
      limit: String(opts.limit),
      "expand[]": "data.items.data.price",
    });
    if (opts.cursor) params.set("starting_after", opts.cursor);
    const r = await fetch(
      `https://api.stripe.com/v1/subscriptions?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) throw new Error(`Stripe subscriptions ${r.status}`);
    const json = (await r.json()) as { data: StripeSubscription[]; has_more: boolean };
    const last = json.data[json.data.length - 1];
    return {
      data: json.data,
      hasMore: json.has_more,
      nextCursor: json.has_more && last ? last.id : null,
    };
  }

  private async fetchCharges(
    apiKey: string,
    opts: LiveListOptions,
  ): Promise<{ data: StripeCharge[]; hasMore: boolean; nextCursor: string | null }> {
    const parsed = parseQuery(opts.query);
    if (parsed) {
      const data = await this.searchCharges(
        apiKey,
        parsed,
        opts.referralCodeKeys ?? [],
        opts.limit,
      );
      return { data, hasMore: false, nextCursor: null };
    }

    const params = new URLSearchParams({ limit: String(opts.limit) });
    if (opts.cursor) params.set("starting_after", opts.cursor);
    const r = await fetch(
      `https://api.stripe.com/v1/charges?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) throw new Error(`Stripe charges ${r.status}`);
    const json = (await r.json()) as { data: StripeCharge[]; has_more: boolean };
    const last = json.data[json.data.length - 1];
    return {
      data: json.data,
      hasMore: json.has_more,
      nextCursor: json.has_more && last ? last.id : null,
    };
  }

  // ─── Search helpers ─────────────────────────────────────────────────────

  private async searchSubscriptions(
    apiKey: string,
    parsed: ParsedQuery,
    referralCodeKeys: string[],
    limit: number,
  ): Promise<StripeSubscription[]> {
    if (parsed.kind === "metadata") {
      const subs = await this.runSubscriptionSearch(
        apiKey,
        `-metadata["${parsed.key}"]:null`,
        limit,
      );
      const v = parsed.value?.toLowerCase();
      return v
        ? subs.filter(
            (s) => (s.metadata?.[parsed.key] ?? "").toLowerCase() === v,
          )
        : subs;
    }

    // Free-text: customers (by name/email) → subs by customer + subs by metadata
    const term = escapeQuery(parsed.text);
    const [customerIds, byMetadata] = await Promise.all([
      this.searchCustomerIdsByNameEmail(apiKey, term, limit),
      this.searchSubscriptionsByMetadataValue(apiKey, referralCodeKeys, term, limit),
    ]);
    const byCustomer =
      customerIds.length > 0
        ? await this.runSubscriptionSearch(
            apiKey,
            customerIds.map((id) => `customer:"${id}"`).join(" OR "),
            limit,
          )
        : [];
    return dedupeById([...byCustomer, ...byMetadata]).slice(0, limit);
  }

  private async searchCharges(
    apiKey: string,
    parsed: ParsedQuery,
    referralCodeKeys: string[],
    limit: number,
  ): Promise<StripeCharge[]> {
    if (parsed.kind === "metadata") {
      const charges = await this.runChargeSearch(
        apiKey,
        `-metadata["${parsed.key}"]:null`,
        limit,
      );
      const v = parsed.value?.toLowerCase();
      return v
        ? charges.filter(
            (c) => (c.metadata?.[parsed.key] ?? "").toLowerCase() === v,
          )
        : charges;
    }

    const term = escapeQuery(parsed.text);
    const [customerIds, byMetadata] = await Promise.all([
      this.searchCustomerIdsByNameEmail(apiKey, term, limit),
      this.searchChargesByMetadataValue(apiKey, referralCodeKeys, term, limit),
    ]);
    const byCustomer =
      customerIds.length > 0
        ? await this.runChargeSearch(
            apiKey,
            customerIds.map((id) => `customer:"${id}"`).join(" OR "),
            limit,
          )
        : [];
    return dedupeById([...byCustomer, ...byMetadata]).slice(0, limit);
  }

  private async runSubscriptionSearch(
    apiKey: string,
    query: string,
    limit: number,
  ): Promise<StripeSubscription[]> {
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      "expand[]": "data.items.data.price",
    });
    const r = await fetch(
      `https://api.stripe.com/v1/subscriptions/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) {
      console.error(
        `Stripe subscriptions/search failed (${r.status}):`,
        await r.text().catch(() => ""),
      );
      return [];
    }
    const json = (await r.json()) as { data: StripeSubscription[] };
    return json.data;
  }

  private async runChargeSearch(
    apiKey: string,
    query: string,
    limit: number,
  ): Promise<StripeCharge[]> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const r = await fetch(
      `https://api.stripe.com/v1/charges/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) {
      console.error(
        `Stripe charges/search failed (${r.status}):`,
        await r.text().catch(() => ""),
      );
      return [];
    }
    const json = (await r.json()) as { data: StripeCharge[] };
    return json.data;
  }

  private async searchCustomerIdsByNameEmail(
    apiKey: string,
    term: string,
    limit: number,
  ): Promise<string[]> {
    const query = `email~"${term}" OR name~"${term}"`;
    const params = new URLSearchParams({ query, limit: String(limit) });
    const r = await fetch(
      `https://api.stripe.com/v1/customers/search?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!r.ok) return [];
    const json = (await r.json()) as { data: Array<{ id: string }> };
    return json.data.map((c) => c.id);
  }

  private async searchSubscriptionsByMetadataValue(
    apiKey: string,
    keys: string[],
    term: string,
    limit: number,
  ): Promise<StripeSubscription[]> {
    if (keys.length === 0) return [];
    const query = keys.map((k) => `metadata["${k}"]:"${term}"`).join(" OR ");
    return this.runSubscriptionSearch(apiKey, query, limit);
  }

  private async searchChargesByMetadataValue(
    apiKey: string,
    keys: string[],
    term: string,
    limit: number,
  ): Promise<StripeCharge[]> {
    if (keys.length === 0) return [];
    const query = keys.map((k) => `metadata["${k}"]:"${term}"`).join(" OR ");
    return this.runChargeSearch(apiKey, query, limit);
  }

  private async batchFetchCustomers(
    apiKey: string,
    customerIds: string[],
  ): Promise<Map<string, StripeCustomer>> {
    const unique = [...new Set(customerIds)];
    const out = new Map<string, StripeCustomer>();
    // Parallel fetches in chunks of 10 to avoid hammering Stripe.
    const chunkSize = 10;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (id) => {
          const r = await fetch(`https://api.stripe.com/v1/customers/${id}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!r.ok) return null;
          return (await r.json()) as StripeCustomer;
        }),
      );
      for (const c of results) if (c) out.set(c.id, c);
    }
    return out;
  }

  // ─── Assignment join ────────────────────────────────────────────────────

  private async loadAssignments(
    projectId: string,
    externalIds: string[],
  ): Promise<Map<string, PaymentRow>> {
    if (externalIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.projectId, projectId),
          eq(payments.source, "stripe"),
          inArray(payments.externalPaymentId, externalIds),
        ),
      );
    return new Map(rows.map((r) => [r.externalPaymentId, r]));
  }

  private mapAssignment(p: PaymentRow): LivePaymentRow["assignment"] {
    if (!p.partnerId) return null;
    return {
      paymentId: p.id,
      partnerId: p.partnerId,
      commissionProgramId: p.commissionProgramId ?? null,
      programType: (p.programType as "recurring" | "lifetime" | "one-time" | null) ?? null,
      durationMonths: p.durationMonths ?? null,
      rate: p.rate ?? null,
      flagReason: p.flagReason ?? null,
    };
  }

  // ─── Subscription invoice fetch (used by pending-payouts derive) ────────

  async listPaidInvoicesForSubscription(
    apiKey: string,
    subscriptionId: string,
  ): Promise<StripeInvoice[]> {
    const all: StripeInvoice[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams({
        subscription: subscriptionId,
        status: "paid",
        limit: "100",
      });
      if (startingAfter) params.set("starting_after", startingAfter);
      const r = await fetch(
        `https://api.stripe.com/v1/invoices?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!r.ok) break;
      const json = (await r.json()) as { data: StripeInvoice[]; has_more: boolean };
      all.push(...json.data);
      hasMore = json.has_more;
      if (json.data.length === 0) break;
      startingAfter = json.data[json.data.length - 1].id;
    }
    return all;
  }
}

/**
 * Compute 1-based monthIndex from Stripe billing_cycle_anchor and an
 * invoice.created timestamp. Month 1 = invoice on/around the anchor date.
 */
export function monthIndexFromAnchor(
  invoiceCreatedSec: number,
  anchorSec: number,
): number {
  const a = new Date(anchorSec * 1000);
  const b = new Date(invoiceCreatedSec * 1000);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  return Math.max(1, months + 1);
}
