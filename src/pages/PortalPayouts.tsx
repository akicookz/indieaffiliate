import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
} from "lucide-react";

import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import PartnerPayoutMethodCard from "@/components/PartnerPayoutMethodCard";
import { describeSchedule } from "@/lib/payout-schedule";
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
    commissionProgram: {
      minPayout: number;
      payoutCadence: "monthly_day" | "monthly_ordinal" | "weekly" | null;
      payoutDayOfMonth: number | null;
      payoutDayOfWeek: number | null;
      payoutOrdinal: number | null;
    } | null;
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

interface PayoutLineItem {
  commissionId: string;
  amount: number;
  customer: string;
  eventDate: string | null;
}

function PayoutLineItems({ payoutId }: { payoutId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-payout-items", payoutId],
    queryFn: async (): Promise<{ commissions: PayoutLineItem[] }> => {
      const response = await fetch(
        `/api/partner/payouts/${payoutId}/commissions`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load payout details");
      return response.json();
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading details…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">Could not load payout details.</p>
    );
  }
  const items = data?.commissions ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No commission details for this payout.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        This payout covered {items.length} commission
        {items.length === 1 ? "" : "s"}:
      </p>
      {items.map((item) => (
        <div
          key={item.commissionId}
          className="flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground">
            {item.customer}
            {item.eventDate ? ` · ${formatShortDate(item.eventDate)}` : ""}
          </span>
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(item.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PortalPayouts() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 rounded-lg shadow-card bg-card p-8">
        <p className="text-sm text-destructive">{loadError.message}</p>
      </div>
    );
  }

  const payoutsList = data?.payouts ?? [];

  const totals = payoutsList.reduce(
    (acc, p) => {
      if (p.status === "paid") acc.paid += p.amount;
      return acc;
    },
    { paid: 0 },
  );
  const stats = statsData?.stats;
  const program = statsData?.partner.commissionProgram ?? null;
  const scheduleText = program
    ? describeSchedule({
        cadence: program.payoutCadence,
        dayOfMonth: program.payoutDayOfMonth,
        dayOfWeek: program.payoutDayOfWeek,
        ordinal: program.payoutOrdinal,
      })
    : "No schedule set";
  const minPayout = program?.minPayout ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        subtitle="Your approved balance, when you get paid, and your payout history"
      />

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
          title="Minimum payout"
          value={formatCurrency(minPayout)}
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

        <div className="bg-card shadow-card rounded-lg p-5">
          <p className="text-sm font-medium text-foreground">Next payout basis</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(stats?.approvedEarnings ?? 0)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You get paid once your approved balance reaches the{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(minPayout)}
            </span>{" "}
            minimum
            {scheduleText !== "No schedule set" ? (
              <>
                {" "}
                — payouts run{" "}
                <span className="font-medium text-foreground">
                  {scheduleText.toLowerCase()}
                </span>
              </>
            ) : null}
            . The project owner sends payment to your payout method above.
          </p>
        </div>
      </div>

      <div className="bg-card shadow-card rounded-lg p-6">
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
              <Fragment key={payout.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedId((prev) =>
                      prev === payout.id ? null : payout.id,
                    )
                  }
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {expandedId === payout.id ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      ${payout.amount.toFixed(2)} {payout.currency}
                    </span>
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
                {expandedId === payout.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/30">
                      <PayoutLineItems payoutId={payout.id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {payoutsList.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No payouts yet. Once the project owner pays you, your payouts appear here.
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
