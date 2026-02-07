import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  commissions,
  customers,
  partners,
  projects,
  type CommissionRow,
  type NewCommissionRow,
} from "../db";
import { FraudService } from "./fraud-service";

export class CommissionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Record a conversion: create/update customer, calculate commission, update partner counters.
   * Includes fraud detection: idempotency, self-referral, revenue cap, velocity, customer reuse, geo mismatch.
   */
  async recordConversion(data: {
    partnerId: string;
    projectId: string;
    customerEmail: string;
    revenue: number;
    customerStatus?: "trialing" | "paid" | "cancelled";
    eventId?: string;
    eventDate?: Date;
    conversionCountry?: string;
  }): Promise<{ customerId: string; commissionId: string; commissionAmount: number; isDuplicate?: boolean }> {
    const fraudService = new FraudService(this.db);

    // ─── Idempotency check ────────────────────────────────────────────────
    if (data.eventId) {
      const existing = await fraudService.checkDuplicateCommission(
        data.projectId,
        data.eventId,
      );
      if (existing) {
        return {
          customerId: existing.customerId,
          commissionId: existing.commissionId,
          commissionAmount: existing.commissionAmount,
          isDuplicate: true,
        };
      }
    }

    // Get partner to snapshot commission rate + email for fraud checks
    const partnerRows = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, data.partnerId))
      .limit(1);
    const partner = partnerRows[0];
    if (!partner) throw new Error("Partner not found");

    // ─── Pre-insert fraud checks ──────────────────────────────────────────
    let fraudFlag: string | null = null;

    // Self-referral check
    const selfReferralResult = fraudService.checkSelfReferral(
      partner.email,
      data.customerEmail,
    );
    if (selfReferralResult) {
      fraudFlag = "self_referral";
    }

    // Revenue cap check
    if (!fraudFlag) {
      const revenueCapResult = fraudService.checkRevenueCap(data.revenue);
      if (revenueCapResult) {
        fraudFlag = "revenue_cap";
      }
    }

    // Upsert customer (find by email + project, or create)
    const existingCustomer = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.projectId, data.projectId),
          eq(customers.email, data.customerEmail),
        ),
      )
      .limit(1);

    let customerId: string;
    const status = data.customerStatus ?? "paid";

    if (existingCustomer[0]) {
      customerId = existingCustomer[0].id;

      // If customer is flagged, skip commission creation entirely
      if (existingCustomer[0].flagReason || existingCustomer[0].isSelfReferral) {
        // Still update the customer revenue/status for tracking accuracy
        await this.db
          .update(customers)
          .set({
            revenue: sql`${customers.revenue} + ${data.revenue}`,
            status,
          })
          .where(eq(customers.id, customerId));
        return {
          customerId,
          commissionId: "",
          commissionAmount: 0,
          isDuplicate: true, // signal to caller that no commission was created
        };
      }

      // Update revenue (add to existing)
      await this.db
        .update(customers)
        .set({
          revenue: sql`${customers.revenue} + ${data.revenue}`,
          status,
        })
        .where(eq(customers.id, customerId));
    } else {
      customerId = crypto.randomUUID();
      await this.db.insert(customers).values({
        id: customerId,
        projectId: data.projectId,
        partnerId: data.partnerId,
        email: data.customerEmail,
        revenue: data.revenue,
        status,
      });
    }

    // Calculate commission
    const commissionAmount = data.revenue * partner.commissionRate;

    // Insert commission record
    const commissionId = crypto.randomUUID();
    const commissionRow: NewCommissionRow = {
      id: commissionId,
      partnerId: data.partnerId,
      customerId,
      projectId: data.projectId,
      amount: commissionAmount,
      rate: partner.commissionRate,
      status: fraudFlag ? "rejected" : "pending",
      externalEventId: data.eventId ?? null,
      eventDate: data.eventDate ?? null,
      fraudFlag,
    };
    await this.db.insert(commissions).values(commissionRow);

    // Update partner counters
    const isNewCustomer = !existingCustomer[0];
    if (isNewCustomer) {
      await this.db
        .update(partners)
        .set({
          totalRevenue: sql`${partners.totalRevenue} + ${data.revenue}`,
          referredCustomers: sql`${partners.referredCustomers} + 1`,
        })
        .where(eq(partners.id, data.partnerId));
    } else {
      await this.db
        .update(partners)
        .set({
          totalRevenue: sql`${partners.totalRevenue} + ${data.revenue}`,
        })
        .where(eq(partners.id, data.partnerId));
    }

    // ─── Post-insert fraud checks (create flags) ──────────────────────────
    if (selfReferralResult) {
      await fraudService.createFlag({
        projectId: data.projectId,
        partnerId: data.partnerId,
        type: selfReferralResult.type,
        severity: selfReferralResult.severity,
        details: selfReferralResult.details,
        relatedCommissionId: commissionId,
      });
    }

    const revenueCapResult = fraudService.checkRevenueCap(data.revenue);
    if (revenueCapResult) {
      await fraudService.createFlag({
        projectId: data.projectId,
        partnerId: data.partnerId,
        type: revenueCapResult.type,
        severity: revenueCapResult.severity,
        details: revenueCapResult.details,
        relatedCommissionId: commissionId,
      });
    }

    // Velocity spike check
    const velocityResult = await fraudService.checkVelocitySpike(
      data.partnerId,
      data.projectId,
    );
    if (velocityResult) {
      await fraudService.createFlag({
        projectId: data.projectId,
        partnerId: data.partnerId,
        type: velocityResult.type,
        severity: velocityResult.severity,
        details: velocityResult.details,
        relatedCommissionId: commissionId,
      });
    }

    // Customer reuse check
    const reuseResult = await fraudService.checkCustomerReuse(
      data.customerEmail,
      data.partnerId,
    );
    if (reuseResult) {
      await fraudService.createFlag({
        projectId: data.projectId,
        partnerId: data.partnerId,
        type: reuseResult.type,
        severity: reuseResult.severity,
        details: reuseResult.details,
        relatedCommissionId: commissionId,
      });
    }

    // Geo mismatch check
    if (data.conversionCountry) {
      const geoResult = await fraudService.checkGeoMismatch(
        data.partnerId,
        data.projectId,
        data.conversionCountry,
      );
      if (geoResult) {
        await fraudService.createFlag({
          projectId: data.projectId,
          partnerId: data.partnerId,
          type: geoResult.type,
          severity: geoResult.severity,
          details: geoResult.details,
          relatedCommissionId: commissionId,
        });
      }
    }

    return { customerId, commissionId, commissionAmount };
  }

  /**
   * Get commissions for a user's projects, with optional filters.
   */
  async getCommissionsByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<(CommissionRow & { partnerName: string; partnerEmail: string; customerEmail: string; projectName: string })[]> {
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return [];

    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(commissions.projectId, projectIds)];

    if (filters?.projectId && filters.projectId !== "all") {
      conditions.push(eq(commissions.projectId, filters.projectId));
    }
    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(commissions.status, filters.status as "pending" | "approved" | "paid" | "rejected"),
      );
    }

    const rows = await this.db
      .select()
      .from(commissions)
      .where(and(...conditions));

    // Fetch partner and customer names
    const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
    const customerIds = [...new Set(rows.map((r) => r.customerId))];

    const partnerRows = partnerIds.length > 0
      ? await this.db
          .select({ id: partners.id, name: partners.name, email: partners.email })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, { name: p.name, email: p.email }]));

    const customerRows = customerIds.length > 0
      ? await this.db
          .select({ id: customers.id, email: customers.email })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : [];
    const customerMap = new Map(customerRows.map((c) => [c.id, c.email]));

    return rows.map((row) => ({
      ...row,
      partnerName: partnerMap.get(row.partnerId)?.name ?? "Unknown",
      partnerEmail: partnerMap.get(row.partnerId)?.email ?? "",
      customerEmail: customerMap.get(row.customerId) ?? "Unknown",
      projectName: projectMap.get(row.projectId) ?? "Unknown",
    }));
  }

  /**
   * Get commission stats for a user.
   */
  async getCommissionStats(userId: string, projectId?: string) {
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { totalCommissions: 0, pendingAmount: 0, approvedAmount: 0, paidAmount: 0 };
    }

    const projectIds = projectId && projectId !== "all"
      ? [projectId]
      : userProjects.map((p) => p.id);

    const stats = await this.db
      .select({
        total: sql<number>`count(*)`,
        pending: sql<number>`coalesce(sum(case when ${commissions.status} = 'pending' then ${commissions.amount} else 0 end), 0)`,
        approved: sql<number>`coalesce(sum(case when ${commissions.status} = 'approved' then ${commissions.amount} else 0 end), 0)`,
        paid: sql<number>`coalesce(sum(case when ${commissions.status} = 'paid' then ${commissions.amount} else 0 end), 0)`,
      })
      .from(commissions)
      .where(inArray(commissions.projectId, projectIds));

    const row = stats[0];
    return {
      totalCommissions: row?.total ?? 0,
      pendingAmount: row?.pending ?? 0,
      approvedAmount: row?.approved ?? 0,
      paidAmount: row?.paid ?? 0,
    };
  }

  /**
   * Get commissions grouped by partner for a user's projects.
   * Each partner entry includes aggregated totals and their individual commissions.
   */
  async getCommissionsGroupedByPartner(
    userId: string,
    filters?: { projectId?: string },
  ) {
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { partners: [], totals: { pendingAmount: 0, approvedAmount: 0, paidAmount: 0 } };
    }

    const projectIds =
      filters?.projectId && filters.projectId !== "all"
        ? [filters.projectId]
        : userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(commissions.projectId, projectIds)];

    const rows = await this.db
      .select()
      .from(commissions)
      .where(and(...conditions));

    if (rows.length === 0) {
      return { partners: [], totals: { pendingAmount: 0, approvedAmount: 0, paidAmount: 0 } };
    }

    // Fetch partner info
    const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
    const partnerRows = await this.db
      .select({
        id: partners.id,
        name: partners.name,
        email: partners.email,
        payoutLink: partners.payoutLink,
        commissionRate: partners.commissionRate,
      })
      .from(partners)
      .where(inArray(partners.id, partnerIds));
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p]));

    // Fetch customer info (email, subscription status, revenue)
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const customerRows = customerIds.length > 0
      ? await this.db
          .select({
            id: customers.id,
            email: customers.email,
            status: customers.status,
            revenue: customers.revenue,
          })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : [];
    const customerMap = new Map(customerRows.map((c) => [c.id, c]));

    // Group commissions by partner
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const existing = grouped.get(row.partnerId) ?? [];
      existing.push(row);
      grouped.set(row.partnerId, existing);
    }

    let totalPending = 0;
    let totalApproved = 0;
    let totalPaid = 0;

    const partnerResults = Array.from(grouped.entries()).map(([partnerId, partnerCommissions]) => {
      const partner = partnerMap.get(partnerId);
      let pendingAmount = 0;
      let pendingCount = 0;
      let approvedAmount = 0;
      let approvedCount = 0;
      let paidAmount = 0;
      let paidCount = 0;
      let rejectedAmount = 0;
      let rejectedCount = 0;

      for (const c of partnerCommissions) {
        if (c.status === "pending" && !c.fraudFlag) { pendingAmount += c.amount; pendingCount++; }
        if (c.status === "approved") { approvedAmount += c.amount; approvedCount++; }
        if (c.status === "paid") { paidAmount += c.amount; paidCount++; }
        if (c.status === "rejected") { rejectedAmount += c.amount; rejectedCount++; }
      }

      totalPending += pendingAmount;
      totalApproved += approvedAmount;
      totalPaid += paidAmount;

      return {
        partnerId,
        partnerName: partner?.name ?? "Unknown",
        partnerEmail: partner?.email ?? "",
        payoutLink: partner?.payoutLink ?? null,
        pendingCount,
        pendingAmount,
        approvedCount,
        approvedAmount,
        paidCount,
        paidAmount,
        rejectedCount,
        rejectedAmount,
        commissions: partnerCommissions.map((c) => {
          const customer = customerMap.get(c.customerId);
          return {
            id: c.id,
            customerId: c.customerId,
            customerEmail: customer?.email ?? "Unknown",
            customerStatus: customer?.status ?? null,
            customerRevenue: customer?.revenue ?? 0,
            amount: c.amount,
            rate: c.rate,
            status: c.status,
            fraudFlag: c.fraudFlag,
            externalEventId: c.externalEventId,
            projectName: projectMap.get(c.projectId) ?? "Unknown",
            eventDate: c.eventDate,
            createdAt: c.createdAt,
          };
        }),
      };
    });

    // Sort: partners with pending first, then approved, then by amount descending
    partnerResults.sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (b.pendingCount > 0 && a.pendingCount === 0) return 1;
      if (a.approvedCount > 0 && b.approvedCount === 0) return -1;
      if (b.approvedCount > 0 && a.approvedCount === 0) return 1;
      return (b.pendingAmount + b.approvedAmount) - (a.pendingAmount + a.approvedAmount);
    });

    return {
      partners: partnerResults,
      totals: {
        pendingAmount: totalPending,
        approvedAmount: totalApproved,
        paidAmount: totalPaid,
      },
    };
  }

  /**
   * Bulk update commission statuses. Returns count of updated records.
   */
  async bulkUpdateStatus(
    ids: string[],
    status: "pending" | "approved" | "paid" | "rejected",
    fraudFlag?: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;

    const updates: { status: typeof status; fraudFlag?: string } = { status };
    if (fraudFlag) {
      updates.fraudFlag = fraudFlag;
    }

    await this.db
      .update(commissions)
      .set(updates)
      .where(inArray(commissions.id, ids));

    return ids.length;
  }

  /**
   * Flag or unflag a customer.
   * When flagging (reason is provided):
   *   - Sets flagReason on the customer (also sets isSelfReferral for backwards compat if reason is self_referral)
   *   - Auto-rejects all pending/approved commissions for that customer
   *   - Future commissions will be blocked in recordConversion()
   * When unflagging (reason is null):
   *   - Clears flagReason and isSelfReferral
   * Returns the count of commissions that were auto-rejected.
   */
  async flagCustomer(
    customerId: string,
    reason: string | null,
  ): Promise<{ commissionsRejected: number }> {
    const isSelfReferral = reason === "self_referral";

    await this.db
      .update(customers)
      .set({
        flagReason: reason,
        isSelfReferral: reason ? isSelfReferral : false,
      })
      .where(eq(customers.id, customerId));

    let commissionsRejected = 0;

    if (reason) {
      // Count pending/approved commissions before rejecting
      const pending = await this.db
        .select({ id: commissions.id })
        .from(commissions)
        .where(
          and(
            eq(commissions.customerId, customerId),
            inArray(commissions.status, ["pending", "approved"]),
          ),
        );
      commissionsRejected = pending.length;

      if (commissionsRejected > 0) {
        // Auto-reject all pending and approved commissions for this customer
        await this.db
          .update(commissions)
          .set({ status: "rejected", fraudFlag: reason })
          .where(
            and(
              eq(commissions.customerId, customerId),
              inArray(commissions.status, ["pending", "approved"]),
            ),
          );
      }
    }

    return { commissionsRejected };
  }

  /**
   * @deprecated Use flagCustomer() instead. Kept for backwards compatibility.
   */
  async setCustomerSelfReferral(
    customerId: string,
    isSelfReferral: boolean,
  ): Promise<{ commissionRejected: number }> {
    const result = await this.flagCustomer(
      customerId,
      isSelfReferral ? "self_referral" : null,
    );
    return { commissionRejected: result.commissionsRejected };
  }

  /**
   * Update a commission's status (approve, reject, mark paid).
   * Optionally set a fraud flag when rejecting.
   */
  async updateCommissionStatus(
    id: string,
    status: "pending" | "approved" | "paid" | "rejected",
    fraudFlag?: string,
  ): Promise<CommissionRow | null> {
    const updates: { status: typeof status; fraudFlag?: string } = { status };
    if (fraudFlag) {
      updates.fraudFlag = fraudFlag;
    }

    await this.db
      .update(commissions)
      .set(updates)
      .where(eq(commissions.id, id));

    const rows = await this.db
      .select()
      .from(commissions)
      .where(eq(commissions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
