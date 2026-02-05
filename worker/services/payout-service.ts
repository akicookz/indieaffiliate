import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {
  payouts,
  partners,
  projects,
  type PayoutRow,
  type NewPayoutRow,
} from "../db";

export class PayoutService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get all payouts for a user's projects, with partner info.
   */
  async getPayoutsByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<(PayoutRow & { partnerName: string; partnerEmail: string; projectName: string })[]> {
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

    return rows.map((row) => ({
      ...row,
      partnerName: partnerMap.get(row.partnerId)?.name ?? "Unknown",
      partnerEmail: partnerMap.get(row.partnerId)?.email ?? "",
      projectName: projectMap.get(row.projectId) ?? "Unknown",
    }));
  }

  /**
   * Create a new payout.
   */
  async createPayout(
    data: Omit<NewPayoutRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<PayoutRow> {
    const id = crypto.randomUUID();
    await this.db.insert(payouts).values({ id, ...data });
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
    const updates: Partial<PayoutRow> = { status };
    if (paidAt) updates.paidAt = paidAt;
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

    const projectIds = projectId && projectId !== "all"
      ? [projectId]
      : userProjects.map((p) => p.id);

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
}
