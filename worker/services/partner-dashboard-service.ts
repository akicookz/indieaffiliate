import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {
  partners,
  customers,
  commissions,
  clicks,
  payouts,
  commissionPrograms,
  projectBranding,
  type CommissionProgramRow,
  type PartnerRow,
} from "../db";
import { StripeService } from "./stripe-service";

/**
 * Mask a name for privacy: "John Doe" -> "J*** D**"
 */
function maskName(name: string | null): string {
  if (!name) return "****";
  return name
    .split(" ")
    .map((part) => {
      if (part.length <= 1) return part + "***";
      return part[0] + "*".repeat(Math.min(part.length - 1, 4));
    })
    .join(" ");
}

/**
 * Mask an email for privacy: "john@example.com" -> "j***@e***.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  const domainParts = domain.split(".");
  const maskedLocal = local.length <= 1
    ? local + "***"
    : local[0] + "*".repeat(Math.min(local.length - 1, 4));
  const maskedDomain = domainParts[0].length <= 1
    ? domainParts[0] + "***"
    : domainParts[0][0] + "*".repeat(Math.min(domainParts[0].length - 1, 4));
  return `${maskedLocal}@${maskedDomain}.${domainParts.slice(1).join(".")}`;
}

interface PartnerDashboardData {
  partner: {
    name: string;
    email: string;
    referralCode: string;
    commissionRate: number;
    status: string;
  };
  stats: {
    totalEarnings: number;
    pendingEarnings: number;
    approvedEarnings: number;
    paidEarnings: number;
    totalClicks: number;
    uniqueClicks: number;
    totalReferrals: number;
    conversionRate: number;
  };
  recentPayouts: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    note: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  }>;
}

interface PartnerCommissionProgramSummary {
  id: string;
  name: string;
  rate: number;
  type: string;
  durationMonths: number | null;
  flatAmount: number | null;
}

interface PartnerEffectiveProgram {
  commissionProgram: PartnerCommissionProgramSummary | null;
  usesDefaultCommissionProgram: boolean;
  defaultCommissionProgramId: string | null;
}

function summarizeProgram(
  program: CommissionProgramRow,
): PartnerCommissionProgramSummary {
  return {
    id: program.id,
    name: program.name,
    rate: program.rate,
    type: program.type,
    durationMonths: program.durationMonths,
    flatAmount: program.flatAmount,
  };
}

interface ReferredCustomer {
  id: string;
  maskedName: string;
  maskedEmail: string;
  status: string;
  revenue: number;
  createdAt: Date;
  stripeStatus?: string | null;
}

interface PartnerCommission {
  id: string;
  amount: number;
  rate: number;
  status: string;
  maskedCustomerEmail: string;
  createdAt: Date;
}

export class PartnerDashboardService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get all partner records linked to a user ID (a partner may be across multiple projects).
   */
  async getPartnersByUserId(userId: string): Promise<PartnerRow[]> {
    return this.db
      .select()
      .from(partners)
      .where(eq(partners.userId, userId));
  }

  async getEffectiveCommissionPrograms(
    partnerRows: PartnerRow[],
  ): Promise<Map<string, PartnerEffectiveProgram>> {
    const out = new Map<string, PartnerEffectiveProgram>();
    if (partnerRows.length === 0) return out;

    const projectIds = Array.from(
      new Set(partnerRows.map((partner) => partner.projectId)),
    );
    const brandingRows = await this.db
      .select({
        projectId: projectBranding.projectId,
        defaultCommissionProgramId: projectBranding.defaultCommissionProgramId,
      })
      .from(projectBranding)
      .where(inArray(projectBranding.projectId, projectIds));
    const defaultProgramMap = new Map(
      brandingRows.map((row) => [
        row.projectId,
        row.defaultCommissionProgramId,
      ]),
    );

    const programIds = Array.from(
      new Set(
        partnerRows
          .map(
            (partner) =>
              partner.commissionProgramId ??
              defaultProgramMap.get(partner.projectId) ??
              null,
          )
          .filter((value): value is string => !!value),
      ),
    );
    const programRows = programIds.length
      ? await this.db
          .select()
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, programIds))
      : [];
    const programMap = new Map(
      programRows.map((program) => [program.id, summarizeProgram(program)]),
    );

    for (const partner of partnerRows) {
      const defaultProgramId = defaultProgramMap.get(partner.projectId) ?? null;
      const effectiveProgramId =
        partner.commissionProgramId ?? defaultProgramId;
      const commissionProgram = effectiveProgramId
        ? programMap.get(effectiveProgramId) ?? null
        : null;
      out.set(partner.id, {
        commissionProgram,
        usesDefaultCommissionProgram:
          !partner.commissionProgramId &&
          !!defaultProgramId &&
          !!commissionProgram,
        defaultCommissionProgramId: defaultProgramId,
      });
    }

    return out;
  }

  /**
   * Link a Better Auth user to all partner records matching their email.
   * Called on first magic link login.
   */
  async linkUserToPartners(userId: string, email: string): Promise<number> {
    const result = await this.db
      .update(partners)
      .set({ userId })
      .where(
        and(
          eq(partners.email, email.toLowerCase()),
          sql`${partners.userId} IS NULL`,
        ),
      );
    return (result as unknown as { rowsAffected: number }).rowsAffected ?? 0;
  }

  /**
   * Get dashboard summary data for a partner.
   */
  async getDashboardData(partnerIds: string[]): Promise<PartnerDashboardData["stats"]> {
    if (partnerIds.length === 0) {
      return {
        totalEarnings: 0,
        pendingEarnings: 0,
        approvedEarnings: 0,
        paidEarnings: 0,
        totalClicks: 0,
        uniqueClicks: 0,
        totalReferrals: 0,
        conversionRate: 0,
      };
    }

    // Commission stats
    const commissionStats = await this.db
      .select({
        total: sql<number>`coalesce(sum(case when ${commissions.status} != 'rejected' then ${commissions.amount} else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${commissions.status} = 'pending' then ${commissions.amount} else 0 end), 0)`,
        approved: sql<number>`coalesce(sum(case when ${commissions.status} = 'approved' then ${commissions.amount} else 0 end), 0)`,
        paid: sql<number>`coalesce(sum(case when ${commissions.status} = 'paid' then ${commissions.amount} else 0 end), 0)`,
      })
      .from(commissions)
      .where(inArray(commissions.partnerId, partnerIds));

    const payoutStats = await this.db
      .select({
        paid: sql<number>`coalesce(sum(case when ${payouts.status} = 'paid' then ${payouts.amount} else 0 end), 0)`,
      })
      .from(payouts)
      .where(inArray(payouts.partnerId, partnerIds));

    // Click stats
    const clickStats = await this.db
      .select({
        totalClicks: sql<number>`count(*)`,
        uniqueClicks: sql<number>`sum(case when ${clicks.isUnique} = 1 then 1 else 0 end)`,
      })
      .from(clicks)
      .where(inArray(clicks.partnerId, partnerIds));

    // Referral count
    const referralStats = await this.db
      .select({
        total: sql<number>`count(*)`,
      })
      .from(customers)
      .where(inArray(customers.partnerId, partnerIds));

    const cs = commissionStats[0];
    const ps = payoutStats[0];
    const ck = clickStats[0];
    const rs = referralStats[0];
    const uniqueClickCount = ck?.uniqueClicks ?? 0;
    const referralCount = rs?.total ?? 0;
    const paidOut = Math.max(ps?.paid ?? 0, cs?.paid ?? 0);
    const pendingEarnings = cs?.pending ?? 0;
    const approvedEarnings = cs?.approved ?? 0;

    return {
      totalEarnings: pendingEarnings + approvedEarnings + paidOut,
      pendingEarnings,
      approvedEarnings,
      paidEarnings: paidOut,
      totalClicks: ck?.totalClicks ?? 0,
      uniqueClicks: uniqueClickCount,
      totalReferrals: referralCount,
      conversionRate: uniqueClickCount > 0
        ? Math.round((referralCount / uniqueClickCount) * 10000) / 100
        : 0,
    };
  }

  /**
   * Get referred customers with masked names for a partner.
   */
  async getReferredCustomers(partnerIds: string[]): Promise<ReferredCustomer[]> {
    if (partnerIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(customers)
      .where(inArray(customers.partnerId, partnerIds))
      .orderBy(desc(customers.createdAt));

    return rows.map((row) => ({
      id: row.id,
      maskedName: maskName(row.name),
      maskedEmail: maskEmail(row.email),
      status: row.status,
      revenue: row.revenue,
      createdAt: row.createdAt,
      stripeStatus: null, // populated by Stripe on-demand fetch
    }));
  }

  /**
   * Get commissions for a partner.
   */
  async getCommissions(partnerIds: string[]): Promise<PartnerCommission[]> {
    if (partnerIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: commissions.id,
        amount: commissions.amount,
        rate: commissions.rate,
        status: commissions.status,
        customerId: commissions.customerId,
        createdAt: commissions.createdAt,
      })
      .from(commissions)
      .where(inArray(commissions.partnerId, partnerIds))
      .orderBy(desc(commissions.createdAt));

    // Get customer emails for masking
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const customerRows = customerIds.length > 0
      ? await this.db
          .select({ id: customers.id, email: customers.email })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : [];
    const customerMap = new Map(customerRows.map((c) => [c.id, c.email]));

    return rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      rate: row.rate,
      status: row.status,
      maskedCustomerEmail: maskEmail(customerMap.get(row.customerId) ?? ""),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get payouts for a partner.
   */
  async getPayouts(partnerIds: string[]) {
    if (partnerIds.length === 0) return [];

    return this.db
      .select()
      .from(payouts)
      .where(inArray(payouts.partnerId, partnerIds))
      .orderBy(desc(payouts.createdAt));
  }

  /**
   * Fetch live Stripe subscription statuses for referred customers.
   * Uses the project's encrypted Stripe key to make on-demand API calls.
   */
  async enrichCustomersWithStripeStatus(
    referredCustomers: ReferredCustomer[],
    partnerIds: string[],
    encryptionKey: string,
    salt: string,
  ): Promise<ReferredCustomer[]> {
    if (referredCustomers.length === 0) return referredCustomers;

    // Get project IDs for these partners
    const partnerRows = await this.db
      .select({ id: partners.id, projectId: partners.projectId })
      .from(partners)
      .where(inArray(partners.id, partnerIds));
    const projectIds = [...new Set(partnerRows.map((p) => p.projectId))];

    // Get Stripe connections for these projects
    const stripeService = new StripeService(this.db, encryptionKey, salt);
    const stripeKeys = new Map<string, string>();

    for (const projectId of projectIds) {
      const key = await stripeService.getDecryptedKey(projectId);
      if (key) stripeKeys.set(projectId, key);
    }

    if (stripeKeys.size === 0) return referredCustomers;

    // Get customer records to map customer IDs to project IDs and emails
    const customerIds = referredCustomers.map((c) => c.id);
    const customerRecords = await this.db
      .select({
        id: customers.id,
        projectId: customers.projectId,
        email: customers.email,
        stripeCustomerId: customers.stripeCustomerId,
      })
      .from(customers)
      .where(inArray(customers.id, customerIds));

    const customerProjectMap = new Map(
      customerRecords.map((c) => [c.id, { projectId: c.projectId, email: c.email, stripeCustomerId: c.stripeCustomerId }]),
    );

    // Fetch Stripe status for each customer (in parallel, batched)
    const enriched = await Promise.all(
      referredCustomers.map(async (customer) => {
        const info = customerProjectMap.get(customer.id);
        if (!info) return customer;

        const stripeKey = stripeKeys.get(info.projectId);
        if (!stripeKey) return customer;

        try {
          const stripeStatus = await fetchStripeSubscriptionStatus(
            stripeKey,
            info.email,
            info.stripeCustomerId,
          );
          return { ...customer, stripeStatus };
        } catch {
          return customer;
        }
      }),
    );

    return enriched;
  }
}

/**
 * Fetch a customer's subscription status from Stripe.
 * Tries stripeCustomerId first, falls back to email search.
 */
async function fetchStripeSubscriptionStatus(
  apiKey: string,
  email: string,
  stripeCustomerId: string | null,
): Promise<string | null> {
  let customerId = stripeCustomerId;

  // If no stored Stripe customer ID, search by email
  if (!customerId) {
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as { data: Array<{ id: string }> };
    if (searchData.data.length === 0) return null;
    customerId = searchData.data[0].id;
  }

  // Get subscriptions for this customer
  const subRes = await fetch(
    `https://api.stripe.com/v1/subscriptions?customer=${customerId}&limit=1&status=all`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!subRes.ok) return null;
  const subData = await subRes.json() as {
    data: Array<{
      status: string;
      cancel_at_period_end: boolean;
      current_period_end: number;
    }>;
  };

  if (subData.data.length === 0) {
    // Check for one-time payments instead
    const chargeRes = await fetch(
      `https://api.stripe.com/v1/charges?customer=${customerId}&limit=1`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!chargeRes.ok) return null;
    const chargeData = await chargeRes.json() as {
      data: Array<{ status: string; refunded: boolean }>;
    };
    if (chargeData.data.length === 0) return null;
    const charge = chargeData.data[0];
    if (charge.refunded) return "refunded";
    return charge.status === "succeeded" ? "paid" : charge.status;
  }

  const sub = subData.data[0];

  // Map Stripe status to our display status
  if (sub.status === "trialing") return "trialing";
  if (sub.status === "active" && sub.cancel_at_period_end) {
    const cancelDate = new Date(sub.current_period_end * 1000);
    return `cancels_on:${cancelDate.toISOString().split("T")[0]}`;
  }
  if (sub.status === "active") return "active";
  if (sub.status === "past_due") return "past_due";
  if (sub.status === "canceled") return "cancelled";
  if (sub.status === "unpaid") return "past_due";

  return sub.status;
}
