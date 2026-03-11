import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard,
  Zap,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";

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

function Billing() {
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
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background">
          <CardHeader className="space-y-3">
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Upgrade your plan
            </CardTitle>
            <CardDescription>
              Explore Growth and Scale on a dedicated upgrade page with richer pricing
              details and plan comparison.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Current plan: {planLabel}</p>
              <p className="text-sm text-muted-foreground">
                Billing stays focused on your active subscription, usage, and Stripe
                management.
              </p>
            </div>
            <Button asChild>
              <Link to="/app/billing/upgrade">
                Upgrade plan
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default Billing;
