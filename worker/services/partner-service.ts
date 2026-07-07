import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, desc, isNull } from "drizzle-orm";
import {
  partners,
  projects,
  customers,
  commissions,
  clicks,
  commissionPrograms,
  projectBranding,
  payouts,
  type CommissionProgramRow,
  type PartnerRow,
  type NewPartnerRow,
} from "../db";

interface PartnerCommissionProgramSummary {
  id: string;
  name: string;
  rate: number;
  type: string;
  durationMonths: number | null;
  flatAmount: number | null;
}

interface PartnerListRowWithProject extends PartnerRow {
  projectName: string;
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

export class PartnerService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getPartnersByUser(
    userId: string,
    filters?: { projectId?: string; status?: string; search?: string },
  ): Promise<PartnerListRowWithProject[]> {
    // First get user's project IDs
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return [];

    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(partners.projectId, projectIds)];

    if (filters?.projectId && filters.projectId !== "all") {
      conditions.push(eq(partners.projectId, filters.projectId));
    }
    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(partners.status, filters.status as "active" | "pending" | "inactive"),
      );
    }
    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(lower(${partners.name}) like ${term} OR lower(${partners.email}) like ${term} OR lower(${partners.referralCode}) like ${term})`,
      );
    }

    const rows = await this.db
      .select()
      .from(partners)
      .where(and(...conditions));

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

    const effectiveProgramIds = Array.from(
      new Set(
        rows
          .map(
            (row) =>
              row.commissionProgramId ??
              defaultProgramMap.get(row.projectId) ??
              null,
          )
          .filter((value): value is string => !!value),
      ),
    );
    const programRows = effectiveProgramIds.length
      ? await this.db
          .select()
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, effectiveProgramIds))
      : [];
    const programMap = new Map(
      programRows.map((program) => [program.id, summarizeProgram(program)]),
    );

    // Per-partner customer stats for the Cancel% / LTV list columns.
    const customerStats = rows.length
      ? await this.db
          .select({
            partnerId: customers.partnerId,
            total: sql<number>`count(*)`,
            churned: sql<number>`sum(case when ${customers.status} in ('cancelled','refunded') then 1 else 0 end)`,
            avgRevenue: sql<number>`coalesce(avg(${customers.revenue}), 0)`,
            avgTenureSec: sql<number>`coalesce(avg(case when ${customers.status} in ('cancelled','refunded') then (${customers.updatedAt} - ${customers.createdAt}) else (unixepoch() - ${customers.createdAt}) end), 0)`,
          })
          .from(customers)
          .where(
            inArray(
              customers.partnerId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(customers.partnerId)
      : [];
    const customerStatsMap = new Map(
      customerStats.map((s) => [s.partnerId, s]),
    );

    return rows.map((row) => {
      const cs = customerStatsMap.get(row.id);
      const cancelRate = cs && cs.total > 0 ? (cs.churned / cs.total) * 100 : 0;
      const ltvRevenue = cs?.avgRevenue ?? 0;
      const ltvMonths = (cs?.avgTenureSec ?? 0) / (30 * 24 * 3600);
      const defaultProgramId = defaultProgramMap.get(row.projectId) ?? null;
      const effectiveProgramId = row.commissionProgramId ?? defaultProgramId;
      const commissionProgram = effectiveProgramId
        ? programMap.get(effectiveProgramId) ?? null
        : null;
      return {
        ...row,
        projectName: projectMap.get(row.projectId) ?? "Unknown",
        commissionProgram,
        usesDefaultCommissionProgram:
          !row.commissionProgramId && !!defaultProgramId && !!commissionProgram,
        defaultCommissionProgramId: defaultProgramId,
        cancelRate,
        ltvRevenue,
        ltvMonths,
      };
    });
  }

  async getPartnerById(id: string): Promise<PartnerRow | null> {
    const rows = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createPartner(
    data: Omit<NewPartnerRow, "id" | "createdAt" | "updatedAt" | "referralCode" | "totalRevenue" | "referredCustomers"> & { referralCode?: string },
  ): Promise<PartnerRow> {
    const id = crypto.randomUUID();
    let referralCode = data.referralCode ?? generateReferralCode();

    // If a custom code was provided, check for uniqueness
    if (data.referralCode) {
      const existing = await this.db
        .select()
        .from(partners)
        .where(eq(partners.referralCode, referralCode))
        .limit(1);
      if (existing.length > 0) {
        // Code already taken, generate a new one
        referralCode = generateReferralCode();
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { referralCode: _rc, ...rest } = data;
    const row: NewPartnerRow = {
      id,
      referralCode,
      ...rest,
      registrationIp: rest.registrationIp ?? null,
    };
    await this.db.insert(partners).values(row);
    return (await this.getPartnerById(id))!;
  }

  async updatePartner(
    id: string,
    updates: Partial<
      Pick<
        PartnerRow,
        | "name"
        | "email"
        | "status"
        | "commissionRate"
        | "commissionProgramId"
        | "channel"
        | "payoutLink"
        | "referralCode"
      >
    >,
  ): Promise<PartnerRow | null> {
    await this.db
      .update(partners)
      .set(updates)
      .where(eq(partners.id, id));
    return this.getPartnerById(id);
  }

  /**
   * Returns the rich payload for the partner detail drawer:
   * stats, monthly MRR, attributed subscriptions, tab counts.
   */
  async getPartnerDetail(id: string): Promise<{
    partner: PartnerRow & {
      commissionProgram: (PartnerCommissionProgramSummary & {
        payoutCadence: string | null;
        payoutDayOfMonth: number | null;
        payoutDayOfWeek: number | null;
        payoutOrdinal: number | null;
      }) | null;
      usesDefaultCommissionProgram: boolean;
      defaultCommissionProgramId: string | null;
    };
    stats: {
      lifetimeEarned: number;
      customerCount: number;
      pendingPayout: number;
      conversionRate: number;
      clicks: number;
      refs: number;
      epc: number;
      cancelRate: number;
      churnedCustomers: number;
      ltvRevenue: number;
      ltvMonths: number;
    };
    monthlyMrr: { month: string; mrr: number; pending: number }[];
    subscriptions: {
      customerId: string;
      customerName: string;
      startedAt: string | null;
      mrr: number | null;
      perMoEarn: number | null;
      monthIndex: number;
      durationMonths: number | null;
      earned: number;
      total: number | null;
      programType: string | null;
    }[];
    payouts: {
      id: string;
      amount: number;
      currency: string;
      status: "scheduled" | "paid" | "failed";
      note: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      paidAt: string | null;
      createdAt: string;
    }[];
    commissions: {
      id: string;
      customerName: string;
      customerEmail: string;
      amount: number;
      rate: number;
      status: "pending" | "approved" | "paid" | "rejected";
      eventDate: string | null;
      fraudFlag: string | null;
      monthIndex: number | null;
      programName: string | null;
      programType: string | null;
    }[];
    payoutCount: number;
    commissionCount: number;
  } | null> {
    const partner = await this.getPartnerById(id);
    if (!partner) return null;

    let program: {
      id: string;
      name: string;
      rate: number;
      type: string;
      durationMonths: number | null;
      flatAmount: number | null;
      payoutCadence: string | null;
      payoutDayOfMonth: number | null;
      payoutDayOfWeek: number | null;
      payoutOrdinal: number | null;
    } | null = null;
    let usesDefaultCommissionProgram = false;
    let defaultCommissionProgramId: string | null = null;
    const brandingRows = await this.db
      .select({
        defaultCommissionProgramId:
          projectBranding.defaultCommissionProgramId,
      })
      .from(projectBranding)
      .where(eq(projectBranding.projectId, partner.projectId))
      .limit(1);
    defaultCommissionProgramId =
      brandingRows[0]?.defaultCommissionProgramId ?? null;

    if (partner.commissionProgramId) {
      const programRows = await this.db
        .select()
        .from(commissionPrograms)
        .where(eq(commissionPrograms.id, partner.commissionProgramId))
        .limit(1);
      if (programRows[0]) {
        program = {
          id: programRows[0].id,
          name: programRows[0].name,
          rate: programRows[0].rate,
          type: programRows[0].type,
          durationMonths: programRows[0].durationMonths,
          flatAmount: programRows[0].flatAmount,
          payoutCadence: programRows[0].payoutCadence,
          payoutDayOfMonth: programRows[0].payoutDayOfMonth,
          payoutDayOfWeek: programRows[0].payoutDayOfWeek,
          payoutOrdinal: programRows[0].payoutOrdinal,
        };
      }
    } else {
      if (defaultCommissionProgramId) {
        const programRows = await this.db
          .select()
          .from(commissionPrograms)
          .where(
            and(
              eq(commissionPrograms.projectId, partner.projectId),
              eq(commissionPrograms.id, defaultCommissionProgramId),
              isNull(commissionPrograms.archivedAt),
            ),
          )
          .limit(1);
        if (programRows[0]) {
          program = {
            id: programRows[0].id,
            name: programRows[0].name,
            rate: programRows[0].rate,
            type: programRows[0].type,
            durationMonths: programRows[0].durationMonths,
            flatAmount: programRows[0].flatAmount,
            payoutCadence: programRows[0].payoutCadence,
            payoutDayOfMonth: programRows[0].payoutDayOfMonth,
            payoutDayOfWeek: programRows[0].payoutDayOfWeek,
            payoutOrdinal: programRows[0].payoutOrdinal,
          };
          usesDefaultCommissionProgram = true;
        }
      }
    }

    // Stats
    const earnedRow = await this.db
      .select({
        lifetime: sql<number>`coalesce(sum(case when ${commissions.status} in ('approved','paid') then ${commissions.amount} else 0 end),0)`,
        pending: sql<number>`coalesce(sum(case when ${commissions.status} = 'approved' then ${commissions.amount} else 0 end),0)`,
        custCount: sql<number>`count(distinct ${commissions.customerId})`,
        commissionCount: sql<number>`count(*)`,
      })
      .from(commissions)
      .where(eq(commissions.partnerId, id));

    const clicksRow = await this.db
      .select({
        total: sql<number>`count(*)`,
        unique: sql<number>`coalesce(sum(case when ${clicks.isUnique} then 1 else 0 end),0)`,
      })
      .from(clicks)
      .where(eq(clicks.partnerId, id));

    // Referred-customer stats: count, churn (cancel rate), and LTV (avg revenue
    // + avg months retained). Tenure is approximate: churned customers use
    // updated_at - created_at; active customers use now - created_at.
    const refRow = await this.db
      .select({
        count: sql<number>`count(*)`,
        churned: sql<number>`sum(case when ${customers.status} in ('cancelled','refunded') then 1 else 0 end)`,
        avgRevenue: sql<number>`coalesce(avg(${customers.revenue}), 0)`,
        avgTenureSec: sql<number>`coalesce(avg(case when ${customers.status} in ('cancelled','refunded') then (${customers.updatedAt} - ${customers.createdAt}) else (unixepoch() - ${customers.createdAt}) end), 0)`,
      })
      .from(customers)
      .where(eq(customers.partnerId, id));

    const payoutRow = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(payouts)
      .where(eq(payouts.partnerId, id));

    const lifetimeEarned = earnedRow[0]?.lifetime ?? 0;
    const pendingPayout = earnedRow[0]?.pending ?? 0;
    const customerCount = earnedRow[0]?.custCount ?? 0;
    const commissionCount = earnedRow[0]?.commissionCount ?? 0;
    const totalClicks = clicksRow[0]?.unique ?? 0;
    const refs = refRow[0]?.count ?? 0;
    const churnedCustomers = refRow[0]?.churned ?? 0;
    const cancelRate = refs > 0 ? (churnedCustomers / refs) * 100 : 0;
    const ltvRevenue = refRow[0]?.avgRevenue ?? 0;
    const ltvMonths = (refRow[0]?.avgTenureSec ?? 0) / (30 * 24 * 3600);
    const conversionRate = totalClicks > 0 ? (refs / totalClicks) * 100 : 0;
    const epc = totalClicks > 0 ? lifetimeEarned / totalClicks : 0;
    const payoutCount = payoutRow[0]?.count ?? 0;

    // Monthly MRR — last 12 months of commission events
    const monthRows = await this.db
      .select({
        month: sql<string>`strftime('%Y-%m', ${commissions.eventDate}, 'unixepoch')`,
        mrr: sql<number>`coalesce(sum(${commissions.amount}),0)`,
        pending: sql<number>`coalesce(sum(case when ${commissions.status} in ('pending','approved') then ${commissions.amount} else 0 end),0)`,
      })
      .from(commissions)
      .where(
        and(
          eq(commissions.partnerId, id),
          sql`${commissions.eventDate} is not null`,
        ),
      )
      .groupBy(sql`strftime('%Y-%m', ${commissions.eventDate}, 'unixepoch')`)
      .orderBy(sql`strftime('%Y-%m', ${commissions.eventDate}, 'unixepoch')`);

    const monthlyMrr = monthRows.map((r) => ({
      month: r.month,
      mrr: r.mrr,
      pending: r.pending,
    }));

    // Subscriptions — one row per customer × program
    const subsRows = await this.db
      .select({
        customerId: commissions.customerId,
        customerName: customers.name,
        customerEmail: customers.email,
        firstEvent: sql<number | null>`min(${commissions.eventDate})`,
        mrr: sql<number | null>`max(${commissions.mrr})`,
        monthCount: sql<number>`coalesce(max(${commissions.monthIndex}), count(*))`,
        earned: sql<number>`coalesce(sum(${commissions.amount}),0)`,
        commissionProgramId: sql<string | null>`max(${commissions.commissionProgramId})`,
      })
      .from(commissions)
      .innerJoin(customers, eq(customers.id, commissions.customerId))
      .where(eq(commissions.partnerId, id))
      .groupBy(commissions.customerId)
      .orderBy(desc(sql`min(${commissions.eventDate})`));

    // Pull all referenced programs in one shot
    const subProgramIds = Array.from(
      new Set(
        subsRows.map((r) => r.commissionProgramId).filter((v): v is string => !!v),
      ),
    );
    const subProgramRows = subProgramIds.length
      ? await this.db
          .select()
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, subProgramIds))
      : [];
    const subProgramMap = new Map(subProgramRows.map((p) => [p.id, p]));

    const subscriptions = subsRows.map((r) => {
      const subProgram = r.commissionProgramId
        ? (subProgramMap.get(r.commissionProgramId) ?? null)
        : null;
      const rateFrac = subProgram ? subProgram.rate / 100 : partner.commissionRate;
      const perMoEarn =
        subProgram?.type === "one-time" && subProgram.flatAmount != null
          ? subProgram.flatAmount
          : r.mrr != null
            ? r.mrr * rateFrac
            : null;
      let total: number | null = null;
      if (subProgram?.type === "one-time" && subProgram.flatAmount != null) {
        total = subProgram.flatAmount;
      } else if (r.mrr != null) {
        if (subProgram?.type === "recurring" && subProgram.durationMonths) {
          total = r.mrr * rateFrac * subProgram.durationMonths;
        } else if (subProgram?.type === "lifetime") {
          total = r.mrr * rateFrac * 12;
        } else if (subProgram?.type === "one-time") {
          total = subProgram.flatAmount ?? r.mrr * rateFrac;
        }
      }
      return {
        customerId: r.customerId,
        customerName: r.customerName ?? r.customerEmail,
        startedAt: r.firstEvent
          ? new Date(r.firstEvent * 1000).toISOString().slice(0, 10)
          : null,
        mrr: r.mrr,
        perMoEarn,
        monthIndex: r.monthCount,
        durationMonths: subProgram?.durationMonths ?? null,
        earned: r.earned,
        total,
        programType: subProgram?.type ?? null,
      };
    });

    const payoutRows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.partnerId, id))
      .orderBy(desc(payouts.createdAt))
      .limit(12);

    const payoutsList = payoutRows.map((row) => ({
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      note: row.note,
      periodStart: row.periodStart ? row.periodStart.toISOString() : null,
      periodEnd: row.periodEnd ? row.periodEnd.toISOString() : null,
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));

    const commissionRows = await this.db
      .select({
        id: commissions.id,
        customerName: customers.name,
        customerEmail: customers.email,
        amount: commissions.amount,
        rate: commissions.rate,
        status: commissions.status,
        eventDate: commissions.eventDate,
        fraudFlag: commissions.fraudFlag,
        monthIndex: commissions.monthIndex,
        programName: commissionPrograms.name,
        programType: commissionPrograms.type,
      })
      .from(commissions)
      .innerJoin(customers, eq(customers.id, commissions.customerId))
      .leftJoin(
        commissionPrograms,
        eq(commissionPrograms.id, commissions.commissionProgramId),
      )
      .where(eq(commissions.partnerId, id))
      .orderBy(desc(commissions.createdAt))
      .limit(20);

    const commissionsList = commissionRows.map((row) => ({
      id: row.id,
      customerName: row.customerName ?? row.customerEmail,
      customerEmail: row.customerEmail,
      amount: row.amount,
      rate: row.rate,
      status: row.status,
      eventDate: row.eventDate ? row.eventDate.toISOString() : null,
      fraudFlag: row.fraudFlag,
      monthIndex: row.monthIndex,
      programName: row.programName,
      programType: row.programType,
    }));

    return {
      partner: {
        ...partner,
        commissionProgram: program,
        usesDefaultCommissionProgram,
        defaultCommissionProgramId,
      },
      stats: {
        lifetimeEarned,
        customerCount,
        pendingPayout,
        conversionRate,
        clicks: totalClicks,
        refs,
        epc,
        cancelRate,
        churnedCustomers,
        ltvRevenue,
        ltvMonths,
      },
      monthlyMrr,
      subscriptions,
      payouts: payoutsList,
      commissions: commissionsList,
      payoutCount,
      commissionCount,
    };
  }

  /**
   * Lightweight per-row enrichment for the list page: REFS / CLICKS / CONV / EPC / MRR.
   * Returns a Map keyed by partnerId.
   */
  async getListMetrics(
    partnerIds: string[],
  ): Promise<
    Map<
      string,
      {
        refs: number;
        clicks: number;
        conv: number;
        epc: number;
        mrr: number;
      }
    >
  > {
    const out = new Map<
      string,
      { refs: number; clicks: number; conv: number; epc: number; mrr: number }
    >();
    if (partnerIds.length === 0) return out;

    const refsRows = await this.db
      .select({
        partnerId: customers.partnerId,
        refs: sql<number>`count(*)`,
      })
      .from(customers)
      .where(inArray(customers.partnerId, partnerIds))
      .groupBy(customers.partnerId);

    const clicksRows = await this.db
      .select({
        partnerId: clicks.partnerId,
        unique: sql<number>`coalesce(sum(case when ${clicks.isUnique} then 1 else 0 end),0)`,
      })
      .from(clicks)
      .where(inArray(clicks.partnerId, partnerIds))
      .groupBy(clicks.partnerId);

    const earnedRows = await this.db
      .select({
        partnerId: commissions.partnerId,
        earned: sql<number>`coalesce(sum(case when ${commissions.status} in ('approved','paid') then ${commissions.amount} else 0 end),0)`,
        mrr: sql<number>`coalesce(sum(case when ${commissions.status} != 'rejected' and strftime('%Y-%m', ${commissions.eventDate}, 'unixepoch') = strftime('%Y-%m','now') then coalesce(${commissions.mrr},0) else 0 end),0)`,
      })
      .from(commissions)
      .where(inArray(commissions.partnerId, partnerIds))
      .groupBy(commissions.partnerId);

    const refMap = new Map(refsRows.map((r) => [r.partnerId, r.refs]));
    const clickMap = new Map(clicksRows.map((r) => [r.partnerId, r.unique]));
    const earnedMap = new Map(
      earnedRows.map((r) => [r.partnerId, { earned: r.earned, mrr: r.mrr }]),
    );

    for (const id of partnerIds) {
      const refs = refMap.get(id) ?? 0;
      const clicksCount = clickMap.get(id) ?? 0;
      const e = earnedMap.get(id) ?? { earned: 0, mrr: 0 };
      out.set(id, {
        refs,
        clicks: clicksCount,
        conv: clicksCount > 0 ? (refs / clicksCount) * 100 : 0,
        epc: clicksCount > 0 ? e.earned / clicksCount : 0,
        mrr: e.mrr,
      });
    }

    return out;
  }

  async getPartnerByEmail(
    projectId: string,
    email: string,
  ): Promise<PartnerRow | null> {
    const rows = await this.db
      .select()
      .from(partners)
      .where(and(eq(partners.projectId, projectId), eq(partners.email, email)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPartnerStats(userId: string, projectId?: string) {
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { totalPartners: 0, activePartners: 0, pendingPartners: 0 };
    }

    const ownedProjectIds = userProjects.map((p) => p.id);
    const projectIds =
      projectId && projectId !== "all"
        ? ownedProjectIds.filter((id) => id === projectId)
        : ownedProjectIds;

    if (projectIds.length === 0) {
      return { totalPartners: 0, activePartners: 0, pendingPartners: 0 };
    }

    const stats = await this.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${partners.status} = 'active' then 1 else 0 end)`,
        pending: sql<number>`sum(case when ${partners.status} = 'pending' then 1 else 0 end)`,
      })
      .from(partners)
      .where(inArray(partners.projectId, projectIds));

    const row = stats[0];
    return {
      totalPartners: row?.total ?? 0,
      activePartners: row?.active ?? 0,
      pendingPartners: row?.pending ?? 0,
    };
  }
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
