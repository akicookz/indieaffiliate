import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle,
  Clock,
  DollarSign,
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

interface PartnerDashboardStats {
  partner: {
    payoutLink: string | null;
  };
  stats: {
    pendingEarnings: number;
    approvedEarnings: number;
    paidEarnings: number;
  };
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatShortDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPayoutPeriod(payout: Payout): string {
  if (!payout.periodStart || !payout.periodEnd) return "-";
  return `${formatShortDate(payout.periodStart)} - ${formatShortDate(payout.periodEnd)}`;
}

function getStatusBadge(status: string) {
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

function PortalPayouts() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-payouts-full"],
    queryFn: async (): Promise<{ payouts: Payout[] }> => {
      const response = await fetch("/api/partner/payouts", {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load payouts");
      }
      return response.json();
    },
  });

  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ["partner-dashboard"],
    queryFn: async (): Promise<PartnerDashboardStats> => {
      const response = await fetch("/api/partner/dashboard", {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load payout totals");
      }
      return response.json();
    },
  });

  if (isLoading || statsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading payouts…</p>
      </div>
    );
  }

  const loadError = error ?? statsError;
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 rounded-md border border-border bg-card p-8">
        <p className="text-sm text-destructive">{loadError.message}</p>
      </div>
    );
  }

  const payoutsList = data?.payouts ?? [];

  const totals = payoutsList.reduce(
    (acc, p) => {
      if (p.status === "paid") acc.paid += p.amount;
      if (p.status === "scheduled") acc.scheduled += p.amount;
      return acc;
    },
    { paid: 0, scheduled: 0 },
  );
  const stats = statsData?.stats;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Payouts</h1>
        <p className="text-muted-foreground">
          Approved earnings, scheduled payouts, and payout history
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Pending Review"
          value={formatCurrency(stats?.pendingEarnings ?? 0)}
          Icon={Clock}
        />
        <StatCard
          title="Approved"
          value={formatCurrency(stats?.approvedEarnings ?? 0)}
          Icon={DollarSign}
        />
        <StatCard
          title="Scheduled"
          value={formatCurrency(totals.scheduled)}
          Icon={CalendarClock}
        />
        <StatCard
          title="Paid Out"
          value={formatCurrency(
            totals.paid > 0 ? totals.paid : (stats?.paidEarnings ?? 0),
          )}
          Icon={CheckCircle}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PartnerPayoutMethodCard
            currentLink={statsData?.partner.payoutLink ?? null}
          />
        </div>

        <div className="bg-card border border-border rounded-md p-5">
          <p className="text-sm font-medium text-foreground">Next payout basis</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(stats?.approvedEarnings ?? 0)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Approved earnings become payable when the program minimum and payout
            schedule are met.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-6">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-foreground">Payout history</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Paid Date</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payoutsList.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell className="font-medium">
                  ${payout.amount.toFixed(2)} {payout.currency}
                </TableCell>
                <TableCell>{getStatusBadge(payout.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatPayoutPeriod(payout)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatShortDate(payout.paidAt)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {payout.note ?? "-"}
                </TableCell>
              </TableRow>
            ))}
            {payoutsList.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No payouts yet. Payouts will appear here once they are scheduled by the project owner.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PortalPayouts;
