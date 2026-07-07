import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PageHeader from "@/components/PageHeader";

interface BillingData {
  subscription: {
    plan: "starter" | "growth" | "scale" | null;
    status: string;
  };
}

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

function BillingUpgrade() {
  const [checkoutInterval, setCheckoutInterval] = useState<"month" | "year">(
    "year",
  );

  const { data } = useQuery<BillingData>({
    queryKey: ["billing"],
    queryFn: async () => {
      const res = await fetch("/api/billing");
      if (!res.ok) throw new Error("Failed to load billing");
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
          cancelUrl: `${window.location.origin}/app/billing/upgrade`,
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

  const currentPlan = data?.subscription.plan;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upgrade plan"
        subtitle="Compare plans, switch billing interval, and start checkout when you are ready."
      >
        <Button variant="ghost" asChild>
          <Link to="/app/billing">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to billing
          </Link>
        </Button>
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="h-3 w-3" />
          Annual saves about 20%
        </Badge>
      </PageHeader>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Current plan</p>
            <p className="text-lg font-semibold capitalize">
              {currentPlan ?? "No paid plan selected"}
            </p>
            <p className="text-sm text-muted-foreground">
              Choose monthly for flexibility or annual billing to save more.
            </p>
          </div>
          <div className="flex rounded-lg border border-input bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setCheckoutInterval("month")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${checkoutInterval === "month" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCheckoutInterval("year")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${checkoutInterval === "year" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Annual
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="relative overflow-hidden border-2 border-primary/20 bg-primary/5">
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
              <span className="text-4xl font-bold tracking-tight">
                ${checkoutInterval === "year" ? "31" : "39"}
              </span>
              <span className="ml-1 text-muted-foreground text-sm font-normal">
                /month
              </span>
              {checkoutInterval === "year" && (
                <p className="text-muted-foreground text-xs mt-1">Billed annually</p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-2.5 text-sm">
              {GROWTH_FEATURES.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                  {feature}
                </li>
              ))}
            </ul>
            {currentPlan === "growth" && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                <BadgeCheck className="h-4 w-4" />
                You are currently on Growth.
              </div>
            )}
            <Button
              className="w-full"
              onClick={() => checkoutMutation.mutate("growth")}
              disabled={checkoutMutation.isPending || currentPlan === "growth"}
            >
              {checkoutMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting…
                </>
              ) : currentPlan === "growth" ? (
                "Current plan"
              ) : (
                "Choose Growth"
              )}
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
              <span className="text-4xl font-bold tracking-tight">
                ${checkoutInterval === "year" ? "79" : "99"}
              </span>
              <span className="ml-1 text-muted-foreground text-sm font-normal">
                /month
              </span>
              {checkoutInterval === "year" && (
                <p className="text-muted-foreground text-xs mt-1">Billed annually</p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-2.5 text-sm">
              {SCALE_FEATURES.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {feature}
                </li>
              ))}
            </ul>
            {currentPlan === "scale" && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                <BadgeCheck className="h-4 w-4" />
                You are currently on Scale.
              </div>
            )}
            <Button
              variant="secondary"
              className="w-full border-2"
              onClick={() => checkoutMutation.mutate("scale")}
              disabled={checkoutMutation.isPending || currentPlan === "scale"}
            >
              {checkoutMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting…
                </>
              ) : currentPlan === "scale" ? (
                "Current plan"
              ) : (
                "Choose Scale"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upgrade with confidence</CardTitle>
          <CardDescription>
            Billing stays focused on your active subscription and Stripe management,
            while this page is dedicated to comparing plans and starting checkout.
          </CardDescription>
        </CardHeader>
      </Card>

      {checkoutMutation.error && (
        <p className="text-sm text-destructive">{checkoutMutation.error.message}</p>
      )}
    </div>
  );
}

export default BillingUpgrade;
