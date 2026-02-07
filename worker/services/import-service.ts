import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { partners, customers, commissions } from "../db";
import { StripeService, type MetadataMappings } from "./stripe-service";
import { StripeSyncService } from "./stripe-sync-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CsvPartnerRow {
  name: string;
  email: string;
  referralCode?: string;
  commissionRate?: number;
  status?: "active" | "pending" | "inactive";
}

export interface CsvCustomerRow {
  email: string;
  name?: string;
  partnerEmail: string;
  revenue?: number;
  status?: "trialing" | "paid" | "cancelled" | "past_due" | "refunded" | "cancels_on";
}

export interface CsvCommissionRow {
  partnerEmail: string;
  customerEmail: string;
  amount: number;
  status?: "pending" | "approved" | "paid" | "rejected";
}

export interface ImportOptions {
  commissionMode?: "csv" | "recalculate";
}

export interface ImportResult {
  created: {
    partners: number;
    customers: number;
    commissions: number;
  };
  skipped: Array<{ row: number; reason: string; type: "partner" | "customer" | "commission" }>;
  errors: Array<{ row: number; error: string; type: "partner" | "customer" | "commission" }>;
}

export interface StripeImportPreview {
  referralCodes: Array<{
    code: string;
    matchedPartnerId: string | null;
    matchedPartnerName: string | null;
    subscriptionCount: number;
    totalRevenue: number;
    customers: Array<{
      email: string;
      name: string | null;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      revenue: number;
      status: string;
    }>;
  }>;
  totals: {
    subscriptions: number;
    uniqueCustomers: number;
    totalRevenue: number;
    matchedCodes: number;
    unmatchedCodes: number;
  };
}

export interface StripeImportFilters {
  status?: "active" | "canceled" | "all";
  createdAfter?: string;
  createdBefore?: string;
}

export interface StripeImportAssignment {
  referralCode: string;
  partnerId: string;
  action: "link" | "skip";
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ImportService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
  ) {}

  /**
   * Import partners, customers, and commissions from parsed CSV data.
   */
  async importFromCsv(
    projectId: string,
    data: {
      partners: CsvPartnerRow[];
      customers: CsvCustomerRow[];
      commissions: CsvCommissionRow[];
    },
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const result: ImportResult = {
      created: { partners: 0, customers: 0, commissions: 0 },
      skipped: [],
      errors: [],
    };

    // Phase 1: Import partners
    const partnerEmailToId = new Map<string, string>();

    // First, load existing partners for this project
    const existingPartners = await this.db
      .select()
      .from(partners)
      .where(eq(partners.projectId, projectId));

    for (const ep of existingPartners) {
      partnerEmailToId.set(ep.email.toLowerCase(), ep.id);
    }

    for (let i = 0; i < data.partners.length; i++) {
      const row = data.partners[i];
      const email = row.email.toLowerCase();

      if (partnerEmailToId.has(email)) {
        result.skipped.push({ row: i, reason: "Partner with this email already exists", type: "partner" });
        continue;
      }

      try {
        const id = crypto.randomUUID();
        const referralCode = row.referralCode || await this.generateReferralCode();

        // Check if referral code is unique
        const existingCode = await this.db
          .select()
          .from(partners)
          .where(eq(partners.referralCode, referralCode))
          .limit(1);

        const finalCode = existingCode.length > 0
          ? await this.generateReferralCode()
          : referralCode;

        await this.db.insert(partners).values({
          id,
          projectId,
          name: row.name,
          email,
          referralCode: finalCode,
          commissionRate: row.commissionRate ?? 0.2,
          status: row.status ?? "active",
        });

        partnerEmailToId.set(email, id);
        result.created.partners++;
      } catch (err) {
        result.errors.push({
          row: i,
          error: err instanceof Error ? err.message : "Unknown error",
          type: "partner",
        });
      }
    }

    // Phase 2: Import customers
    const customerEmailToId = new Map<string, string>();

    // Load existing customers
    const existingCustomers = await this.db
      .select()
      .from(customers)
      .where(eq(customers.projectId, projectId));

    for (const ec of existingCustomers) {
      customerEmailToId.set(ec.email.toLowerCase(), ec.id);
    }

    for (let i = 0; i < data.customers.length; i++) {
      const row = data.customers[i];
      const email = row.email.toLowerCase();
      const partnerEmail = row.partnerEmail.toLowerCase();

      const partnerId = partnerEmailToId.get(partnerEmail);
      if (!partnerId) {
        result.skipped.push({ row: i, reason: `Partner not found for email: ${row.partnerEmail}`, type: "customer" });
        continue;
      }

      if (customerEmailToId.has(email)) {
        result.skipped.push({ row: i, reason: "Customer with this email already exists", type: "customer" });
        continue;
      }

      try {
        const id = crypto.randomUUID();
        await this.db.insert(customers).values({
          id,
          projectId,
          partnerId,
          email,
          name: row.name ?? null,
          revenue: row.revenue ?? 0,
          status: row.status ?? "paid",
        });

        customerEmailToId.set(email, id);
        result.created.customers++;

        // Update partner stats
        await this.db
          .update(partners)
          .set({
            referredCustomers: (existingPartners.find((p) => p.id === partnerId)?.referredCustomers ?? 0) + 1,
            totalRevenue: (existingPartners.find((p) => p.id === partnerId)?.totalRevenue ?? 0) + (row.revenue ?? 0),
          })
          .where(eq(partners.id, partnerId));
      } catch (err) {
        result.errors.push({
          row: i,
          error: err instanceof Error ? err.message : "Unknown error",
          type: "customer",
        });
      }
    }

    // Phase 3: Import commissions
    for (let i = 0; i < data.commissions.length; i++) {
      const row = data.commissions[i];
      const partnerEmail = row.partnerEmail.toLowerCase();
      const customerEmail = row.customerEmail.toLowerCase();

      const partnerId = partnerEmailToId.get(partnerEmail);
      if (!partnerId) {
        result.skipped.push({ row: i, reason: `Partner not found for email: ${row.partnerEmail}`, type: "commission" });
        continue;
      }

      const customerId = customerEmailToId.get(customerEmail);
      if (!customerId) {
        result.skipped.push({ row: i, reason: `Customer not found for email: ${row.customerEmail}`, type: "commission" });
        continue;
      }

      try {
        // Skip commission creation for self-referral customers
        const customerRow = await this.db
          .select({ isSelfReferral: customers.isSelfReferral })
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);
        if (customerRow[0]?.isSelfReferral) {
          result.skipped.push({ row: i, reason: "Customer is marked as self-referral", type: "commission" });
          continue;
        }

        const partner = existingPartners.find((p) => p.id === partnerId) ||
          (await this.db.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];

        let amount = row.amount;
        if (options.commissionMode === "recalculate" && partner) {
          const customer = await this.db
            .select()
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);
          if (customer[0]) {
            amount = customer[0].revenue * partner.commissionRate;
          }
        }

        const id = crypto.randomUUID();
        await this.db.insert(commissions).values({
          id,
          partnerId,
          customerId,
          projectId,
          amount,
          rate: partner?.commissionRate ?? 0.2,
          status: row.status ?? "pending",
          externalEventId: `csv_import_${id}`,
        });

        result.created.commissions++;
      } catch (err) {
        result.errors.push({
          row: i,
          error: err instanceof Error ? err.message : "Unknown error",
          type: "commission",
        });
      }
    }

    return result;
  }

  /**
   * Preview Stripe subscription import — scan subscriptions, group by referral code.
   */
  async previewStripeImport(
    projectId: string,
    stripeService: StripeService,
    filters: StripeImportFilters = {},
  ): Promise<StripeImportPreview> {
    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) throw new Error("Stripe API key not found");

    const mappings = await stripeService.getMetadataMappings(projectId);
    const syncService = new StripeSyncService(this.db, stripeService);

    // Fetch subscriptions with filters
    const subs = await syncService.fetchSubscriptions(apiKey, {
      status: filters.status ?? "all",
      createdAfter: filters.createdAfter ? Math.floor(new Date(filters.createdAfter).getTime() / 1000) : undefined,
      createdBefore: filters.createdBefore ? Math.floor(new Date(filters.createdBefore).getTime() / 1000) : undefined,
    });

    // Load existing partners
    const existingPartners = await this.db
      .select()
      .from(partners)
      .where(eq(partners.projectId, projectId));

    const partnerByCode = new Map<string, { id: string; name: string }>();
    for (const p of existingPartners) {
      partnerByCode.set(p.referralCode.toUpperCase(), { id: p.id, name: p.name });
    }

    // Group subscriptions by referral code
    const codeGroups = new Map<string, {
      code: string;
      matchedPartnerId: string | null;
      matchedPartnerName: string | null;
      subscriptions: Array<{
        id: string;
        customerId: string;
        revenue: number;
        status: string;
      }>;
    }>();

    for (const sub of subs) {
      const refCode = this.extractReferralCode(sub.metadata, mappings);
      if (!refCode) continue;

      const codeUpper = refCode.toUpperCase();
      if (!codeGroups.has(codeUpper)) {
        const matched = partnerByCode.get(codeUpper);
        codeGroups.set(codeUpper, {
          code: refCode,
          matchedPartnerId: matched?.id ?? null,
          matchedPartnerName: matched?.name ?? null,
          subscriptions: [],
        });
      }

      const unitAmount = sub.items?.data?.[0]?.price?.unit_amount ?? 0;
      codeGroups.get(codeUpper)!.subscriptions.push({
        id: sub.id,
        customerId: sub.customer,
        revenue: unitAmount / 100,
        status: sub.status,
      });
    }

    // Resolve customer emails for the preview
    const customerIds = new Set<string>();
    for (const group of codeGroups.values()) {
      for (const sub of group.subscriptions) {
        customerIds.add(sub.customerId);
      }
    }

    const customerInfoMap = new Map<string, { email: string | null; name: string | null }>();
    // Batch customer lookups (max 50 to avoid rate limits)
    const customerIdArray = [...customerIds];
    for (let i = 0; i < customerIdArray.length; i += 10) {
      const batch = customerIdArray.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((id) => syncService.getCustomerInfo(apiKey, id)),
      );
      for (const info of results) {
        customerInfoMap.set(info.id, { email: info.email, name: info.name });
      }
    }

    // Build result
    const referralCodes: StripeImportPreview["referralCodes"] = [];
    let totalSubscriptions = 0;
    let totalRevenue = 0;
    const uniqueCustomerEmails = new Set<string>();
    let matchedCodes = 0;
    let unmatchedCodes = 0;

    for (const group of codeGroups.values()) {
      const customerEntries: StripeImportPreview["referralCodes"][number]["customers"] = [];
      let groupRevenue = 0;

      for (const sub of group.subscriptions) {
        const info = customerInfoMap.get(sub.customerId);
        if (!info?.email) continue;

        uniqueCustomerEmails.add(info.email.toLowerCase());
        groupRevenue += sub.revenue;
        customerEntries.push({
          email: info.email,
          name: info.name,
          stripeCustomerId: sub.customerId,
          stripeSubscriptionId: sub.id,
          revenue: sub.revenue,
          status: sub.status,
        });
      }

      referralCodes.push({
        code: group.code,
        matchedPartnerId: group.matchedPartnerId,
        matchedPartnerName: group.matchedPartnerName,
        subscriptionCount: group.subscriptions.length,
        totalRevenue: groupRevenue,
        customers: customerEntries,
      });

      totalSubscriptions += group.subscriptions.length;
      totalRevenue += groupRevenue;
      if (group.matchedPartnerId) matchedCodes++;
      else unmatchedCodes++;
    }

    return {
      referralCodes,
      totals: {
        subscriptions: totalSubscriptions,
        uniqueCustomers: uniqueCustomerEmails.size,
        totalRevenue,
        matchedCodes,
        unmatchedCodes,
      },
    };
  }

  /**
   * Execute Stripe import with partner assignments.
   */
  async executeStripeImport(
    projectId: string,
    stripeService: StripeService,
    assignments: StripeImportAssignment[],
    filters: StripeImportFilters = {},
  ): Promise<ImportResult> {
    const result: ImportResult = {
      created: { partners: 0, customers: 0, commissions: 0 },
      skipped: [],
      errors: [],
    };

    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) throw new Error("Stripe API key not found");

    const mappings = await stripeService.getMetadataMappings(projectId);
    const syncService = new StripeSyncService(this.db, stripeService);

    // Build assignment map
    const assignmentMap = new Map<string, StripeImportAssignment>();
    for (const a of assignments) {
      assignmentMap.set(a.referralCode.toUpperCase(), a);
    }

    // Fetch subscriptions again
    const subs = await syncService.fetchSubscriptions(apiKey, {
      status: filters.status ?? "all",
      createdAfter: filters.createdAfter ? Math.floor(new Date(filters.createdAfter).getTime() / 1000) : undefined,
      createdBefore: filters.createdBefore ? Math.floor(new Date(filters.createdBefore).getTime() / 1000) : undefined,
    });

    // Load existing customers for dedup
    const existingCustomers = await this.db
      .select()
      .from(customers)
      .where(eq(customers.projectId, projectId));
    const customerEmailSet = new Set(existingCustomers.map((c) => c.email.toLowerCase()));

    let rowIdx = 0;
    for (const sub of subs) {
      const refCode = this.extractReferralCode(sub.metadata, mappings);
      if (!refCode) continue;

      const assignment = assignmentMap.get(refCode.toUpperCase());
      if (!assignment || assignment.action === "skip") {
        result.skipped.push({ row: rowIdx++, reason: "Skipped by user", type: "customer" });
        continue;
      }

      const partnerId = assignment.partnerId;

      // Get customer info from Stripe
      const info = await syncService.getCustomerInfo(apiKey, sub.customer);
      if (!info.email) {
        result.skipped.push({ row: rowIdx++, reason: "Customer has no email in Stripe", type: "customer" });
        continue;
      }

      const email = info.email.toLowerCase();
      if (customerEmailSet.has(email)) {
        result.skipped.push({ row: rowIdx++, reason: "Customer already exists", type: "customer" });
        rowIdx++;
        continue;
      }

      try {
        const unitAmount = sub.items?.data?.[0]?.price?.unit_amount ?? 0;
        const revenue = unitAmount / 100;

        // Create customer
        const customerId = crypto.randomUUID();
        await this.db.insert(customers).values({
          id: customerId,
          projectId,
          partnerId,
          email,
          name: info.name ?? null,
          stripeCustomerId: sub.customer,
          revenue,
          status: sub.status === "active" ? "paid" : sub.status === "canceled" ? "cancelled" : "trialing",
        });
        customerEmailSet.add(email);
        result.created.customers++;

        // Create commission
        const partner = (await this.db.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
        if (partner) {
          const commissionAmount = revenue * partner.commissionRate;
          const commissionId = crypto.randomUUID();
          await this.db.insert(commissions).values({
            id: commissionId,
            partnerId,
            customerId,
            projectId,
            amount: commissionAmount,
            rate: partner.commissionRate,
            status: "pending",
            externalEventId: `stripe_import_${sub.id}`,
          });
          result.created.commissions++;

          // Update partner aggregates
          await this.db
            .update(partners)
            .set({
              referredCustomers: partner.referredCustomers + 1,
              totalRevenue: partner.totalRevenue + revenue,
            })
            .where(eq(partners.id, partnerId));
        }
      } catch (err) {
        result.errors.push({
          row: rowIdx,
          error: err instanceof Error ? err.message : "Unknown error",
          type: "customer",
        });
      }
      rowIdx++;
    }

    return result;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

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

  private async generateReferralCode(): Promise<string> {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code: string;
    let attempts = 0;

    do {
      code = Array.from({ length: 8 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length)),
      ).join("");
      attempts++;

      const existing = await this.db
        .select()
        .from(partners)
        .where(eq(partners.referralCode, code))
        .limit(1);

      if (existing.length === 0) return code;
    } while (attempts < 10);

    // Fallback: use UUID prefix
    return crypto.randomUUID().slice(0, 8).toUpperCase();
  }
}
