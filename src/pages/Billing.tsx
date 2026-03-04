import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard,
  Zap,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Check,
  Sparkles,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BillingData {
  subscription: {
    plan: "starter" | "growth" | "scale" | null;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
  };
  mrr: number;
  usage: { projectCount: number; maxProjects: number };
  trialEndsAt: string | null;
}

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const DEFAULT_BILLING: BillingData = {
  subscription: {
    plan: null,
    status: "active",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
  },
  mrr: 0,
  usage: { projectCount: 0, maxProjects: 1 },
  trialEndsAt: null,
};

const GROWTH_FEATURES = [
  "Up to 5 projects",
  "Partner dashboard",
  "Commission tracking",
  "Email support",
  "14-day free trial",
];

const SCALE_FEATURES = [
  "Unlimited projects",
  "Everything in Growth",
  "Priority support",
  "Advanced analytics",
  "Custom branding",
  "14-day free trial",
];

function Billing() {
  const [checkoutInterval, setCheckoutInterval] = useState<"month" | "year">("year");

  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ["billing"],
    queryFn: async () => {
      const res = await fetch("/api/billing");
      if (!res.ok) throw new Error("Failed to load billing");
      return res.json();
    },
  });

  const { data: stripeConnection } = useQuery<{
    connected: boolean;
    message: string;
    configured: boolean;
  }>({
    queryKey: ["billing", "stripe-connection"],
    queryFn: async () => {
      const res = await fetch("/api/billing/stripe-connection");
      if (!res.ok) throw new Error("Failed to check Stripe");
      return res.json();
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: "growth" | "scale") => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval: checkoutInterval,
          successUrl: `${window.location.origin}/app/billing?success=1`,
          cancelUrl: `${window.location.origin}/app/billing`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Checkout failed");
      }
      const json = (await res.json()) as { url: string };
      window.location.href = json.url;
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/app/billing`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Portal failed");
      }
      const json = (await res.json()) as { url: string };
      window.location.href = json.url;
    },
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      setShowSuccess(true);
      setSearchParams({}, { replace: true });
      const t = setTimeout(() => setShowSuccess(false), 6000);
      return () => clearTimeout(t);
    }
  }, [searchParams, setSearchParams]);

  const billing = data ?? DEFAULT_BILLING;
  const { subscription, mrr, usage, trialEndsAt } = billing;
  const planLabel =
    (subscription.plan && PLAN_LABELS[subscription.plan]) || "Not selected";
  const hasPortal = !!subscription.stripeCustomerId;
  const isTrialing = subscription.status === "trialing";

  return (
    <div className="space-y-6">
      {showSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Your subscription was updated successfully.
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          {isLoading ? "Loading…" : "Manage your plan and subscription."}
        </p>
        {stripeConnection && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            {stripeConnection.connected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-muted-foreground">Stripe: {stripeConnection.message}</span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-amber-600" />
                <span className="text-muted-foreground">Stripe: {stripeConnection.message}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Current plan
            </CardTitle>
            <CardDescription>Your subscription tier and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <span className="font-medium">{planLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{subscription.status}</span>
            </div>
            {subscription.currentPeriodEnd && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {isTrialing ? "Trial ends" : "Period ends"}
                </span>
                <span className="font-medium">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            )}
            {trialEndsAt && isTrialing && (
              <p className="text-sm text-muted-foreground">
                Your 14-day free trial ends on{" "}
                {new Date(trialEndsAt).toLocaleDateString()}.
              </p>
            )}
            {hasPortal && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending
                    ? "Opening Stripe…"
                    : "Cancel or manage in Stripe"}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Use the Stripe billing portal to cancel your subscription or change
                  plans. Stripe remains the source of truth for billing.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Usage
            </CardTitle>
            <CardDescription>Referral MRR and project usage</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Referral MRR</span>
              <span className="font-medium">${mrr.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Projects</span>
              <span className="font-medium">
                {usage.projectCount} / {usage.maxProjects}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {(!subscription.plan ||
        subscription.plan === "starter" ||
        subscription.plan === "growth") && (
        <div className="space-y-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Upgrade your plan</h2>
            <p className="text-muted-foreground text-sm">
              Get more projects, better support, and unlock advanced features.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-sm font-medium">Billing:</span>
              <div className="flex rounded-lg border border-input bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => setCheckoutInterval("month")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${checkoutInterval === "month" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCheckoutInterval("year")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${checkoutInterval === "year" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Annual
                  <span className="ml-1.5 rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-700 dark:text-green-400">
                    Save ~20%
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="relative overflow-hidden border-2 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent dark:from-primary/10">
              <div className="absolute right-4 top-4">
                <Badge variant="secondary" className="gap-1 font-medium">
                  <Sparkles className="h-3 w-3" />
                  Recommended
                </Badge>
              </div>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Zap className="h-5 w-5 text-primary" />
                  Growth
                </CardTitle>
                <CardDescription>For growing teams and multiple products</CardDescription>
                <div className="pt-2">
                  <span className="text-3xl font-bold tracking-tight">
                    ${checkoutInterval === "year" ? "31" : "39"}
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">/month</span>
                  {checkoutInterval === "year" && (
                    <p className="text-muted-foreground text-xs mt-0.5">Billed annually</p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm">
                  {GROWTH_FEATURES.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  onClick={() => checkoutMutation.mutate("growth")}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending ? "Redirecting…" : "Get Growth"}
                </Button>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden border-border hover:border-primary/30 transition-colors">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  Scale
                </CardTitle>
                <CardDescription>For scale and priority support</CardDescription>
                <div className="pt-2">
                  <span className="text-3xl font-bold tracking-tight">
                    ${checkoutInterval === "year" ? "79" : "99"}
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">/month</span>
                  {checkoutInterval === "year" && (
                    <p className="text-muted-foreground text-xs mt-0.5">Billed annually</p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm">
                  {SCALE_FEATURES.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  className="w-full border-2"
                  onClick={() => checkoutMutation.mutate("scale")}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending ? "Redirecting…" : "Get Scale"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {checkoutMutation.error && (
            <p className="text-sm text-destructive">{checkoutMutation.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default Billing;
