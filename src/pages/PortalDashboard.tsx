import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  MousePointer,
  Users,
  TrendingUp,
  Clock,
  CheckCircle,
  Copy,
} from "lucide-react";
import { useState } from "react";
import StatCard from "@/components/StatCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface PartnerDashboardData {
  partner: {
    name: string;
    email: string;
    referralCode: string;
    commissionRate: number;
    status: string;
  };
  programs: Array<{
    id: string;
    projectId: string;
    referralCode: string;
    commissionRate: number;
    status: string;
  }>;
  stats: {
    totalEarnings: number;
    pendingEarnings: number;
    approvedEarnings: number;
    paidEarnings: number;
    totalClicks: number;
    uniqueClicks: number;
    totalReferrals: number;
    conversionRate: number;
  };
}

interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
}

function PortalDashboard() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-dashboard"],
    queryFn: async (): Promise<PartnerDashboardData> => {
      const response = await fetch("/api/partner/dashboard");
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load dashboard");
      }
      return response.json();
    },
  });

  const { data: payoutsData } = useQuery({
    queryKey: ["partner-payouts"],
    queryFn: async (): Promise<{ payouts: Payout[] }> => {
      const response = await fetch("/api/partner/payouts");
      if (!response.ok) throw new Error("Failed to load payouts");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          {error.message}
        </div>
      </div>
    );
  }

  const referralLink = `${window.location.origin}/api/t/${data?.partner.referralCode}`;

  function handleCopyLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getPayoutStatusBadge(status: string) {
    const styles: Record<string, string> = {
      scheduled: "bg-yellow-100 text-yellow-800",
      paid: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${
          styles[status] ?? ""
        }`}
      >
        {status}
      </span>
    );
  }

  const recentPayouts = payoutsData?.payouts.slice(0, 5) ?? [];

  return (
    <div className="space-y-8">
      {/* Welcome + Referral Link */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Welcome back, {data?.partner.name}
        </h1>
        <p className="text-muted-foreground mt-1">
          Commission rate: {Math.round((data?.partner.commissionRate ?? 0) * 100)}%
        </p>
      </div>

      {/* Referral Link Card */}
      <div className="bg-card/50 border border-border rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground">
            Your Referral Link
          </h3>
          <span className="text-xs font-mono text-muted-foreground">
            Code: {data?.partner.referralCode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-lg truncate text-foreground">
            {referralLink}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="shrink-0"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Earnings"
          value={`$${(data?.stats.totalEarnings ?? 0).toFixed(2)}`}
          Icon={DollarSign}
        />
        <StatCard
          title="Pending"
          value={`$${(data?.stats.pendingEarnings ?? 0).toFixed(2)}`}
          Icon={Clock}
        />
        <StatCard
          title="Paid Out"
          value={`$${(data?.stats.paidEarnings ?? 0).toFixed(2)}`}
          Icon={CheckCircle}
        />
        <StatCard
          title="Conversion Rate"
          value={`${data?.stats.conversionRate ?? 0}%`}
          Icon={TrendingUp}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Clicks"
          value={(data?.stats.totalClicks ?? 0).toLocaleString()}
          Icon={MousePointer}
        />
        <StatCard
          title="Unique Clicks"
          value={(data?.stats.uniqueClicks ?? 0).toLocaleString()}
          Icon={MousePointer}
        />
        <StatCard
          title="Referrals"
          value={(data?.stats.totalReferrals ?? 0).toLocaleString()}
          Icon={Users}
        />
      </div>

      {/* Recent Payouts */}
      <div className="bg-card/50 border border-border rounded-2xl p-6 shadow-xs">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Recent Payouts
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentPayouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell className="font-medium">
                  ${payout.amount.toFixed(2)} {payout.currency}
                </TableCell>
                <TableCell>{getPayoutStatusBadge(payout.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {payout.periodStart && payout.periodEnd
                    ? `${new Date(payout.periodStart).toLocaleDateString()} - ${new Date(payout.periodEnd).toLocaleDateString()}`
                    : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {payout.paidAt
                    ? new Date(payout.paidAt).toLocaleDateString()
                    : new Date(payout.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {recentPayouts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-8"
                >
                  No payouts yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PortalDashboard;
