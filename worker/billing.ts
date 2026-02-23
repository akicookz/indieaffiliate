/**
 * Billing plan limits and helpers.
 * Aligned with Landing page: Starter (free), Growth ($39), Scale ($99).
 */

export type Plan = "starter" | "growth" | "scale";

export const PLAN_LIMITS: Record<Plan, { maxProjects: number }> = {
  starter: { maxProjects: 1 },
  growth: { maxProjects: 5 },
  scale: { maxProjects: 999 },
};

export const TRIAL_DAYS = 14;

export function getMaxProjects(plan: Plan): number {
  return PLAN_LIMITS[plan]?.maxProjects ?? 1;
}

export function canCreateProject(plan: Plan, currentProjectCount: number): boolean {
  return currentProjectCount < getMaxProjects(plan);
}

export function isPlanActiveOrTrialing(status: string): boolean {
  return status === "active" || status === "trialing";
}
