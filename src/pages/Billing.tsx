import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Settings, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

interface BillingStatus {
  planId: string | null;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "incomplete"
    | "incomplete_expired"
    | "none";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

interface DashboardSummary {
  revenue: { total: number };
  clicks: number;
  newCustomers: number;
}

function formatPlanName(planId: string | null): string {
  if (planId === "starter") return "Starter";
  if (planId === "growth") return "Growth";
  if (planId === "scale") return "Scale";
  return "No plan";
}

function formatStatusLabel(status: BillingStatus["status"]): string {
  if (status === "none") return "No subscription";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Billing() {
  const {
    data: billing,
    isLoading: billingLoading,
  } = useQuery({
    queryKey: ["billingStatus"],
    queryFn: async (): Promise<BillingStatus> => {
      const response = await fetch("/api/billing/status");
      if (!response.ok) {
        throw new Error("Failed to load billing status");
      }
      return response.json() as Promise<BillingStatus>;
    },
  });

  const {
    data: dashboard,
    isLoading: dashboardLoading,
  } = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: async (): Promise<DashboardSummary> => {
      const response = await fetch("/api/dashboard");
      if (!response.ok) {
        throw new Error("Failed to load usage");
      }
      return response.json() as Promise<DashboardSummary>;
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (planId: "growth" | "scale") => {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (!response.ok) {
        throw new Error("Failed to start checkout");
      }
      return response.json() as Promise<{ url?: string }>;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to open billing portal");
      }
      return response.json() as Promise<{ url?: string }>;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const hasSubscription =
    billing &&
    billing.planId != null &&
    (billing.status === "active" || billing.status === "trialing");

  function handleManageBilling() {
    if (hasSubscription) {
      portalMutation.mutate();
    } else {
      checkoutMutation.mutate("growth");
    }
  }

  const isLoading = billingLoading || dashboardLoading;
  const planName = useMemo(
    () => formatPlanName(billing?.planId ?? null),
    [billing?.planId],
  );
  const statusLabel = useMemo(
    () => formatStatusLabel(billing?.status ?? "none"),
    [billing?.status],
  );

  return (
    <div className="space-y-6 bg-background">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Billing & subscription
        </h1>
        <p className="text-muted-foreground">
          View your current plan, usage, and manage your UnlockAffiliate
          subscription.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-card/50 rounded-3xl shadow-xs border-border/60">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              Current plan
            </CardTitle>
            <CardDescription>
              Your UnlockAffiliate subscription and renewal details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading billing…</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-semibold">{planName}</span>
                  <Badge
                    variant={
                      billing?.status === "active" || billing?.status === "trialing"
                        ? "default"
                        : billing?.status === "past_due"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {statusLabel}
                  </Badge>
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    Next renewal:{" "}
                    <span className="font-medium text-foreground">
                      {formatDate(billing?.currentPeriodEnd ?? null)}
                    </span>
                  </p>
                  {billing?.cancelAtPeriodEnd && (
                    <p className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertCircle className="w-3 h-3" />
                      Subscription will cancel at the end of the current period.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleManageBilling}
                    disabled={portalMutation.isPending || checkoutMutation.isPending}
                  >
                    <Settings className="w-4 h-4 mr-1.5" />
                    Manage billing
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 rounded-3xl shadow-xs border-border/60 lg:col-span-2">
          <CardHeader className="space-y-2">
            <CardTitle>Usage overview</CardTitle>
            <CardDescription>
              High-level view of how much value your affiliate program is driving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <p className="text-sm text-muted-foreground">Loading usage…</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-background/60 border border-border/40 p-4">
                  <p className="text-xs text-muted-foreground mb-1">
                    Total referred revenue
                  </p>
                  <p className="text-2xl font-semibold">
                    ${dashboard?.revenue.total.toLocaleString() ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-background/60 border border-border/40 p-4">
                  <p className="text-xs text-muted-foreground mb-1">
                    Referred customers
                  </p>
                  <p className="text-2xl font-semibold">
                    {dashboard?.newCustomers ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-background/60 border border-border/40 p-4">
                  <p className="text-xs text-muted-foreground mb-1">
                    Unique clicks
                  </p>
                  <p className="text-2xl font-semibold">
                    {dashboard?.clicks ?? 0}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Billing;

