import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql, inArray, desc } from "drizzle-orm";
import { projects, partners, customers, clicks } from "../db";

export class DashboardService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getDashboardData(userId: string, projectId?: string) {
    // Get user's projects
    const userProjects = await this.db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return {
        revenue: { total: 0, change: 0, isPositive: true },
        clicks: 0,
        leads: 0,
        newCustomers: 0,
        topReferrers: [],
        newReferredCustomers: [],
      };
    }

    const projectIds = projectId && projectId !== "all"
      ? [projectId]
      : userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    // Get revenue from customers
    const revenueResult = await this.db
      .select({
        total: sql<number>`coalesce(sum(${customers.revenue}), 0)`,
      })
      .from(customers)
      .where(inArray(customers.projectId, projectIds));

    const totalRevenue = revenueResult[0]?.total ?? 0;

    // Get customer counts
    const customerStats = await this.db
      .select({
        total: sql<number>`count(*)`,
        trialing: sql<number>`sum(case when ${customers.status} = 'trialing' then 1 else 0 end)`,
      })
      .from(customers)
      .where(inArray(customers.projectId, projectIds));

    // Get top referrers (partners) ordered by revenue
    const topReferrers = await this.db
      .select()
      .from(partners)
      .where(inArray(partners.projectId, projectIds))
      .orderBy(desc(partners.totalRevenue))
      .limit(5);

    // Get newest customers
    const newCustomerRows = await this.db
      .select()
      .from(customers)
      .where(inArray(customers.projectId, projectIds))
      .orderBy(desc(customers.createdAt))
      .limit(5);

    // Get partner names for new customers
    const partnerIds = [...new Set(newCustomerRows.map((c) => c.partnerId))];
    const partnerRows = partnerIds.length > 0
      ? await this.db
          .select({ id: partners.id, name: partners.name })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));

    // Get click count (unique clicks only — deduplicated by IP+referralCode)
    const clickStats = await this.db
      .select({ count: sql<number>`coalesce(sum(case when ${clicks.isUnique} = 1 then 1 else 0 end), 0)` })
      .from(clicks)
      .where(inArray(clicks.projectId, projectIds));
    const totalClicks = clickStats[0]?.count ?? 0;

    return {
      revenue: {
        total: totalRevenue,
        change: 0, // TODO: calculate period-over-period change
        isPositive: true,
      },
      clicks: totalClicks,
      leads: customerStats[0]?.trialing ?? 0,
      newCustomers: customerStats[0]?.total ?? 0,
      topReferrers: topReferrers.map((r) => ({
        id: r.id,
        partnerName: r.name,
        email: r.email,
        referredCustomers: r.referredCustomers,
        totalRevenue: r.totalRevenue,
        commissionRate: r.commissionRate,
        project: projectMap.get(r.projectId) ?? "Unknown",
      })),
      newReferredCustomers: newCustomerRows.map((c) => ({
        id: c.id,
        createdDate: c.createdAt.toISOString().split("T")[0],
        email: c.email,
        referredPartner: partnerMap.get(c.partnerId) ?? "Unknown",
        status: c.status,
        project: projectMap.get(c.projectId) ?? "Unknown",
      })),
    };
  }
}
