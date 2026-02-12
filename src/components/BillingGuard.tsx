import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

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

function BillingGuard({ children }: { children: React.ReactNode }) {
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["billingStatus"],
    queryFn: async (): Promise<BillingStatus> => {
      const response = await fetch("/api/billing/status");
      if (response.status === 401) {
        // Let AuthGuard handle unauthenticated state
        throw new Error("Unauthorized");
      }
      if (!response.ok) {
        throw new Error("Failed to load billing status");
      }
      return response.json() as Promise<BillingStatus>;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Checking billing status...</div>
      </div>
    );
  }

  if (error) {
    // On billing check failure, send user to pricing to resolve
    return <Navigate to="/pricing" replace />;
  }

  const status = data?.status ?? "none";
  // Allow:
  // - "none": free Starter plan (no Stripe subscription)
  // - "trialing" / "active": paid plans in good standing
  const isAllowed =
    status === "none" || status === "active" || status === "trialing";

  if (!isAllowed) {
    return <Navigate to="/app/billing" replace />;
  }

  return <>{children}</>;
}

export default BillingGuard;

