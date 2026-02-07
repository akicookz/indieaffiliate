import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql, inArray, and, gte } from "drizzle-orm";
import { clicks, commissions, customers, partners, projects } from "../db";

export class AnalyticsService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get analytics data for a user's projects.
   */
  async getAnalytics(
    userId: string,
    filters?: { projectId?: string; days?: number },
  ) {
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return {
        clicksByDay: [],
        conversionsByDay: [],
        revenueByDay: [],
        topPartners: [],
        totals: { clicks: 0, conversions: 0, revenue: 0, commissions: 0 },
      };
    }

    const projectIds = filters?.projectId && filters.projectId !== "all"
      ? [filters.projectId]
      : userProjects.map((p) => p.id);

    const days = filters?.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceUnix = Math.floor(since.getTime() / 1000);

    // Clicks by day (unique only)
    const clicksByDay = await this.db
      .select({
        date: sql<string>`date(${clicks.createdAt}, 'unixepoch')`.as("date"),
        count: sql<number>`coalesce(sum(case when ${clicks.isUnique} = 1 then 1 else 0 end), 0)`.as("count"),
      })
      .from(clicks)
      .where(
        and(
          inArray(clicks.projectId, projectIds),
          gte(clicks.createdAt, sql`${sinceUnix}`),
        ),
      )
      .groupBy(sql`date(${clicks.createdAt}, 'unixepoch')`)
      .orderBy(sql`date(${clicks.createdAt}, 'unixepoch')`);

    // Conversions (new customers) by day
    const conversionsByDay = await this.db
      .select({
        date: sql<string>`date(${customers.createdAt}, 'unixepoch')`.as("date"),
        count: sql<number>`count(*)`.as("count"),
      })
      .from(customers)
      .where(
        and(
          inArray(customers.projectId, projectIds),
          gte(customers.createdAt, sql`${sinceUnix}`),
        ),
      )
      .groupBy(sql`date(${customers.createdAt}, 'unixepoch')`)
      .orderBy(sql`date(${customers.createdAt}, 'unixepoch')`);

    // Revenue by day (from commissions)
    const revenueByDay = await this.db
      .select({
        date: sql<string>`date(${commissions.createdAt}, 'unixepoch')`.as("date"),
        revenue: sql<number>`coalesce(sum(case when ${commissions.rate} > 0 then ${commissions.amount} / ${commissions.rate} else 0 end), 0)`.as("revenue"),
        commissionAmount: sql<number>`coalesce(sum(${commissions.amount}), 0)`.as("commission_amount"),
      })
      .from(commissions)
      .where(
        and(
          inArray(commissions.projectId, projectIds),
          gte(commissions.createdAt, sql`${sinceUnix}`),
        ),
      )
      .groupBy(sql`date(${commissions.createdAt}, 'unixepoch')`)
      .orderBy(sql`date(${commissions.createdAt}, 'unixepoch')`);

    // Top partners by unique clicks in period
    const topPartners = await this.db
      .select({
        partnerId: clicks.partnerId,
        clickCount: sql<number>`coalesce(sum(case when ${clicks.isUnique} = 1 then 1 else 0 end), 0)`.as("click_count"),
      })
      .from(clicks)
      .where(
        and(
          inArray(clicks.projectId, projectIds),
          gte(clicks.createdAt, sql`${sinceUnix}`),
        ),
      )
      .groupBy(clicks.partnerId)
      .orderBy(sql`coalesce(sum(case when ${clicks.isUnique} = 1 then 1 else 0 end), 0) desc`)
      .limit(10);

    // Get partner details for top partners
    const partnerIds = topPartners.map((tp) => tp.partnerId);
    const partnerRows = partnerIds.length > 0
      ? await this.db
          .select({
            id: partners.id,
            name: partners.name,
            email: partners.email,
            totalRevenue: partners.totalRevenue,
            referredCustomers: partners.referredCustomers,
          })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p]));

    // Totals (unique clicks only)
    const totalClicks = await this.db
      .select({ count: sql<number>`coalesce(sum(case when ${clicks.isUnique} = 1 then 1 else 0 end), 0)` })
      .from(clicks)
      .where(
        and(
          inArray(clicks.projectId, projectIds),
          gte(clicks.createdAt, sql`${sinceUnix}`),
        ),
      );

    const totalConversions = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(
        and(
          inArray(customers.projectId, projectIds),
          gte(customers.createdAt, sql`${sinceUnix}`),
        ),
      );

    const totalRevenue = await this.db
      .select({
        revenue: sql<number>`coalesce(sum(${customers.revenue}), 0)`,
        commissionTotal: sql<number>`0`,
      })
      .from(customers)
      .where(
        and(
          inArray(customers.projectId, projectIds),
          gte(customers.createdAt, sql`${sinceUnix}`),
        ),
      );

    const totalCommissions = await this.db
      .select({
        total: sql<number>`coalesce(sum(${commissions.amount}), 0)`,
      })
      .from(commissions)
      .where(
        and(
          inArray(commissions.projectId, projectIds),
          gte(commissions.createdAt, sql`${sinceUnix}`),
        ),
      );

    return {
      clicksByDay,
      conversionsByDay,
      revenueByDay: revenueByDay.map((r) => ({
        date: r.date,
        revenue: r.revenue,
        commissions: r.commissionAmount,
      })),
      topPartners: topPartners.map((tp) => {
        const partner = partnerMap.get(tp.partnerId);
        return {
          id: tp.partnerId,
          name: partner?.name ?? "Unknown",
          email: partner?.email ?? "",
          clicks: tp.clickCount,
          customers: partner?.referredCustomers ?? 0,
          revenue: partner?.totalRevenue ?? 0,
        };
      }),
      totals: {
        clicks: totalClicks[0]?.count ?? 0,
        conversions: totalConversions[0]?.count ?? 0,
        revenue: totalRevenue[0]?.revenue ?? 0,
        commissions: totalCommissions[0]?.total ?? 0,
      },
    };
  }
}
