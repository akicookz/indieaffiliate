import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  customers,
  partners,
  projects,
  type CustomerRow,
} from "../db";

export class CustomerService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getCustomersByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<(CustomerRow & { projectName: string; partnerName: string })[]> {
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return [];

    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(customers.projectId, projectIds)];

    if (filters?.projectId && filters.projectId !== "all") {
      conditions.push(eq(customers.projectId, filters.projectId));
    }
    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(customers.status, filters.status as "trialing" | "paid" | "cancelled"),
      );
    }

    const rows = await this.db
      .select()
      .from(customers)
      .where(and(...conditions));

    // Fetch partner names for these customers
    const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
    const partnerRows = partnerIds.length > 0
      ? await this.db
          .select({ id: partners.id, name: partners.name })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));

    return rows.map((row) => ({
      ...row,
      projectName: projectMap.get(row.projectId) ?? "Unknown",
      partnerName: partnerMap.get(row.partnerId) ?? "Unknown",
    }));
  }

  async getCustomerStats(userId: string, projectId?: string) {
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { totalCustomers: 0, paidCustomers: 0, trialingCustomers: 0, cancelledCustomers: 0 };
    }

    const projectIds = projectId && projectId !== "all"
      ? [projectId]
      : userProjects.map((p) => p.id);

    const stats = await this.db
      .select({
        total: sql<number>`count(*)`,
        paid: sql<number>`sum(case when ${customers.status} = 'paid' then 1 else 0 end)`,
        trialing: sql<number>`sum(case when ${customers.status} = 'trialing' then 1 else 0 end)`,
        cancelled: sql<number>`sum(case when ${customers.status} = 'cancelled' then 1 else 0 end)`,
      })
      .from(customers)
      .where(inArray(customers.projectId, projectIds));

    const row = stats[0];
    return {
      totalCustomers: row?.total ?? 0,
      paidCustomers: row?.paid ?? 0,
      trialingCustomers: row?.trialing ?? 0,
      cancelledCustomers: row?.cancelled ?? 0,
    };
  }
}
