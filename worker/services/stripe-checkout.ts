import type { AppEnv } from "../types";

export type Plan = "starter" | "growth" | "scale";

export type BillingInterval = "month" | "year";

/**
 * Resolve Stripe price ID from env by plan and interval (monthly/yearly).
 * Uses plan-specific env vars when set (e.g. STRIPE_PRICE_GROWTH_MONTHLY), else generic STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL.
 */
export function getPriceId(
  env: AppEnv,
  plan: Plan,
  interval: BillingInterval = "month",
): string | null {
  if (plan === "starter") return null;

  if (plan === "growth") {
    return interval === "year"
      ? env.STRIPE_PRICE_GROWTH_ANNUAL  ?? null
      : env.STRIPE_PRICE_GROWTH_MONTHLY ?? null;
  }
  if (plan === "scale") {
    return interval === "year"
      ? env.STRIPE_PRICE_SCALE_ANNUAL  ?? null
      : env.STRIPE_PRICE_SCALE_MONTHLY ?? null;
  }
  return null;
}

/** @deprecated Use getPriceId. Kept for backward compatibility. */
export function getPriceIds(
  env: AppEnv,
  plan: Plan,
  interval: BillingInterval = "month",
): string | null {
  return getPriceId(env, plan, interval);
}

/**
 * Resolve plan from a Stripe price ID by matching against env price IDs (all plan + interval combos).
 */
export function getPlanFromPriceId(env: AppEnv, priceId: string): Plan {
  if (env.STRIPE_PRICE_GROWTH_MONTHLY === priceId ) return "growth";
  if (env.STRIPE_PRICE_GROWTH_ANNUAL === priceId) return "growth";
  if (env.STRIPE_PRICE_SCALE_MONTHLY === priceId) return "scale";
  if (env.STRIPE_PRICE_SCALE_ANNUAL === priceId) return "scale";
  return "starter";
}

export interface CreateCheckoutSessionParams {
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  priceId: string;
  /** If true, request 14-day free trial (for growth/scale first-time subscribers). */
  eligibleForTrial?: boolean;
}

/**
 * Create a Stripe Checkout session for subscription.
 * Returns { url } or null on failure.
 */
export async function createCheckoutSession(
  env: AppEnv,
  params: CreateCheckoutSessionParams,
): Promise<{ url: string; id: string } | null> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return null;

  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": params.priceId,
    "line_items[0][quantity]": "1",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
  });

  if (params.customerId) {
    body.set("customer", params.customerId);
  }
  if (params.eligibleForTrial) {
    body.set("subscription_data[trial_period_days]", "14");
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Stripe checkout session failed:", response.status, text);
    return null;
  }

  const session = (await response.json()) as { url?: string; id?: string };
  if (session.url && session.id) {
    return { url: session.url, id: session.id };
  }
  return null;
}

export interface CreateBillingPortalSessionParams {
  returnUrl: string;
  customerId: string;
  subscriptionId?: string;
}

/**
 * Create a Stripe Customer Billing Portal session.
 * Customer can manage subscription, payment methods, invoices.
 */
export async function createBillingPortalSession(
  env: AppEnv,
  params: CreateBillingPortalSessionParams,
): Promise<{ url: string } | null> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return null;

  const body = new URLSearchParams({
    return_url: params.returnUrl,
    customer: params.customerId,
  });
  if (params.subscriptionId) {
    body.set("flow_data[type]", "subscription_update");
    body.set("flow_data[subscription_update][subscription]", params.subscriptionId);
  }

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Stripe billing portal session failed:", response.status, text);
    return null;
  }

  const session = (await response.json()) as { url?: string };
  return session.url ? { url: session.url } : null;
}

/**
 * Set a Stripe subscription to cancel at period end.
 * Returns true on success, false on error.
 */
export async function cancelSubscriptionAtPeriodEnd(
  env: AppEnv,
  subscriptionId: string,
): Promise<boolean> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return false;

  const body = new URLSearchParams({
    cancel_at_period_end: "true",
  });

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(
      "Stripe cancel at period end failed:",
      response.status,
      text,
    );
    return false;
  }

  return true;
}

/**
 * Cancel a Stripe subscription immediately.
 * Returns true on success, false on error.
 */
export async function cancelSubscriptionImmediately(
  env: AppEnv,
  subscriptionId: string,
): Promise<boolean> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return false;

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("Stripe immediate cancel failed:", response.status, text);
    return false;
  }

  return true;
}

