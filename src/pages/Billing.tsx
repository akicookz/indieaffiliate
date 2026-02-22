import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Zap, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BillingData {
  subscription: {
    plan: "starter" | "growth" | "scale";
    status: string;
    stripeCustomerId: string | null;
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
    plan: "starter",
    status: "active",
    stripeCustomerId: null,
    currentPeriodEnd: null,
  },
  mrr: 0,
  usage: { projectCount: 0, maxProjects: 1 },
  trialEndsAt: null,
};

function Billing() {
  const [checkoutPlan, setCheckoutPlan] = useState<"growth" | "scale">("growth");
  const [checkoutInterval, setCheckoutInterval] = useState<"month" | "year">("month");

  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ["billing"],
    queryFn: async () => {
      const res = await fetch("/api/billing");
      if (!res.ok) throw new Error("Failed to load billing");
      return res.json();
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: checkoutPlan,
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

  const billing = data ?? DEFAULT_BILLING;
  const { subscription, mrr, usage, trialEndsAt } = billing;
  const planLabel = PLAN_LABELS[subscription.plan] ?? subscription.plan;
  const hasPortal = !!subscription.stripeCustomerId;
  const isTrialing = subscription.status === "trialing";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          {isLoading ? "Loading…" : "Manage your plan and subscription."}
        </p>
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
              <Button
                variant="outline"
                className="w-full"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                {portalMutation.isPending ? "Opening…" : "Manage subscription"}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
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

      {(subscription.plan === "starter" || subscription.plan === "growth") && (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade</CardTitle>
            <CardDescription>
              {subscription.plan === "starter"
                ? "Unlock Growth or Scale for more projects and features."
                : "Move to Scale for higher limits and priority support."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium">Plan</label>
                <Select
                  value={checkoutPlan}
                  onValueChange={(v) => setCheckoutPlan(v as "growth" | "scale")}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="growth">Growth ($39/mo)</SelectItem>
                    <SelectItem value="scale">Scale ($99/mo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Billing</label>
                <Select
                  value={checkoutInterval}
                  onValueChange={(v) => setCheckoutInterval(v as "month" | "year")}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Annual (save ~20%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => checkoutMutation.mutate()}
                disabled={checkoutMutation.isPending}
              >
                {checkoutMutation.isPending ? "Redirecting…" : "Upgrade"}
              </Button>
            </div>
            {checkoutMutation.error && (
              <p className="text-sm text-destructive">
                {checkoutMutation.error.message}
              </p>
            )}
            {(subscription.plan === "starter" || !subscription.stripeCustomerId) && (
              <p className="text-sm text-muted-foreground">
                Growth and Scale include a 14-day free trial.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default Billing;
