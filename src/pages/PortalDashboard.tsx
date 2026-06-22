import { useState } from "react";
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

import StatCard from "@/components/StatCard";
import PartnerPayoutMethodCard from "@/components/PartnerPayoutMethodCard";
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
    payoutLink: string | null;
    commissionProgram: CommissionProgram | null;
    usesDefaultCommissionProgram: boolean;
    defaultCommissionProgramId: string | null;
  };
  programs: Array<{
    id: string;
    projectId: string;
    referralCode: string;
    commissionRate: number;
    status: string;
    commissionProgram: CommissionProgram | null;
    usesDefaultCommissionProgram: boolean;
    defaultCommissionProgramId: string | null;
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

interface CommissionProgram {
  id: string;
  name: string;
  rate: number;
  type: string;
  durationMonths: number | null;
  flatAmount: number | null;
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

function formatProgramAmount(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function commissionPlanCopy(
  partner: PartnerDashboardData["partner"] | undefined,
): { primary: string; secondary: string } {
  if (!partner) return { primary: "No plan", secondary: "Unavailable" };
  const program = partner.commissionProgram;
  if (!program) {
    return {
      primary: `${Math.round(partner.commissionRate * 100)}%`,
      secondary: partner.defaultCommissionProgramId
        ? "Project default unavailable"
        : "Fallback rate",
    };
  }
  const primary =
    program.type === "one-time" &&
    program.flatAmount != null &&
    program.flatAmount > 0
      ? `${formatProgramAmount(program.flatAmount)} flat · one-time`
      : `${program.rate}% · ${program.type}`;
  return {
    primary,
    secondary: partner.usesDefaultCommissionProgram
      ? `Project default · ${program.name}`
      : program.name,
  };
}

function CommissionPlanCard({
  partner,
}: {
  partner: PartnerDashboardData["partner"] | undefined;
}) {
  const copy = commissionPlanCopy(partner);
  return (
    <div className="bg-card border border-border rounded-md p-5">
      <p className="text-sm font-medium text-foreground">Commission plan</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {copy.primary}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{copy.secondary}</p>
    </div>
  );
}

function PortalDashboard() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-dashboard"],
    queryFn: async (): Promise<PartnerDashboardData> => {
      const response = await fetch("/api/partner/dashboard", {
        credentials: "include",
      });
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
      const response = await fetch("/api/partner/payouts", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load payouts");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 rounded-md border border-border bg-card p-8">
        <p className="text-sm text-destructive">{error.message}</p>
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
      scheduled: "bg-warning/15 text-warning",
      paid: "bg-positive/15 text-positive",
      failed: "bg-destructive/15 text-destructive",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border capitalize ${
          styles[status] ?? "bg-muted text-muted-foreground"
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
          Welcome back{data?.partner?.name?.trim() ? `, ${data.partner.name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">
          {commissionPlanCopy(data?.partner).secondary}
        </p>
      </div>

      {/* Referral Link Card */}
      <div className="bg-card border border-border rounded-md p-5">
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
            variant="secondary"
            size="sm"
            onClick={handleCopyLink}
            className="shrink-0"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CommissionPlanCard partner={data?.partner} />
        <PartnerPayoutMethodCard currentLink={data?.partner.payoutLink ?? null} />
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
      <div className="bg-card border border-border rounded-md p-6">
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
