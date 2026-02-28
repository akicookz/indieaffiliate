import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql, inArray } from "drizzle-orm";
import {
  userSubscriptions,
  customers,
  projects,
  type UserSubscriptionRow,
  type NewUserSubscriptionRow,
} from "../db";

export class SubscriptionService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  /**
   * Get user's subscription or create a record with no selected plan yet.
   * New users start with `plan = null` and choose a tier during onboarding or billing.
   */
  async getOrCreateSubscription(userId: string): Promise<UserSubscriptionRow> {
    const existing = await this.db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1);

    if (existing[0]) {
      return existing[0];
    }

    // Create initial subscription with no selected plan.
    const id = crypto.randomUUID();
    const subscription: NewUserSubscriptionRow = {
      id,
      userId,
      plan: null,
      status: "active",
    };
    await this.db.insert(userSubscriptions).values(subscription);
    return (await this.getSubscription(userId))!;
  }

  /**
   * Get user's subscription.
   */
  async getSubscription(userId: string): Promise<UserSubscriptionRow | null> {
    const rows = await this.db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Update user's subscription.
   */
  async updateSubscription(
    userId: string,
    updates: Partial<
      Pick<
        UserSubscriptionRow,
        | "plan"
        | "stripeCustomerId"
        | "stripeSubscriptionId"
        | "status"
        | "currentPeriodEnd"
        | "trialEndsAt"
      >
    >,
  ): Promise<UserSubscriptionRow | null> {
    await this.db
      .update(userSubscriptions)
      .set(updates)
      .where(eq(userSubscriptions.userId, userId));
    return this.getSubscription(userId);
  }

  /**
   * Calculate MRR (Monthly Recurring Revenue) for a user.
   * MRR = sum of monthly revenue from all customers across all projects.
   * For one-time payments, we estimate monthly equivalent.
   */
  async calculateMRR(userId: string): Promise<number> {
    // Get all user's projects
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return 0;

    const projectIds = userProjects.map((p) => p.id);

    // Sum revenue from all customers
    // Note: This assumes revenue is already monthly. For one-time payments,
    // you'd need to divide by estimated customer lifetime or track differently.
    const result = await this.db
      .select({
        totalRevenue: sql<number>`coalesce(sum(${customers.revenue}), 0)`,
      })
      .from(customers)
      .where(inArray(customers.projectId, projectIds));

    return result[0]?.totalRevenue ?? 0;
  }

  /**
   * Check if user has reached $1K MRR threshold (for starter plan upgrade prompt).
   */
  async shouldShowUpgradePrompt(userId: string): Promise<boolean> {
    const subscription = await this.getOrCreateSubscription(userId);
    
    // Only show for starter plan users
    if (subscription.plan !== "starter") return false;

    const mrr = await this.calculateMRR(userId);
    return mrr >= 1000;
  }
}
