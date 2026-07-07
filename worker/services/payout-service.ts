import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {
  commissions,
  customers,
  payouts,
  payoutCommissions,
  partners,
  projects,
  type PayoutRow,
  type NewPayoutRow,
} from "../db";

export interface PayoutCommissionLinkInput {
  commissionId: string;
  amount: number;
}

export class PayoutService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get all payouts for a user's projects, with partner info.
   */
  async getPayoutsByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<
    (PayoutRow & {
      partnerName: string;
      partnerEmail: string;
      projectName: string;
      commissionCount: number;
    })[]
  > {
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return [];

    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(payouts.projectId, projectIds)];

    if (filters?.projectId && filters.projectId !== "all") {
      conditions.push(eq(payouts.projectId, filters.projectId));
    }
    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(payouts.status, filters.status as "scheduled" | "paid" | "failed"),
      );
    }

    const rows = await this.db
      .select()
      .from(payouts)
      .where(and(...conditions))
      .orderBy(desc(payouts.createdAt));

    // Fetch partner info
    const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
    const partnerRows = partnerIds.length > 0
      ? await this.db
          .select({ id: partners.id, name: partners.name, email: partners.email })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, { name: p.name, email: p.email }]));
    const payoutIds = rows.map((row) => row.id);
    const linkRows = payoutIds.length > 0
      ? await this.db
          .select({
            payoutId: payoutCommissions.payoutId,
            count: sql<number>`count(*)`,
          })
          .from(payoutCommissions)
          .where(inArray(payoutCommissions.payoutId, payoutIds))
          .groupBy(payoutCommissions.payoutId)
      : [];
    const commissionCountMap = new Map(
      linkRows.map((row) => [row.payoutId, row.count]),
    );

    return rows.map((row) => ({
      ...row,
      partnerName: partnerMap.get(row.partnerId)?.name ?? "Unknown",
      partnerEmail: partnerMap.get(row.partnerId)?.email ?? "",
      projectName: projectMap.get(row.projectId) ?? "Unknown",
      commissionCount: commissionCountMap.get(row.id) ?? 0,
    }));
  }

  /**
   * Create a new payout.
   */
  async createPayout(
    data: Omit<NewPayoutRow, "id" | "createdAt" | "updatedAt">,
    linkedCommissions: PayoutCommissionLinkInput[] = [],
  ): Promise<PayoutRow> {
    if (linkedCommissions.length > 0) {
      const existingLinks = await this.getPayoutLinksForCommissions(
        linkedCommissions.map((commission) => commission.commissionId),
      );
      if (existingLinks.length > 0) {
        throw new Error(
          "One or more commissions are already attached to a payout record.",
        );
      }
    }

    const id = crypto.randomUUID();
    await this.db.insert(payouts).values({ id, ...data });
    if (linkedCommissions.length > 0) {
      await this.db.insert(payoutCommissions).values(
        linkedCommissions.map((commission) => ({
          payoutId: id,
          commissionId: commission.commissionId,
          amount: commission.amount,
        })),
      );
    }
    const rows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.id, id))
      .limit(1);
    return rows[0]!;
  }

  /**
   * Update a payout's status (mark as paid, failed, etc).
   */
  async updatePayoutStatus(
    id: string,
    status: "scheduled" | "paid" | "failed",
    paidAt?: Date,
  ): Promise<PayoutRow | null> {
    const updates: Partial<PayoutRow> = {
      status,
      paidAt: status === "paid" ? (paidAt ?? new Date()) : null,
    };
    await this.db
      .update(payouts)
      .set(updates)
      .where(eq(payouts.id, id));
    const rows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get payout stats for a user's projects.
   */
  async getPayoutStats(userId: string, projectId?: string) {
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { totalPayouts: 0, scheduledAmount: 0, paidAmount: 0, failedAmount: 0 };
    }

    const ownedProjectIds = userProjects.map((p) => p.id);
    const projectIds =
      projectId && projectId !== "all"
        ? ownedProjectIds.filter((id) => id === projectId)
        : ownedProjectIds;

    if (projectIds.length === 0) {
      return { totalPayouts: 0, scheduledAmount: 0, paidAmount: 0, failedAmount: 0 };
    }

    const stats = await this.db
      .select({
        total: sql<number>`count(*)`,
        scheduled: sql<number>`coalesce(sum(case when ${payouts.status} = 'scheduled' then ${payouts.amount} else 0 end), 0)`,
        paid: sql<number>`coalesce(sum(case when ${payouts.status} = 'paid' then ${payouts.amount} else 0 end), 0)`,
        failed: sql<number>`coalesce(sum(case when ${payouts.status} = 'failed' then ${payouts.amount} else 0 end), 0)`,
      })
      .from(payouts)
      .where(inArray(payouts.projectId, projectIds));

    const row = stats[0];
    return {
      totalPayouts: row?.total ?? 0,
      scheduledAmount: row?.scheduled ?? 0,
      paidAmount: row?.paid ?? 0,
      failedAmount: row?.failed ?? 0,
    };
  }

  /**
   * Get a single payout by ID.
   */
  async getPayoutById(id: string): Promise<PayoutRow | null> {
    const rows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getLinkedCommissionIds(payoutId: string): Promise<string[]> {
    const rows = await this.db
      .select({ commissionId: payoutCommissions.commissionId })
      .from(payoutCommissions)
      .where(eq(payoutCommissions.payoutId, payoutId));
    return rows.map((row) => row.commissionId);
  }

  async getPayoutLinksForCommissions(
    commissionIds: string[],
  ): Promise<
    {
      payoutId: string;
      commissionId: string;
      status: "scheduled" | "paid" | "failed";
    }[]
  > {
    if (commissionIds.length === 0) return [];
    return await this.db
      .select({
        payoutId: payoutCommissions.payoutId,
        commissionId: payoutCommissions.commissionId,
        status: payouts.status,
      })
      .from(payoutCommissions)
      .innerJoin(payouts, eq(payouts.id, payoutCommissions.payoutId))
      .where(inArray(payoutCommissions.commissionId, commissionIds));
  }

  async getLinkedCommissions(
    payoutId: string,
  ): Promise<
    {
      id: string;
      amount: number;
      status: "pending" | "approved" | "paid" | "rejected";
    }[]
  > {
    return await this.db
      .select({
        id: commissions.id,
        amount: commissions.amount,
        status: commissions.status,
      })
      .from(payoutCommissions)
      .innerJoin(
        commissions,
        eq(commissions.id, payoutCommissions.commissionId),
      )
      .where(eq(payoutCommissions.payoutId, payoutId));
  }

  /**
   * Line items for a payout: which commissions it covered, each with the
   * referred customer's email/name and the commission amount. Used by the
   * payout drill-down so both creator and partner can see what a payout paid for.
   */
  async getPayoutLineItems(payoutId: string): Promise<
    {
      commissionId: string;
      amount: number;
      status: "pending" | "approved" | "paid" | "rejected";
      customerEmail: string | null;
      customerName: string | null;
      eventDate: Date | null;
    }[]
  > {
    return await this.db
      .select({
        commissionId: commissions.id,
        amount: payoutCommissions.amount,
        status: commissions.status,
        customerEmail: customers.email,
        customerName: customers.name,
        eventDate: commissions.eventDate,
      })
      .from(payoutCommissions)
      .innerJoin(commissions, eq(commissions.id, payoutCommissions.commissionId))
      .leftJoin(customers, eq(customers.id, commissions.customerId))
      .where(eq(payoutCommissions.payoutId, payoutId));
  }

  /**
   * Remove all commission links for a payout. Called when a payout is marked
   * failed/reverted so its commissions are freed and can be paid again through
   * the normal flow (which errors if a commission is still attached).
   */
  async deleteLinks(payoutId: string): Promise<void> {
    await this.db
      .delete(payoutCommissions)
      .where(eq(payoutCommissions.payoutId, payoutId));
  }
}
