import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { partners, customers, syncLogs } from "../db";
import { StripeService } from "./stripe-service";
import { CommissionService } from "./commission-service";

interface StripeCharge {
  id: string;
  amount: number; // in cents
  currency: string;
  customer: string | null;
  status: string;
  created: number; // unix timestamp
  metadata?: Record<string, string>;
}

interface StripeCustomer {
  id: string;
  email: string | null;
}

export class StripeSyncService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private stripeService: StripeService,
  ) {}

  /**
   * Sync a single project: fetch new Stripe charges, match to referrals, create commissions.
   */
  async syncProject(projectId: string): Promise<{
    processedCount: number;
    error?: string;
  }> {
    const logId = crypto.randomUUID();
    const startedAt = new Date();

    // Record sync start
    await this.db.insert(syncLogs).values({
      id: logId,
      projectId,
      source: "stripe",
      status: "success",
      processedCount: 0,
      startedAt,
    });

    await this.stripeService.updateSyncStatus(projectId, "syncing");

    try {
      const apiKey = await this.stripeService.getDecryptedKey(projectId);
      if (!apiKey) {
        throw new Error("Stripe API key not found");
      }

      const conn = await this.stripeService.getConnection(projectId);
      const sinceTimestamp = conn?.lastSyncAt
        ? Math.floor(conn.lastSyncAt.getTime() / 1000)
        : Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000); // default: last 30 days

      // Fetch charges from Stripe
      const charges = await this.fetchCharges(apiKey, sinceTimestamp);

      // Get all partners for this project (to match referrals)
      const projectPartners = await this.db
        .select()
        .from(partners)
        .where(eq(partners.projectId, projectId));

      if (projectPartners.length === 0) {
        await this.finalizeSyncLog(logId, 0, "success");
        await this.stripeService.updateSyncStatus(projectId, "idle", undefined, new Date());
        return { processedCount: 0 };
      }

      const commissionService = new CommissionService(this.db);
      let processedCount = 0;

      for (const charge of charges) {
        if (charge.status !== "succeeded" || !charge.customer) continue;

        // Get customer email from Stripe
        const email = await this.getCustomerEmail(apiKey, charge.customer);
        if (!email) continue;

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

        // If customer exists, they're already attributed — check for new revenue
        if (existingCustomers[0]) {
          // For simplicity, skip already-tracked customers to avoid double-counting.
          // A more sophisticated approach would track individual charge IDs.
          continue;
        }

        // Try to match via referral: check if charge metadata has a ref code,
        // or fall back to checking the cookie-based attribution
        const refCode = charge.metadata?.ref || charge.metadata?.referral_code;
        const matchedPartner = refCode
          ? projectPartners.find(
              (p) => p.referralCode.toUpperCase() === refCode.toUpperCase(),
            )
          : undefined;

        // If no metadata match, skip — we can't attribute without a referral
        if (!matchedPartner) continue;

        const revenueInDollars = charge.amount / 100;

        await commissionService.recordConversion({
          partnerId: matchedPartner.id,
          projectId,
          customerEmail: email.toLowerCase(),
          revenue: revenueInDollars,
          customerStatus: "paid",
          eventId: charge.id,
        });

        processedCount++;
      }

      await this.finalizeSyncLog(logId, processedCount, "success");
      await this.stripeService.updateSyncStatus(projectId, "idle", undefined, new Date());

      return { processedCount };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await this.finalizeSyncLog(logId, 0, "error", errorMessage);
      await this.stripeService.updateSyncStatus(projectId, "error", errorMessage);
      return { processedCount: 0, error: errorMessage };
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
        expand: "data.customer",
      });
      if (startingAfter) {
        params.set("starting_after", startingAfter);
      }

      const response = await fetch(
        `https://api.stripe.com/v1/charges?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!response.ok) {
        throw new Error(`Stripe API error: ${response.status}`);
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
   * Get a Stripe customer's email.
   */
  private async getCustomerEmail(
    apiKey: string,
    customerId: string,
  ): Promise<string | null> {
    const response = await fetch(
      `https://api.stripe.com/v1/customers/${customerId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) return null;

    const customer = (await response.json()) as StripeCustomer;
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
}
