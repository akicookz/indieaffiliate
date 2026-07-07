import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Referral {
  id: string;
  maskedName: string;
  maskedEmail: string;
  status: string;
  revenue: number;
  createdAt: string;
  stripeStatus: string | null;
}

function getDisplayStatus(referral: Referral): { label: string; style: string } {
  const stripe = referral.stripeStatus;
  if (stripe) {
    if (stripe.startsWith("cancels_on:")) {
      const date = stripe.split(":").slice(1).join(":");
      return {
        label: `Cancels ${new Date(date).toLocaleDateString()}`,
        style: "bg-warning/15 text-warning",
      };
    }
    const stripeStyles: Record<string, { label: string; style: string }> = {
      active: { label: "Active", style: "bg-positive/15 text-positive" },
      trialing: { label: "Trialing", style: "bg-info/15 text-info" },
      past_due: { label: "Past Due", style: "bg-destructive/15 text-destructive" },
      cancelled: { label: "Cancelled", style: "bg-muted text-muted-foreground" },
      refunded: { label: "Refunded", style: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
      paid: { label: "Paid", style: "bg-positive/15 text-positive" },
    };
    return stripeStyles[stripe] ?? { label: stripe, style: "bg-muted text-muted-foreground" };
  }

  const localStyles: Record<string, { label: string; style: string }> = {
    trialing: { label: "Trialing", style: "bg-info/15 text-info" },
    paid: { label: "Paid", style: "bg-positive/15 text-positive" },
    cancelled: { label: "Cancelled", style: "bg-muted text-muted-foreground" },
    past_due: { label: "Past Due", style: "bg-destructive/15 text-destructive" },
    refunded: { label: "Refunded", style: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
    cancels_on: { label: "Cancelling", style: "bg-warning/15 text-warning" },
  };
  return localStyles[referral.status] ?? { label: referral.status, style: "bg-muted text-muted-foreground" };
}

function PortalReferrals() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-referrals"],
    queryFn: async (): Promise<{ referrals: Referral[] }> => {
      const response = await fetch("/api/partner/referrals", {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load referrals");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading referrals…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 rounded-lg shadow-card bg-card p-8">
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    );
  }

  const referrals = data?.referrals ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referred Customers"
        subtitle="Customers who signed up using your referral link. Names are masked for privacy."
      />

      <div className="bg-card shadow-card rounded-lg p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Referred On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {referrals.map((referral) => {
              const displayStatus = getDisplayStatus(referral);
              return (
                <TableRow key={referral.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{referral.maskedName}</div>
                      <div className="text-sm text-muted-foreground">
                        {referral.maskedEmail}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${displayStatus.style}`}
                    >
                      {displayStatus.label}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    ${referral.revenue.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(referral.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              );
            })}
            {referrals.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-8"
                >
                  No referrals yet. Share your referral link to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PortalReferrals;
