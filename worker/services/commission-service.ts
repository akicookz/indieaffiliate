import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import {
  commissions,
  commissionAdjustments,
  commissionPrograms,
  customers,
  partners,
  projectBranding,
  projects,
  type CommissionProgramRow,
  type CommissionRow,
  type NewCommissionRow,
} from "../db";
import { FraudService } from "./fraud-service";
import { roundToCents } from "../money";

interface CommissionSnapshot {
  amount: number;
  rate: number;
  commissionProgramId: string | null;
  monthIndex: number | null;
  mrr: number | null;
  shouldCreate: boolean;
  skipReason?: string;
}

export class CommissionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  private async getActiveProgram(
    projectId: string,
    programId: string,
  ): Promise<CommissionProgramRow | null> {
    const rows = await this.db
      .select()
      .from(commissionPrograms)
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          eq(commissionPrograms.id, programId),
          isNull(commissionPrograms.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async getProgram(
    projectId: string,
    programId: string,
  ): Promise<CommissionProgramRow | null> {
    const rows = await this.db
      .select()
      .from(commissionPrograms)
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          eq(commissionPrograms.id, programId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async getDefaultProgram(
    projectId: string,
  ): Promise<CommissionProgramRow | null> {
    const rows = await this.db
      .select({
        defaultProgramId: projectBranding.defaultCommissionProgramId,
      })
      .from(projectBranding)
      .where(eq(projectBranding.projectId, projectId))
      .limit(1);
    const defaultProgramId = rows[0]?.defaultProgramId;
    if (!defaultProgramId) return null;
    return this.getActiveProgram(projectId, defaultProgramId);
  }

  async calculateCommissionSnapshot(data: {
    partnerId: string;
    projectId: string;
    customerId?: string;
    revenue: number;
    commissionProgramId?: string | null;
    rate?: number;
    commissionAmount?: number;
    monthIndex?: number | null;
    mrr?: number | null;
  }): Promise<CommissionSnapshot> {
    const partnerRows = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, data.partnerId))
      .limit(1);
    const partner = partnerRows[0];
    if (!partner) throw new Error("Partner not found");

    let programId =
      data.commissionProgramId !== undefined
        ? data.commissionProgramId
        : partner.commissionProgramId ?? null;
    let program = programId ? await this.getProgram(data.projectId, programId) : null;

    if (data.commissionProgramId === undefined && !programId) {
      program = await this.getDefaultProgram(data.projectId);
      programId = program?.id ?? null;
    }

    const rate =
      data.rate ?? (program ? program.rate / 100 : partner.commissionRate);
    const amount = roundToCents(
      data.commissionAmount ??
        (program?.type === "one-time" && program.flatAmount != null
          ? program.flatAmount
          : data.revenue * rate),
    );

    let monthIndex = data.monthIndex ?? null;
    let priorCount = 0;
    if (data.customerId) {
      const baseConditions = [
        eq(commissions.partnerId, data.partnerId),
        eq(commissions.customerId, data.customerId),
        sql`${commissions.status} != 'rejected'`,
      ];
      const countRows = await this.db
        .select({ c: sql<number>`count(*)` })
        .from(commissions)
        .where(
          programId
            ? and(
                ...baseConditions,
                eq(commissions.commissionProgramId, programId),
              )
            : and(...baseConditions),
        );
      priorCount = countRows[0]?.c ?? 0;
      if (monthIndex == null) {
        monthIndex = priorCount + 1;
      }
    }

    if (program?.type === "one-time" && priorCount > 0) {
      return {
        amount,
        rate,
        commissionProgramId: programId,
        monthIndex,
        mrr: data.mrr ?? (program.flatAmount != null ? data.revenue : null),
        shouldCreate: false,
        skipReason: "one-time commission already exists",
      };
    }

    if (
      program?.type === "recurring" &&
      program.durationMonths != null &&
      monthIndex != null &&
      monthIndex > program.durationMonths
    ) {
      return {
        amount,
        rate,
        commissionProgramId: programId,
        monthIndex,
        mrr: data.mrr ?? null,
        shouldCreate: false,
        skipReason: "recurring duration completed",
      };
    }

    return {
      amount,
      rate,
      commissionProgramId: programId,
      monthIndex,
      mrr:
        data.mrr ??
        (program?.type === "one-time" && program.flatAmount != null
          ? data.revenue
          : null),
      shouldCreate: true,
    };
  }

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
    mrr?: number;
    // Caller-supplied snapshot fields. If `monthIndex` is provided, we use it
    // as-is; otherwise we fall back to counting prior commissions (legacy
    // behaviour for the public conversion API and full-history backfills).
    monthIndex?: number;
    commissionProgramId?: string | null;
    rate?: number;
    commissionAmount?: number;
    // Force the commission status. Used by approve/deny on derived payouts so
    // the row materialises in its final state instead of pending review.
    forceStatus?: "pending" | "approved" | "paid" | "rejected";
    // Caller-supplied fraud/denial reason (e.g. "denied_by_owner"). Slots
    // straight into the fraudFlag column without going through auto-detection.
    forceFraudFlag?: string;
  }): Promise<{
    customerId: string;
    commissionId: string;
    commissionAmount: number;
    conversionCreated: boolean;
    isDuplicate?: boolean;
    skipReason?: string;
  }> {
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
          conversionCreated: false,
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
          conversionCreated: false,
          skipReason: "customer is blocked from commission creation",
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

    const snapshot = await this.calculateCommissionSnapshot({
      partnerId: data.partnerId,
      projectId: data.projectId,
      customerId,
      revenue: data.revenue,
      commissionProgramId: data.commissionProgramId,
      rate: data.rate,
      commissionAmount: data.commissionAmount,
      monthIndex: data.monthIndex,
      mrr: data.mrr ?? null,
    });

    if (!snapshot.shouldCreate) {
      return {
        customerId,
        commissionId: "",
        commissionAmount: snapshot.amount,
        conversionCreated: false,
        skipReason: snapshot.skipReason,
      };
    }

    // Caller-supplied fraud flag wins (used for denials).
    if (data.forceFraudFlag) fraudFlag = data.forceFraudFlag;

    // Status precedence: caller-forced > fraud-detected > default pending.
    // Forced status from a privileged action (approve/deny) overrides fraud
    // flags so denials land as "rejected" with the right reason.
    const commissionStatus: "pending" | "approved" | "paid" | "rejected" =
      data.forceStatus ?? (fraudFlag ? "rejected" : "pending");

    // Insert commission record
    const commissionId = crypto.randomUUID();
    const commissionRow: NewCommissionRow = {
      id: commissionId,
      partnerId: data.partnerId,
      customerId,
      projectId: data.projectId,
      amount: snapshot.amount,
      rate: snapshot.rate,
      status: commissionStatus,
      externalEventId: data.eventId ?? null,
      eventDate: data.eventDate ?? null,
      fraudFlag,
      commissionProgramId: snapshot.commissionProgramId,
      monthIndex: snapshot.monthIndex,
      mrr: snapshot.mrr,
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

    return {
      customerId,
      commissionId,
      commissionAmount: snapshot.amount,
      conversionCreated: true,
    };
  }

  /**
   * Get commissions for a user's projects, with optional filters.
   */
  async getCommissionsByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<(CommissionRow & {
    partnerName: string;
    partnerEmail: string;
    customerEmail: string;
    projectName: string;
    partnerPayoutLink: string | null;
    programName: string | null;
    programType: "recurring" | "lifetime" | "one-time" | null;
    durationMonths: number | null;
    monthsRemaining: number | null;
    programMinPayout: number | null;
    payoutCadence: string | null;
    payoutDayOfMonth: number | null;
    payoutDayOfWeek: number | null;
    payoutOrdinal: number | null;
  })[]> {
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
          .select({
            id: partners.id,
            name: partners.name,
            email: partners.email,
            payoutLink: partners.payoutLink,
          })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p]));

    const customerRows = customerIds.length > 0
      ? await this.db
          .select({ id: customers.id, email: customers.email })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : [];
    const customerMap = new Map(customerRows.map((c) => [c.id, c.email]));

    const programIds = [
      ...new Set(
        rows
          .map((r) => r.commissionProgramId)
          .filter((id): id is string => !!id),
      ),
    ];
    const programRows = programIds.length > 0
      ? await this.db
          .select({
            id: commissionPrograms.id,
            name: commissionPrograms.name,
            type: commissionPrograms.type,
            durationMonths: commissionPrograms.durationMonths,
            minPayout: commissionPrograms.minPayout,
            payoutCadence: commissionPrograms.payoutCadence,
            payoutDayOfMonth: commissionPrograms.payoutDayOfMonth,
            payoutDayOfWeek: commissionPrograms.payoutDayOfWeek,
            payoutOrdinal: commissionPrograms.payoutOrdinal,
          })
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, programIds))
      : [];
    const programMap = new Map(programRows.map((p) => [p.id, p]));

    return rows.map((row) => {
      const program = row.commissionProgramId
        ? programMap.get(row.commissionProgramId) ?? null
        : null;
      const monthsRemaining =
        program?.type === "recurring" &&
        program.durationMonths != null &&
        row.monthIndex != null
          ? Math.max(0, program.durationMonths - row.monthIndex)
          : null;
      return {
        ...row,
        partnerName: partnerMap.get(row.partnerId)?.name ?? "Unknown",
        partnerEmail: partnerMap.get(row.partnerId)?.email ?? "",
        customerEmail: customerMap.get(row.customerId) ?? "Unknown",
        projectName: projectMap.get(row.projectId) ?? "Unknown",
        partnerPayoutLink: partnerMap.get(row.partnerId)?.payoutLink ?? null,
        programName: program?.name ?? null,
        programType:
          (program?.type as "recurring" | "lifetime" | "one-time" | null) ??
          null,
        durationMonths: program?.durationMonths ?? null,
        monthsRemaining,
        programMinPayout: program?.minPayout ?? null,
        payoutCadence: program?.payoutCadence ?? null,
        payoutDayOfMonth: program?.payoutDayOfMonth ?? null,
        payoutDayOfWeek: program?.payoutDayOfWeek ?? null,
        payoutOrdinal: program?.payoutOrdinal ?? null,
      };
    });
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

    const ownedProjectIds = userProjects.map((p) => p.id);
    const projectIds =
      projectId && projectId !== "all"
        ? ownedProjectIds.filter((id) => id === projectId)
        : ownedProjectIds;

    if (projectIds.length === 0) {
      return { totalCommissions: 0, pendingAmount: 0, approvedAmount: 0, paidAmount: 0 };
    }

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

    const ownedProjectIds = userProjects.map((p) => p.id);
    const projectIds =
      filters?.projectId && filters.projectId !== "all"
        ? ownedProjectIds.filter((id) => id === filters.projectId)
        : ownedProjectIds;
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    if (projectIds.length === 0) {
      return { partners: [], totals: { pendingAmount: 0, approvedAmount: 0, paidAmount: 0 } };
    }

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

    // Clawback adjustments for these commissions (queued/dismissed/applied), so
    // a commission that's already been handled doesn't re-surface as "needed".
    const adjustmentRows = await this.db
      .select({
        commissionId: commissionAdjustments.commissionId,
        status: commissionAdjustments.status,
        amount: commissionAdjustments.amount,
      })
      .from(commissionAdjustments)
      .where(
        inArray(
          commissionAdjustments.commissionId,
          rows.map((r) => r.id),
        ),
      );
    const adjustmentMap = new Map(adjustmentRows.map((a) => [a.commissionId, a]));

    // Fetch program info to surface programType + durationMonths so the FE
    // can render "Month X of N · {remaining} left" on each commission row.
    const programIds = [
      ...new Set(
        rows
          .map((r) => r.commissionProgramId)
          .filter((id): id is string => !!id),
      ),
    ];
    const programRows = programIds.length > 0
      ? await this.db
          .select({
            id: commissionPrograms.id,
            name: commissionPrograms.name,
            type: commissionPrograms.type,
            durationMonths: commissionPrograms.durationMonths,
            minPayout: commissionPrograms.minPayout,
            payoutCadence: commissionPrograms.payoutCadence,
            payoutDayOfMonth: commissionPrograms.payoutDayOfMonth,
            payoutDayOfWeek: commissionPrograms.payoutDayOfWeek,
            payoutOrdinal: commissionPrograms.payoutOrdinal,
          })
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, programIds))
      : [];
    const programMap = new Map(programRows.map((p) => [p.id, p]));

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

      // Decision context: how much value this partner drove and what's at risk.
      const seenCustomers = new Set<string>();
      let referredRevenue = 0;
      let atRiskAmount = 0;
      let pendingClawback = 0;

      for (const c of partnerCommissions) {
        if (c.status === "pending" && !c.fraudFlag) { pendingAmount += c.amount; pendingCount++; }
        if (c.status === "approved") { approvedAmount += c.amount; approvedCount++; }
        if (c.status === "paid") { paidAmount += c.amount; paidCount++; }
        if (c.status === "rejected") { rejectedAmount += c.amount; rejectedCount++; }

        if (c.customerId && !seenCustomers.has(c.customerId)) {
          seenCustomers.add(c.customerId);
          referredRevenue += customerMap.get(c.customerId)?.revenue ?? 0;
        }
        const adj = adjustmentMap.get(c.id);
        if (adj?.status === "pending") {
          // Already queued — will be netted from the next payout.
          pendingClawback += adj.amount;
        } else if (
          !adj &&
          c.status === "paid" &&
          customerMap.get(c.customerId)?.status === "refunded"
        ) {
          // Needs owner action: paid, then refunded, not yet handled.
          atRiskAmount += c.amount;
        }
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
        customerCount: seenCustomers.size,
        referredRevenue,
        atRiskAmount,
        pendingClawback,
        commissions: partnerCommissions.map((c) => {
          const customer = customerMap.get(c.customerId);
          const adj = adjustmentMap.get(c.id);
          const clawbackState: "needed" | "queued" | "dismissed" | "applied" | null =
            adj
              ? adj.status === "pending"
                ? "queued"
                : (adj.status as "applied" | "dismissed")
              : c.status === "paid" && customer?.status === "refunded"
                ? "needed"
                : null;
          const clawbackNeeded = clawbackState === "needed";
          const program = c.commissionProgramId
            ? programMap.get(c.commissionProgramId) ?? null
            : null;
          const monthsRemaining =
            program?.type === "recurring" &&
            program.durationMonths != null &&
            c.monthIndex != null
              ? Math.max(0, program.durationMonths - c.monthIndex)
              : null;
          return {
            id: c.id,
            customerId: c.customerId,
            customerEmail: customer?.email ?? "Unknown",
            customerStatus: customer?.status ?? null,
            customerRevenue: customer?.revenue ?? 0,
            clawbackNeeded,
            clawbackState,
            amount: c.amount,
            rate: c.rate,
            status: c.status,
            fraudFlag: c.fraudFlag,
            externalEventId: c.externalEventId,
            projectName: projectMap.get(c.projectId) ?? "Unknown",
            eventDate: c.eventDate,
            createdAt: c.createdAt,
            monthIndex: c.monthIndex,
            durationMonths: program?.durationMonths ?? null,
            monthsRemaining,
            programType:
              (program?.type as "recurring" | "lifetime" | "one-time" | null) ??
              null,
            programName: program?.name ?? null,
            programMinPayout: program?.minPayout ?? null,
            payoutCadence: program?.payoutCadence ?? null,
            payoutDayOfMonth: program?.payoutDayOfMonth ?? null,
            payoutDayOfWeek: program?.payoutDayOfWeek ?? null,
            payoutOrdinal: program?.payoutOrdinal ?? null,
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
   * Mark linked commissions paid, but only those currently `approved`. Prevents
   * a payout status flip from resurrecting rejected/fraud commissions to paid.
   */
  async markApprovedCommissionsPaid(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.db
      .update(commissions)
      .set({ status: "paid" })
      .where(and(inArray(commissions.id, ids), eq(commissions.status, "approved")));
    return ids.length;
  }

  /**
   * Revert linked commissions from `paid` back to `approved` (e.g. a payout that
   * bounced). Only touches paid rows, so rejected/fraud commissions stay rejected.
   */
  async revertPaidCommissionsToApproved(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.db
      .update(commissions)
      .set({ status: "approved" })
      .where(and(inArray(commissions.id, ids), eq(commissions.status, "paid")));
    return ids.length;
  }

  /**
   * Clawback: void the not-yet-paid commission for a refunded charge/invoice.
   * Only pending/approved commissions are voided — already-paid money must be
   * recovered manually. The 30-day hold means most refunds land before payout.
   */
  async voidCommissionForRefund(
    projectId: string,
    externalEventId: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .update(commissions)
      .set({ status: "rejected", fraudFlag: reason })
      .where(
        and(
          eq(commissions.projectId, projectId),
          eq(commissions.externalEventId, externalEventId),
          inArray(commissions.status, ["pending", "approved"]),
        ),
      );
  }

  /**
   * Record a clawback on a paid commission whose customer was refunded.
   * `deduct` queues a pending adjustment (netted against the partner's next
   * payout); `dismiss` records a zero-amount dismissal (recovered elsewhere).
   * Verifies project ownership. One adjustment per commission (unique index).
   */
  async recordClawback(
    commissionId: string,
    userId: string,
    action: "deduct" | "dismiss",
  ): Promise<{ ok: boolean; error?: string }> {
    const rows = await this.db
      .select({
        projectId: commissions.projectId,
        partnerId: commissions.partnerId,
        amount: commissions.amount,
        status: commissions.status,
        ownerId: projects.userId,
      })
      .from(commissions)
      .innerJoin(projects, eq(projects.id, commissions.projectId))
      .where(eq(commissions.id, commissionId))
      .limit(1);
    const commission = rows[0];
    if (!commission || commission.ownerId !== userId) {
      return { ok: false, error: "Commission not found" };
    }
    if (commission.status !== "paid") {
      return { ok: false, error: "Only paid commissions can be clawed back" };
    }

    const existing = await this.db
      .select({ id: commissionAdjustments.id })
      .from(commissionAdjustments)
      .where(eq(commissionAdjustments.commissionId, commissionId))
      .limit(1);
    if (existing[0]) {
      return { ok: false, error: "This commission already has an adjustment" };
    }

    await this.db.insert(commissionAdjustments).values({
      id: crypto.randomUUID(),
      projectId: commission.projectId,
      partnerId: commission.partnerId,
      commissionId,
      amount: action === "deduct" ? roundToCents(commission.amount) : 0,
      reason: "refund",
      status: action === "deduct" ? "pending" : "dismissed",
    });
    return { ok: true };
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
