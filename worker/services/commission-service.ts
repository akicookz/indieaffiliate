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

export class CommissionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Record a conversion: create/update customer, calculate commission, update partner counters.
   */
  async recordConversion(data: {
    partnerId: string;
    projectId: string;
    customerEmail: string;
    revenue: number;
    customerStatus?: "trialing" | "paid" | "cancelled";
  }): Promise<{ customerId: string; commissionId: string; commissionAmount: number }> {
    // Get partner to snapshot commission rate
    const partnerRows = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, data.partnerId))
      .limit(1);
    const partner = partnerRows[0];
    if (!partner) throw new Error("Partner not found");

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
      status: "pending",
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
   * Update a commission's status (approve, reject, mark paid).
   */
  async updateCommissionStatus(
    id: string,
    status: "pending" | "approved" | "paid" | "rejected",
  ): Promise<CommissionRow | null> {
    await this.db
      .update(commissions)
      .set({ status })
      .where(eq(commissions.id, id));

    const rows = await this.db
      .select()
      .from(commissions)
      .where(eq(commissions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
