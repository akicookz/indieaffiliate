import { useQuery } from "@tanstack/react-query";
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
    // Handle "cancels_on:2025-03-15" format
    if (stripe.startsWith("cancels_on:")) {
      const date = stripe.split(":").slice(1).join(":");
      return {
        label: `Cancels ${new Date(date).toLocaleDateString()}`,
        style: "bg-orange-100 text-orange-800",
      };
    }
    const stripeStyles: Record<string, { label: string; style: string }> = {
      active: { label: "Active", style: "bg-green-100 text-green-800" },
      trialing: { label: "Trialing", style: "bg-blue-100 text-blue-800" },
      past_due: { label: "Past Due", style: "bg-red-100 text-red-800" },
      cancelled: { label: "Cancelled", style: "bg-gray-100 text-gray-800" },
      refunded: { label: "Refunded", style: "bg-purple-100 text-purple-800" },
      paid: { label: "Paid", style: "bg-green-100 text-green-800" },
    };
    return stripeStyles[stripe] ?? { label: stripe, style: "bg-gray-100 text-gray-800" };
  }

  // Fall back to local status
  const localStyles: Record<string, { label: string; style: string }> = {
    trialing: { label: "Trialing", style: "bg-blue-100 text-blue-800" },
    paid: { label: "Paid", style: "bg-green-100 text-green-800" },
    cancelled: { label: "Cancelled", style: "bg-gray-100 text-gray-800" },
    past_due: { label: "Past Due", style: "bg-red-100 text-red-800" },
    refunded: { label: "Refunded", style: "bg-purple-100 text-purple-800" },
    cancels_on: { label: "Cancelling", style: "bg-orange-100 text-orange-800" },
  };
  return localStyles[referral.status] ?? { label: referral.status, style: "bg-gray-100 text-gray-800" };
}

function PortalReferrals() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-referrals"],
    queryFn: async (): Promise<{ referrals: Referral[] }> => {
      const response = await fetch("/api/partner/referrals");
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load referrals");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading referrals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">{error.message}</div>
      </div>
    );
  }

  const referrals = data?.referrals ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Referred Customers
        </h1>
        <p className="text-muted-foreground">
          Customers who signed up using your referral link.
          Names are masked for privacy.
        </p>
      </div>

      <div className="bg-card/50 border border-border rounded-2xl p-6 shadow-xs">
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
