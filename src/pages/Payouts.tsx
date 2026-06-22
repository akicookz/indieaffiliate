import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  CreditCard,
  Calendar,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import StatCard from "@/components/StatCard";
import {
  describeSchedule,
  formatScheduleDate,
  nextPayoutDate,
  type PayoutCadence,
  type PayoutSchedule,
} from "@/lib/payout-schedule";
import { parsePayoutMethod } from "@/lib/payout-method";

interface CommissionDetail {
  id: string;
  customerId: string;
  customerEmail: string;
  customerStatus: string | null;
  customerRevenue: number;
  amount: number;
  rate: number;
  status: "pending" | "approved" | "paid" | "rejected";
  fraudFlag: string | null;
  externalEventId: string | null;
  projectName: string;
  eventDate: string | null;
  createdAt: string;
  monthIndex: number | null;
  durationMonths: number | null;
  monthsRemaining: number | null;
  programType: "recurring" | "lifetime" | "one-time" | null;
  programName: string | null;
  programMinPayout: number | null;
  payoutCadence: PayoutCadence | null;
  payoutDayOfMonth: number | null;
  payoutDayOfWeek: number | null;
  payoutOrdinal: number | null;
}

interface PendingPayoutRow {
  paymentId: string;
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  customerEmail: string | null;
  customerName: string | null;
  source: "stripe";
  kind: "subscription" | "one_time";
  subscriptionId?: string;
  eventId: string;
  eventDate: number;
  revenue: number;
  mrr: number | null;
  rate: number;
  flatAmount: number | null;
  commissionAmount: number;
  programType: "recurring" | "lifetime" | "one-time";
  programName: string;
  monthIndex: number | null;
  durationMonths: number | null;
  monthsRemaining: number | null;
  isFinalMonth: boolean;
}

function MonthBadge({
  programType,
  monthIndex,
  durationMonths,
  monthsRemaining,
  isFinalMonth,
}: {
  programType: "recurring" | "lifetime" | "one-time" | null;
  monthIndex: number | null;
  durationMonths: number | null;
  monthsRemaining: number | null;
  isFinalMonth?: boolean;
}) {
  if (programType === "lifetime") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-info/10 text-info border border-info/20">
        Lifetime
      </span>
    );
  }
  if (programType === "one-time") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
        One-time
      </span>
    );
  }
  if (programType === "recurring" && monthIndex != null && durationMonths != null) {
    return (
      <div className="inline-flex items-center gap-1">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-info/10 text-info border border-info/20">
          Month {monthIndex} of {durationMonths}
          {monthsRemaining != null && monthsRemaining > 0 && (
            <span className="ml-1 text-info/70">· {monthsRemaining} left</span>
          )}
        </span>
        {isFinalMonth && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning border border-warning/20">
            Final month
          </span>
        )}
      </div>
    );
  }
  return null;
}

interface PartnerGroup {
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  payoutLink: string | null;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  paidCount: number;
  paidAmount: number;
  rejectedCount: number;
  rejectedAmount: number;
  commissions: CommissionDetail[];
}

interface GroupedResponse {
  partners: PartnerGroup[];
  totals: {
    pendingAmount: number;
    approvedAmount: number;
    paidAmount: number;
  };
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface PayoutRecord {
  id: string;
  projectId: string;
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  projectName: string;
  amount: number;
  currency: string;
  status: "scheduled" | "paid" | "failed";
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  commissionCount: number;
}

type PayoutStatus = PayoutRecord["status"];
type PayoutStatusFilter = PayoutStatus | "all";

const PAYOUT_STATUS_OPTIONS: PayoutStatus[] = ["scheduled", "paid", "failed"];

interface PayoutStats {
  totalPayouts: number;
  scheduledAmount: number;
  paidAmount: number;
  failedAmount: number;
}

interface PayoutRecordsResponse {
  payouts: PayoutRecord[];
  stats: PayoutStats;
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning",
    approved: "bg-info/10 text-info",
    paid: "bg-positive/10 text-positive",
    rejected: "bg-negative/10 text-negative",
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

function getPayoutStatusBadge(status: PayoutRecord["status"]) {
  const styles: Record<PayoutRecord["status"], string> = {
    scheduled: "bg-warning/10 text-warning",
    paid: "bg-positive/10 text-positive",
    failed: "bg-negative/10 text-negative",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function sumCommissionAmounts(commissions: CommissionDetail[]): number {
  return commissions.reduce((total, commission) => total + commission.amount, 0);
}

function isApprovalEligibleCommission(commission: CommissionDetail): boolean {
  return commission.status === "pending" && !commission.fraudFlag;
}

function isPayEligibleCommission(commission: CommissionDetail): boolean {
  return commission.status === "approved" && !commission.fraudFlag;
}

interface PayoutEligibility {
  approvedCount: number;
  commissions: CommissionDetail[];
  count: number;
  amount: number;
  minPayout: number | null;
  belowMinimum: boolean;
  shortfall: number;
  flaggedApprovedCount: number;
  futureCount: number;
  futureAmount: number;
  nextDueDate: Date | null;
}

function commissionDueDate(commission: CommissionDetail): Date | null {
  const schedule = commissionSchedule(commission);
  if (!schedule) return null;
  const basis = commission.eventDate ?? commission.createdAt;
  const basisDate = basis ? new Date(basis) : new Date();
  if (Number.isNaN(basisDate.getTime())) return null;
  return nextPayoutDate(schedule, basisDate);
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isCommissionDue(commission: CommissionDetail): boolean {
  const dueDate = commissionDueDate(commission);
  if (!dueDate) return true;
  return dueDate.getTime() <= startOfDay(new Date()).getTime();
}

function getPayoutEligibility(commissions: CommissionDetail[]): PayoutEligibility {
  const approved = commissions.filter(isPayEligibleCommission);
  const eligible = approved.filter(isCommissionDue);
  const future = approved.filter((commission) => !isCommissionDue(commission));
  const amount = sumCommissionAmounts(eligible);
  const minPayouts = eligible
    .map((commission) => commission.programMinPayout)
    .filter((value): value is number => typeof value === "number");
  const minPayout = minPayouts.length > 0 ? Math.max(...minPayouts) : null;
  const belowMinimum =
    minPayout != null && eligible.length > 0 && amount + 0.005 < minPayout;

  return {
    approvedCount: approved.length,
    commissions: eligible,
    count: eligible.length,
    amount,
    minPayout,
    belowMinimum,
    shortfall:
      belowMinimum && minPayout != null ? Math.max(0, minPayout - amount) : 0,
    flaggedApprovedCount: commissions.filter(
      (commission) =>
        commission.status === "approved" && !!commission.fraudFlag,
    ).length,
    futureCount: future.length,
    futureAmount: sumCommissionAmounts(future),
    nextDueDate:
      future
        .map(commissionDueDate)
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
  };
}

function getPayBlocker(
  commissions: CommissionDetail[],
  payoutLink: string | null,
): string | null {
  const eligibility = getPayoutEligibility(commissions);
  if (eligibility.approvedCount === 0) {
    return "No unflagged approved commissions are eligible for payout.";
  }
  if (eligibility.count === 0 && eligibility.nextDueDate) {
    return `Next payout date is ${formatScheduleDate(eligibility.nextDueDate)}.`;
  }
  if (!payoutLink?.trim()) {
    return "Partner needs a payout method before commissions can be marked paid.";
  }
  if (eligibility.belowMinimum) {
    return `Needs ${formatCurrency(
      eligibility.shortfall,
    )} more approved commission to meet the minimum payout.`;
  }
  return null;
}

function PayoutMethodDisplay({
  value,
  showMissing = true,
}: {
  value: string | null;
  showMissing?: boolean;
}) {
  const method = parsePayoutMethod(value);
  if (!method) {
    if (!showMissing) return null;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="w-3 h-3" />
        Missing method
      </span>
    );
  }

  if (method.href) {
    return (
      <a
        href={method.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-[12rem] items-center gap-1 text-xs text-primary hover:underline"
        title={method.label}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{method.displayValue}</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </a>
    );
  }

  return (
    <span
      className="inline-flex max-w-[12rem] items-center gap-1 text-xs text-muted-foreground"
      title={method.label}
    >
      <CreditCard className="w-3 h-3 shrink-0" />
      <span className="truncate">{method.displayValue}</span>
    </span>
  );
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

function formatPayoutPeriod(payout: PayoutRecord): string {
  if (!payout.periodStart || !payout.periodEnd) return "-";
  return `${formatShortDate(payout.periodStart)} - ${formatShortDate(payout.periodEnd)}`;
}

function scheduleKey(schedule: PayoutSchedule): string {
  return [
    schedule.cadence ?? "",
    schedule.dayOfMonth ?? "",
    schedule.dayOfWeek ?? "",
    schedule.ordinal ?? "",
  ].join(":");
}

function commissionSchedule(c: CommissionDetail): PayoutSchedule | null {
  if (!c.payoutCadence) return null;
  return {
    cadence: c.payoutCadence,
    dayOfMonth: c.payoutDayOfMonth,
    dayOfWeek: c.payoutDayOfWeek,
    ordinal: c.payoutOrdinal,
  };
}

interface PartnerPayoutPolicy {
  minPayout: number | null;
  schedule: PayoutSchedule | null;
  scheduleLabel: string;
  nextDateLabel: string | null;
  isMixedSchedule: boolean;
  belowMinimum: boolean;
  shortfall: number;
  eligibleCount: number;
  eligibleAmount: number;
  futureCount: number;
  futureAmount: number;
  flaggedApprovedCount: number;
}

function getPartnerPayoutPolicy(partner: PartnerGroup): PartnerPayoutPolicy {
  const eligibility = getPayoutEligibility(partner.commissions);
  const approved = eligibility.commissions;

  const scheduleEntries = approved
    .map(commissionSchedule)
    .filter((schedule): schedule is PayoutSchedule => !!schedule);
  const uniqueSchedules = new Map(
    scheduleEntries.map((schedule) => [scheduleKey(schedule), schedule]),
  );
  const schedule =
    uniqueSchedules.size === 1
      ? Array.from(uniqueSchedules.values())[0] ?? null
      : null;
  const nextDate = schedule ? nextPayoutDate(schedule) : null;
  const displayNextDate = eligibility.nextDueDate ?? nextDate;

  return {
    minPayout: eligibility.minPayout,
    schedule,
    scheduleLabel:
      uniqueSchedules.size > 1
        ? "Multiple schedules"
        : describeSchedule(schedule),
    nextDateLabel: displayNextDate ? formatScheduleDate(displayNextDate) : null,
    isMixedSchedule: uniqueSchedules.size > 1,
    belowMinimum: eligibility.belowMinimum,
    shortfall: eligibility.shortfall,
    eligibleCount: eligibility.count,
    eligibleAmount: eligibility.amount,
    futureCount: eligibility.futureCount,
    futureAmount: eligibility.futureAmount,
    flaggedApprovedCount: eligibility.flaggedApprovedCount,
  };
}

function getStatusTextClass(status: string): string {
  switch (status) {
    case "paid":
      return "text-positive";
    case "approved":
      return "text-info";
    case "pending":
      return "text-warning";
    case "rejected":
      return "text-negative";
    default:
      return "text-muted-foreground";
  }
}

function canChooseCommissionStatus(
  commission: CommissionDetail,
  nextStatus: CommissionDetail["status"],
): boolean {
  if (nextStatus === commission.status) return true;
  if (nextStatus === "approved") {
    return isApprovalEligibleCommission(commission);
  }
  if (nextStatus === "paid") {
    return isPayEligibleCommission(commission);
  }
  if (nextStatus === "rejected") {
    return commission.status !== "paid";
  }
  return false;
}

function StatusText({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={`text-xs font-medium uppercase tracking-wide ${getStatusTextClass(status)} ${className}`}
    >
      {status}
    </span>
  );
}

function getCustomerStatusTextClass(status: string | null): string {
  if (!status) return "";
  switch (status) {
    case "paid":
      return "text-positive";
    case "trialing":
      return "text-info";
    case "cancelled":
      return "text-negative";
    case "past_due":
    case "cancels_on":
      return "text-warning";
    case "refunded":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function getCustomerStatusLabel(status: string | null): string | null {
  if (!status) return null;
  const labels: Record<string, string> = {
    paid: "Active",
    trialing: "Trialing",
    cancelled: "Cancelled",
    past_due: "Past Due",
    refunded: "Refunded",
    cancels_on: "Cancels Soon",
  };
  return labels[status] ?? status;
}

function getCustomerStatusBadge(status: string | null) {
  if (!status) return null;
  const styles: Record<string, string> = {
    paid: "bg-positive/10 text-positive border-positive/20",
    trialing: "bg-info/10 text-info border-info/20",
    cancelled: "bg-negative/10 text-negative border-negative/20",
    past_due: "bg-warning/10 text-warning border-warning/20",
    refunded: "bg-muted text-muted-foreground border-border",
    cancels_on: "bg-warning/10 text-warning border-warning/20",
  };
  const labels: Record<string, string> = {
    paid: "Active",
    trialing: "Trialing",
    cancelled: "Cancelled",
    past_due: "Past Due",
    refunded: "Refunded",
    cancels_on: "Cancels Soon",
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
        styles[status] ?? "bg-muted text-muted-foreground border-border"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

interface MonthGroup {
  monthKey: string;
  monthLabel: string;
  commissions: CommissionDetail[];
}

interface CustomerGroup {
  customerKey: string;
  customerId: string;
  customerEmail: string;
  customerStatus: string | null;
  customerRevenue: number;
  commissions: CommissionDetail[];
  totalAmount: number;
  mostRecentEventTs: number;
}

function commissionTimestamp(c: CommissionDetail): number {
  const raw = c.eventDate ?? c.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function groupByCustomer(
  commissions: CommissionDetail[],
): CustomerGroup[] {
  const byCustomer = new Map<string, CustomerGroup>();
  for (const c of commissions) {
    const key = c.customerId || c.customerEmail || c.id;
    const existing = byCustomer.get(key);
    const ts = commissionTimestamp(c);
    if (existing) {
      existing.commissions.push(c);
      existing.totalAmount += c.amount;
      if (ts > existing.mostRecentEventTs) {
        existing.mostRecentEventTs = ts;
      }
      // Customer-level fields can drift if backend changes mid-list; prefer the
      // most-recent row's snapshot so the badge matches what the user sees.
      if (ts >= existing.mostRecentEventTs) {
        existing.customerStatus = c.customerStatus;
        existing.customerRevenue = c.customerRevenue;
      }
    } else {
      byCustomer.set(key, {
        customerKey: key,
        customerId: c.customerId,
        customerEmail: c.customerEmail,
        customerStatus: c.customerStatus,
        customerRevenue: c.customerRevenue,
        commissions: [c],
        totalAmount: c.amount,
        mostRecentEventTs: ts,
      });
    }
  }
  for (const group of byCustomer.values()) {
    group.commissions.sort(
      (a, b) => commissionTimestamp(b) - commissionTimestamp(a),
    );
  }
  return Array.from(byCustomer.values()).sort(
    (a, b) => b.mostRecentEventTs - a.mostRecentEventTs,
  );
}

function groupByMonth(commissions: CommissionDetail[]): MonthGroup[] {
  const byMonth = new Map<
    string,
    { monthLabel: string; commissions: CommissionDetail[] }
  >();
  for (const c of commissions) {
    const d = c.eventDate ?? c.createdAt;
    if (!d) continue;
    const date = new Date(d);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, "0")}`;
    const monthLabel = date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    const entry = byMonth.get(monthKey) ?? { monthLabel, commissions: [] };
    entry.commissions.push(c);
    byMonth.set(monthKey, entry);
  }
  return Array.from(byMonth.entries())
    .map(([monthKey, { monthLabel, commissions }]) => ({
      monthKey,
      monthLabel,
      commissions,
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function buildPaymentNote(partner: PartnerGroup) {
  const eligibility = getPayoutEligibility(partner.commissions);
  const approved = eligibility.commissions;
  if (eligibility.count === 0) return "";

  const projectName = approved[0]?.projectName ?? "Affiliate";

  const months = groupByMonth(approved).map(({ monthLabel, commissions }) => {
    const total = commissions.reduce((s, c) => s + c.amount, 0);
    const counts = new Map<number, number>();
    for (const c of commissions) {
      counts.set(c.amount, (counts.get(c.amount) ?? 0) + 1);
    }
    const items = Array.from(counts.entries())
      .map(([amt, n]) => `${formatCurrency(amt)} x${n}`)
      .join(", ");
    return `${monthLabel}: ${formatCurrency(total)} (${items})`;
  });

  return `${projectName} Affiliate payout ${formatCurrency(
    eligibility.amount,
  )}: ${months.join(", ")} - thank you!`;
}

function CopyNoteButton({ partner }: { partner: PartnerGroup }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const note = buildPaymentNote(partner);
    navigator.clipboard.writeText(note).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (getPayoutEligibility(partner.commissions).count === 0) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      className="h-7 text-xs"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 mr-1 text-positive" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3 mr-1 text-muted-foreground" />
          Copy Note
        </>
      )}
    </Button>
  );
}

const NON_ACTIVE_CUSTOMER_STATUSES = new Set([
  "cancelled",
  "past_due",
  "refunded",
]);

type SlotState = "paid" | "open";

function ProgressDonut({
  slots,
  size = 36,
  thickness = 5,
}: {
  slots: SlotState[];
  size?: number;
  thickness?: number;
}) {
  const n = slots.length;
  if (n === 0) return null;
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = n > 1 ? Math.min(2, circumference / n / 4) : 0;
  const segLen = Math.max(0, circumference / n - gap);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {slots.map((state, i) => {
        const offset = (i * circumference) / n;
        const isPaid = state === "paid";
        return (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={thickness}
            strokeDasharray={`${segLen} ${circumference}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${center} ${center})`}
            className={isPaid ? "text-positive" : "text-border"}
          />
        );
      })}
    </svg>
  );
}

interface CustomerRowData {
  customerKey: string;
  customerId: string;
  customerEmail: string;
  customerStatus: string | null;
  customerRevenue: number;
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  partnerPayoutLink: string | null;
  programType: "recurring" | "lifetime" | "one-time" | null;
  programName: string | null;
  durationMonths: number | null;
  commissions: CommissionDetail[];
  paidCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  totalAmount: number;
  paidAmount: number;
  approvedAmount: number;
  pendingAmount: number;
  slots: SlotState[];
  mostRecentEventTs: number;
}

function buildSlots(c: CustomerRowData["commissions"], data: {
  programType: CustomerRowData["programType"];
  durationMonths: number | null;
}): SlotState[] {
  const sorted = [...c].sort(
    (a, b) => commissionTimestamp(a) - commissionTimestamp(b),
  );

  if (data.programType === "recurring" && data.durationMonths != null) {
    const slots: SlotState[] = Array.from({ length: data.durationMonths }, () => "open");
    for (const comm of sorted) {
      const idx = comm.monthIndex;
      if (idx == null || idx < 1 || idx > data.durationMonths) continue;
      if (comm.status === "paid") slots[idx - 1] = "paid";
    }
    return slots;
  }

  if (data.programType === "one-time") {
    const anyPaid = sorted.some((x) => x.status === "paid");
    return [anyPaid ? "paid" : "open"];
  }

  // lifetime / unknown — slots = commissions chronologically
  return sorted.map((x) => (x.status === "paid" ? "paid" : "open"));
}

function flattenToCustomerRows(
  partnerGroups: PartnerGroup[],
): CustomerRowData[] {
  const byKey = new Map<string, CustomerRowData>();

  for (const partner of partnerGroups) {
    for (const c of partner.commissions) {
      const customerKey = `${partner.partnerId}::${c.customerId || c.customerEmail || c.id}`;
      const ts = commissionTimestamp(c);
      const existing = byKey.get(customerKey);
      if (existing) {
        existing.commissions.push(c);
        if (ts > existing.mostRecentEventTs) {
          existing.mostRecentEventTs = ts;
          existing.customerStatus = c.customerStatus;
          existing.customerRevenue = c.customerRevenue;
          if (c.programType) existing.programType = c.programType;
          if (c.programName) existing.programName = c.programName;
          if (c.durationMonths != null) existing.durationMonths = c.durationMonths;
        }
      } else {
        byKey.set(customerKey, {
          customerKey,
          customerId: c.customerId,
          customerEmail: c.customerEmail,
          customerStatus: c.customerStatus,
          customerRevenue: c.customerRevenue,
          partnerId: partner.partnerId,
          partnerName: partner.partnerName,
          partnerEmail: partner.partnerEmail,
          partnerPayoutLink: partner.payoutLink,
          programType: c.programType,
          programName: c.programName,
          durationMonths: c.durationMonths,
          commissions: [c],
          paidCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          approvedAmount: 0,
          pendingAmount: 0,
          slots: [],
          mostRecentEventTs: ts,
        });
      }
    }
  }

  for (const row of byKey.values()) {
    // Backfill programType/programName/durationMonths from any commission
    // that has them — the most-recent commission may not be the one that
    // carries the program info.
    for (const c of row.commissions) {
      if (!row.programType && c.programType) row.programType = c.programType;
      if (!row.programName && c.programName) row.programName = c.programName;
      if (row.durationMonths == null && c.durationMonths != null) {
        row.durationMonths = c.durationMonths;
      }

      row.totalAmount += c.amount;
      if (c.status === "paid") {
        row.paidCount++;
        row.paidAmount += c.amount;
      } else if (c.status === "approved") {
        row.approvedCount++;
        row.approvedAmount += c.amount;
      } else if (c.status === "pending") {
        row.pendingCount++;
        row.pendingAmount += c.amount;
      } else if (c.status === "rejected") {
        row.rejectedCount++;
      }
    }
    row.commissions.sort(
      (a, b) => commissionTimestamp(b) - commissionTimestamp(a),
    );
    row.slots = buildSlots(row.commissions, {
      programType: row.programType,
      durationMonths: row.durationMonths,
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => b.mostRecentEventTs - a.mostRecentEventTs,
  );
}

function PeriodView({
  partners,
  onBulkAction,
  onSingleAction,
  isMutating,
}: {
  partners: PartnerGroup[];
  onBulkAction: (ids: string[], action: "approve" | "pay" | "reject") => void;
  onSingleAction: (
    id: string,
    status: "approved" | "paid" | "rejected",
  ) => void;
  isMutating: boolean;
}) {
  const partnerNameById = new Map(
    partners.map((p) => [p.partnerId, p.partnerName]),
  );

  type FlatRow = CommissionDetail & {
    partnerId: string;
    partnerName: string;
    partnerPayoutLink: string | null;
  };

  const flat: FlatRow[] = partners.flatMap((p) =>
    p.commissions.map((c) => ({
      ...c,
      partnerId: p.partnerId,
      partnerName: partnerNameById.get(p.partnerId) ?? p.partnerName,
      partnerPayoutLink: p.payoutLink,
    })),
  );

  const months = groupByMonth(flat).map((g) => ({
    ...g,
    commissions: g.commissions as FlatRow[],
  }));

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (months[0]) s.add(months[0].monthKey);
    return s;
  });

  function toggleMonth(monthKey: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  const grandTotal = sumCommissionAmounts(flat);

  function getMonthPayBlocker(rows: FlatRow[]): string | null {
    const byPartner = new Map<
      string,
      {
        partnerName: string;
        payoutLink: string | null;
        commissions: CommissionDetail[];
      }
    >();

    for (const row of rows) {
      const group = byPartner.get(row.partnerId) ?? {
        partnerName: row.partnerName,
        payoutLink: row.partnerPayoutLink,
        commissions: [],
      };
      group.commissions.push(row);
      byPartner.set(row.partnerId, group);
    }

    for (const group of byPartner.values()) {
      const blocker = getPayBlocker(group.commissions, group.payoutLink);
      if (blocker) return `${group.partnerName}: ${blocker}`;
    }

    return null;
  }

  if (months.length === 0) {
    return (
      <div className="bg-card border rounded-md p-6 text-center text-sm text-muted-foreground">
        No commissions match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            By payout period
          </h3>
          <p className="text-xs text-muted-foreground">
            Approved commissions grouped by month. Older first.
          </p>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Total in view: </span>
          <span className="font-semibold tabular-nums">
            {formatCurrency(grandTotal)}
          </span>
        </div>
      </div>

      {months.map((month) => {
        const isExpanded = expandedMonths.has(month.monthKey);
        const monthTotal = month.commissions.reduce(
          (s, c) => s + c.amount,
          0,
        );
        const subKeys = new Set(
          month.commissions.map((c) => c.externalEventId ?? c.id),
        );
        const inactiveCount = month.commissions.filter(
          (c) =>
            c.customerStatus &&
            NON_ACTIVE_CUSTOMER_STATUSES.has(c.customerStatus),
        ).length;
        const payoutEligibility = getPayoutEligibility(month.commissions);
        const payableRows = payoutEligibility.commissions;
        const approvedIds = payableRows.map((c) => c.id);
        const monthPayableTotal = payoutEligibility.amount;
        const payBlocker = getMonthPayBlocker(month.commissions);

        return (
          <div
            key={month.monthKey}
            className="border rounded-md overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleMonth(month.monthKey)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 text-left"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-sm text-foreground">
                    {month.monthLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {month.commissions.length} commission
                    {month.commissions.length === 1 ? "" : "s"} · {subKeys.size}{" "}
                    sub{subKeys.size === 1 ? "" : "s"}
                  </span>
                  {inactiveCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="w-3 h-3" />
                      {inactiveCount} no longer active
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums">
                  {formatCurrency(monthTotal)}
                </div>
              {monthPayableTotal > 0 && monthPayableTotal !== monthTotal && (
                <div className="text-[10px] text-muted-foreground">
                  {formatCurrency(monthPayableTotal)} payable
                </div>
              )}
              {payoutEligibility.futureCount > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {formatCurrency(payoutEligibility.futureAmount)} scheduled
                </div>
              )}
              </div>
              {approvedIds.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs ml-2"
                  disabled={isMutating || !!payBlocker}
                  title={payBlocker ?? undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    const ok = window.confirm(
                      `Mark ${approvedIds.length} commission${
                        approvedIds.length === 1 ? "" : "s"
                      } in ${month.monthLabel} as paid? Total: ${formatCurrency(
                        monthPayableTotal,
                      )}.`,
                    );
                    if (ok) onBulkAction(approvedIds, "pay");
                  }}
                >
                  <CreditCard className="w-3 h-3 mr-1" />
                  Mark month paid
                </Button>
              )}
            </button>

            {isExpanded && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Sub status</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {month.commissions.map((c) => {
                    const payBlocker = getPayBlocker(
                      [c],
                      c.partnerPayoutLink,
                    );
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            to={`/app/customers?partner=${c.partnerId}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {c.partnerName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.customerEmail || "—"}
                        </TableCell>
                        <TableCell>
                          {getCustomerStatusBadge(c.customerStatus)}
                        </TableCell>
                        <TableCell>
                          <MonthBadge
                            programType={c.programType}
                            monthIndex={c.monthIndex}
                            durationMonths={c.durationMonths}
                            monthsRemaining={c.monthsRemaining}
                          />
                        </TableCell>
                        <TableCell>{getStatusBadge(c.status)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {formatCurrency(c.amount)}
                          <div className="text-[10px] text-muted-foreground font-normal">
                            @ {Math.round(c.rate * 100)}%
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {c.status === "approved" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={
                                isMutating ||
                                !!payBlocker ||
                                !isPayEligibleCommission(c)
                              }
                              title={payBlocker ?? undefined}
                              onClick={() => onSingleAction(c.id, "paid")}
                            >
                              <CreditCard className="w-3 h-3 mr-1" />
                              Mark paid
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PartnerRow({
  partner,
  isExpanded,
  onToggle,
  onBulkAction,
  onSingleAction,
  onFlagCustomer,
  isMutating,
}: {
  partner: PartnerGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onBulkAction: (ids: string[], action: "approve" | "pay" | "reject") => void;
  onSingleAction: (id: string, status: "approved" | "paid" | "rejected", fraudFlag?: string) => void;
  onFlagCustomer: (customerId: string, reason: string) => void;
  isMutating: boolean;
}) {
  const pendingIds = partner.commissions.filter(isApprovalEligibleCommission).map((c) => c.id);
  const payoutEligibility = getPayoutEligibility(partner.commissions);
  const approvedIds = payoutEligibility.commissions.map((c) => c.id);
  const flaggedPendingIds = partner.commissions.filter((c) => c.status === "pending" && c.fraudFlag).map((c) => c.id);
  const payoutPolicy = getPartnerPayoutPolicy(partner);
  const payBlocker = getPayBlocker(partner.commissions, partner.payoutLink);
  const canPayApproved = approvedIds.length > 0 && !payBlocker;

  return (
    <>
      {/* Partner summary row */}
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <TableCell className="w-8">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div>
            <Link
              to={`/app/customers?partner=${partner.partnerId}`}
              className="font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {partner.partnerName}
            </Link>
            <div className="text-sm text-muted-foreground">
              {partner.partnerEmail}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <PayoutMethodDisplay value={partner.payoutLink} />
        </TableCell>
        <TableCell>
          <div className="text-xs space-y-0.5">
            <div className="text-foreground">
              {payoutPolicy.minPayout != null
                ? `Min ${formatCurrency(payoutPolicy.minPayout)}`
                : "No minimum"}
            </div>
            <div className="text-muted-foreground">
              {payoutPolicy.scheduleLabel}
            </div>
            {payoutPolicy.nextDateLabel && !payoutPolicy.isMixedSchedule && (
              <div className="text-muted-foreground">
                Next {payoutPolicy.nextDateLabel}
              </div>
            )}
            {payoutPolicy.belowMinimum && (
              <div className="text-warning">
                {formatCurrency(payoutPolicy.shortfall)} short
              </div>
            )}
          </div>
        </TableCell>
        <TableCell>
          {partner.pendingCount > 0 ? (
            <div className="text-sm">
              <span className="font-medium text-warning">
                {formatCurrency(partner.pendingAmount)}
              </span>
              <span className="text-muted-foreground ml-1">({partner.pendingCount})</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>
          {partner.approvedCount > 0 ? (
            <div className="text-sm">
              <span className="font-medium text-info">
                {formatCurrency(partner.approvedAmount)}
              </span>
              <span className="text-muted-foreground ml-1">({partner.approvedCount})</span>
              {payoutEligibility.amount !== partner.approvedAmount && (
                <div className="text-[10px] text-muted-foreground">
                  {formatCurrency(payoutEligibility.amount)} payable
                </div>
              )}
              {payoutEligibility.flaggedApprovedCount > 0 && (
                <div className="text-[10px] text-negative">
                  {payoutEligibility.flaggedApprovedCount} flagged
                </div>
              )}
              {payoutEligibility.futureCount > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {formatCurrency(payoutEligibility.futureAmount)} scheduled
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>
          {partner.paidCount > 0 ? (
            <div className="text-sm">
              <span className="font-medium text-positive">
                {formatCurrency(partner.paidAmount)}
              </span>
              <span className="text-muted-foreground ml-1">({partner.paidCount})</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1">
            {pendingIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onBulkAction(pendingIds, "approve")}
                disabled={isMutating}
              >
                <CheckCircle className="w-3 h-3 mr-1 text-positive" />
                Approve All ({pendingIds.length})
              </Button>
            )}
            {approvedIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onBulkAction(approvedIds, "pay")}
                disabled={isMutating || !canPayApproved}
                title={payBlocker ?? undefined}
              >
                <DollarSign className="w-3 h-3 mr-1 text-info" />
                Mark All Paid ({approvedIds.length})
              </Button>
            )}
            <CopyNoteButton partner={partner} />
            {flaggedPendingIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs text-negative hover:text-negative hover:bg-negative/10"
                onClick={() => onBulkAction(flaggedPendingIds, "reject")}
                disabled={isMutating}
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Reject Flagged ({flaggedPendingIds.length})
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded: grouped by customer, then by month within customer */}
      {isExpanded &&
        groupByCustomer(partner.commissions).map((group) => (
          <Fragment key={group.customerKey}>
            {/* Customer header */}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell />
              <TableCell colSpan={7}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm text-foreground truncate">
                      {group.customerEmail || "—"}
                    </span>
                    {getCustomerStatusBadge(group.customerStatus)}
                    {group.customerRevenue > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                        <CreditCard className="w-3 h-3" />
                        {formatCurrency(group.customerRevenue)} lifetime
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {group.commissions.length} commission
                    {group.commissions.length === 1 ? "" : "s"} ·{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(group.totalAmount)}
                    </span>
                  </div>
                </div>
              </TableCell>
            </TableRow>
            {/* Per-month commission rows */}
            {group.commissions.map((commission) => {
              const ts = commissionTimestamp(commission);
              const payBlocker = getPayBlocker(
                [commission],
                partner.payoutLink,
              );
              const monthLabel = ts
                ? new Date(ts).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })
                : "—";
              const dayLabel = ts
                ? new Date(ts).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "";
              return (
                <TableRow key={commission.id} className="bg-muted/10">
                  <TableCell />
                  <TableCell className="pl-8">
                    <div className="flex flex-col gap-0.5">
                      <div className="inline-flex items-center gap-1.5 text-sm text-foreground">
                        <Calendar className="w-3 h-3 text-muted-foreground" />
                        <span className="font-medium">{monthLabel}</span>
                      </div>
                      {dayLabel && (
                        <span className="text-[11px] text-muted-foreground/70">
                          {dayLabel}
                          {!commission.eventDate && " (created)"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <MonthBadge
                      programType={commission.programType}
                      monthIndex={commission.monthIndex}
                      durationMonths={commission.durationMonths}
                      monthsRemaining={commission.monthsRemaining}
                      isFinalMonth={
                        commission.programType === "recurring" &&
                        commission.monthIndex != null &&
                        commission.durationMonths != null &&
                        commission.monthIndex === commission.durationMonths
                      }
                    />
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(commission.amount)}{" "}
                      <span className="text-muted-foreground font-normal">
                        @ {Math.round(commission.rate * 100)}%
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {getStatusBadge(commission.status)}
                      {commission.fraudFlag && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-negative/10 text-negative border border-negative/20"
                          title={commission.fraudFlag}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {commission.fraudFlag.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {commission.status === "pending" && (
                        <>
                          {!commission.fraudFlag && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-positive hover:text-positive hover:bg-positive/10"
                              onClick={() =>
                                onSingleAction(commission.id, "approved")
                              }
                              disabled={isMutating}
                              aria-label="Approve"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1 text-negative hover:text-negative hover:bg-negative/10"
                                disabled={isMutating}
                                aria-label="Reject"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  onFlagCustomer(
                                    commission.customerId,
                                    "self_referral",
                                  )
                                }
                                className="text-warning font-medium"
                              >
                                Self Referral (block future)
                              </DropdownMenuItem>
                              {[
                                { label: "Bot / Fake Traffic", flag: "bot_click" },
                                { label: "Revenue Manipulation", flag: "revenue_cap" },
                                { label: "Suspicious Activity", flag: "suspicious_activity" },
                                { label: "Policy Violation", flag: "policy_violation" },
                                { label: "No Reason", flag: undefined },
                              ].map((item) => (
                                <DropdownMenuItem
                                  key={item.label}
                                  onClick={() =>
                                    onSingleAction(
                                      commission.id,
                                      "rejected",
                                      item.flag,
                                    )
                                  }
                                >
                                  {item.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}
                      {commission.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-info hover:text-info hover:bg-info/10"
                          onClick={() => onSingleAction(commission.id, "paid")}
                          disabled={
                            isMutating ||
                            !!payBlocker ||
                            !isPayEligibleCommission(commission)
                          }
                          title={payBlocker ?? undefined}
                        >
                          Mark Paid
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </Fragment>
        ))}
    </>
  );
}

function CustomerView({
  partners,
  onBulkAction,
  onSingleAction,
  isMutating,
}: {
  partners: PartnerGroup[];
  onBulkAction: (ids: string[], action: "approve" | "pay" | "reject") => void;
  onSingleAction: (
    id: string,
    status: "approved" | "paid" | "rejected",
    fraudFlag?: string,
  ) => void;
  isMutating: boolean;
}) {
  const rows = flattenToCustomerRows(partners);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(
    null,
  );
  const selectedRow = selectedCustomerKey
    ? rows.find((r) => r.customerKey === selectedCustomerKey) ?? null
    : null;

  if (rows.length === 0) {
    return (
      <div className="bg-card border rounded-md p-6 text-center text-sm text-muted-foreground">
        No commissions match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-md p-6">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Customers ({rows.length})
      </h3>
      <Table>
        <TableHeader className="[&_tr]:border-0">
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Customer</TableHead>
            <TableHead>Partner</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const paidSlotCount = row.slots.filter((s) => s === "paid").length;

            return (
              <TableRow
                key={row.customerKey}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedCustomerKey(row.customerKey)}
              >
                  <TableCell className="w-8">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {row.customerEmail || "—"}
                      </div>
                      <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        {row.customerRevenue > 0 && (
                          <>
                            <CreditCard className="w-3 h-3" />
                            <span>
                              {formatCurrency(row.customerRevenue)} lifetime
                            </span>
                          </>
                        )}
                        {row.customerStatus && (
                          <>
                            {row.customerRevenue > 0 && <span>·</span>}
                            <span
                              className={getCustomerStatusTextClass(
                                row.customerStatus,
                              )}
                            >
                              {getCustomerStatusLabel(row.customerStatus)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <Link
                        to={`/app/customers?partner=${row.partnerId}`}
                        className="text-sm font-medium hover:underline truncate block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.partnerName}
                      </Link>
                      <div className="text-xs text-muted-foreground truncate">
                        {row.partnerEmail}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.programType === "recurring" &&
                    (row.durationMonths ?? 0) > 1 ? (
                      <div className="flex items-center gap-3">
                        <ProgressDonut slots={row.slots} />
                        <div className="flex flex-col text-xs leading-tight">
                          <span className="text-foreground">
                            <span className="font-semibold">
                              {paidSlotCount}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {row.slots.length} paid
                            </span>
                          </span>
                          <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                            {row.approvedCount > 0 && (
                              <span className="text-info">
                                {row.approvedCount} appr
                              </span>
                            )}
                            {row.pendingCount > 0 && (
                              <span className="text-warning">
                                {row.pendingCount} pend
                              </span>
                            )}
                            {row.rejectedCount > 0 && (
                              <span className="text-negative">
                                {row.rejectedCount} rej
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <StatusText
                        status={row.commissions[0]?.status ?? "pending"}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.totalAmount > 0 ? (
                      <span className="font-medium">
                        {formatCurrency(row.totalAmount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <CustomerDetailSheet
        row={selectedRow}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomerKey(null);
        }}
        onBulkAction={onBulkAction}
        onSingleAction={onSingleAction}
        isMutating={isMutating}
      />
    </div>
  );
}

function CustomerDetailSheet({
  row,
  onOpenChange,
  onBulkAction,
  onSingleAction,
  isMutating,
}: {
  row: CustomerRowData | null;
  onOpenChange: (open: boolean) => void;
  onBulkAction: (ids: string[], action: "approve" | "pay" | "reject") => void;
  onSingleAction: (
    id: string,
    status: "approved" | "paid" | "rejected",
    fraudFlag?: string,
  ) => void;
  isMutating: boolean;
}) {
  if (!row) {
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  const approvedIds = row.commissions
    .filter(isPayEligibleCommission)
    .map((c) => c.id);
  const pendingIds = row.commissions
    .filter(isApprovalEligibleCommission)
    .map((c) => c.id);
  const payBlocker = getPayBlocker(row.commissions, row.partnerPayoutLink);
  const isRecurring =
    row.programType === "recurring" && (row.durationMonths ?? 0) > 1;
  const paidSlotCount = row.slots.filter((s) => s === "paid").length;
  const futureMonths = isRecurring
    ? row.slots.length -
      row.paidCount -
      row.approvedCount -
      row.pendingCount -
      row.rejectedCount
    : 0;

  const programLabel =
    row.programType === "recurring"
      ? `Recurring · ${row.durationMonths ?? "?"} month${
          (row.durationMonths ?? 0) === 1 ? "" : "s"
        }`
      : row.programType === "lifetime"
        ? "Lifetime"
        : row.programType === "one-time"
          ? "One-time"
          : null;
  const rateLabel =
    row.commissions[0]?.rate != null
      ? `${Math.round((row.commissions[0]?.rate ?? 0) * 100)}%`
      : null;
  const programParts = [row.programName ?? "Default", programLabel, rateLabel]
    .filter((s): s is string => !!s)
    .join(" · ");

  // For non-recurring with a single commission, the per-commission card below
  // already shows status + amount + action — skip the redundant overview /
  // bulk-action block.
  const showOverview =
    isRecurring || row.commissions.length > 1;
  const showBulkActions =
    row.commissions.length > 1 &&
    (pendingIds.length > 0 || approvedIds.length > 0);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        <SheetHeader className="px-6 py-5 border-b">
          <SheetTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <span className="truncate">{row.customerEmail || "—"}</span>
          </SheetTitle>
          <SheetDescription className="text-xs flex items-center gap-1.5">
            {row.customerRevenue > 0 && (
              <>
                <CreditCard className="w-3 h-3" />
                {formatCurrency(row.customerRevenue)} lifetime
              </>
            )}
            {row.customerStatus && (
              <>
                {row.customerRevenue > 0 && <span>·</span>}
                <span
                  className={getCustomerStatusTextClass(row.customerStatus)}
                >
                  {getCustomerStatusLabel(row.customerStatus)}
                </span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="px-6 py-4 space-y-5">
          {/* Partner block */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Partner
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <Link
                  to={`/app/customers?partner=${row.partnerId}`}
                  className="text-sm font-medium hover:underline truncate block"
                >
                  {row.partnerName}
                </Link>
                <div className="text-xs text-muted-foreground truncate">
                  {row.partnerEmail}
                </div>
              </div>
              <PayoutMethodDisplay
                value={row.partnerPayoutLink}
                showMissing={false}
              />
            </div>
          </div>

          {/* Program block */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Program
            </div>
            <div className="text-sm">{programParts}</div>
          </div>

          {/* Status overview — only when it's adding info (recurring or
              multi-commission). Single non-recurring shows status on its
              card below. */}
          {showOverview && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Status
              </div>
              {isRecurring ? (
                <div className="flex items-center gap-4">
                  <ProgressDonut slots={row.slots} size={56} thickness={7} />
                  <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Paid</span>
                      <span className="font-medium text-positive">
                        {paidSlotCount} / {row.slots.length}
                      </span>
                    </div>
                    {row.approvedCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Approved</span>
                        <span className="font-medium text-info">
                          {row.approvedCount}
                        </span>
                      </div>
                    )}
                    {row.pendingCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Pending</span>
                        <span className="font-medium text-warning">
                          {row.pendingCount}
                        </span>
                      </div>
                    )}
                    {row.rejectedCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Rejected</span>
                        <span className="font-medium text-negative">
                          {row.rejectedCount}
                        </span>
                      </div>
                    )}
                    {futureMonths > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Future</span>
                        <span className="font-medium">{futureMonths}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {row.paidCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Paid</span>
                      <span className="font-medium text-positive">
                        {row.paidCount}
                      </span>
                    </div>
                  )}
                  {row.approvedCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Approved</span>
                      <span className="font-medium text-info">
                        {row.approvedCount}
                      </span>
                    </div>
                  )}
                  {row.pendingCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Pending</span>
                      <span className="font-medium text-warning">
                        {row.pendingCount}
                      </span>
                    </div>
                  )}
                  {row.rejectedCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Rejected</span>
                      <span className="font-medium text-negative">
                        {row.rejectedCount}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bulk actions — only useful with 2+ commissions */}
          {showBulkActions && (
            <div className="flex flex-wrap gap-2">
              {pendingIds.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  disabled={isMutating}
                  onClick={() => onBulkAction(pendingIds, "approve")}
                >
                  <CheckCircle className="w-3.5 h-3.5 mr-1 text-positive" />
                  Approve {pendingIds.length}
                </Button>
              )}
              {approvedIds.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  disabled={isMutating || !!payBlocker}
                  title={payBlocker ?? undefined}
                  onClick={() => onBulkAction(approvedIds, "pay")}
                >
                  <DollarSign className="w-3.5 h-3.5 mr-1 text-info" />
                  Mark {approvedIds.length} paid
                </Button>
              )}
            </div>
          )}

          {/* Per-month commissions table */}
          <CommissionsTable
            row={row}
            isRecurring={isRecurring}
            onSingleAction={onSingleAction}
            isMutating={isMutating}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CommissionsTable({
  row,
  isRecurring,
  onSingleAction,
  isMutating,
}: {
  row: CustomerRowData;
  isRecurring: boolean;
  onSingleAction: (
    id: string,
    status: "approved" | "paid" | "rejected",
    fraudFlag?: string,
  ) => void;
  isMutating: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        Commissions ({row.commissions.length})
      </div>
      <Table>
        <TableHeader className="[&_tr]:border-0">
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            {isRecurring && <TableHead>Period</TableHead>}
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.commissions.map((commission) => {
            const ts = commissionTimestamp(commission);
            const singlePayBlocker = getPayBlocker(
              [commission],
              row.partnerPayoutLink,
            );
            const dateLabel = ts
              ? new Date(ts).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—";
            return (
              <TableRow key={commission.id}>
                <TableCell>
                  <span className="font-medium text-sm">{dateLabel}</span>
                  {!commission.eventDate && (
                    <span className="text-[11px] text-muted-foreground/70 ml-1">
                      (created)
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select
                      value={commission.status}
                      onValueChange={(v) => {
                        if (
                          (v === "approved" ||
                            v === "paid" ||
                            v === "rejected") &&
                          canChooseCommissionStatus(commission, v) &&
                          (v !== "paid" || !singlePayBlocker)
                        ) {
                          onSingleAction(commission.id, v);
                        }
                      }}
                      disabled={isMutating}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <span
                          className={`capitalize font-medium ${getStatusTextClass(commission.status)}`}
                        >
                          {commission.status}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending" disabled>
                          pending
                        </SelectItem>
                        <SelectItem
                          value="approved"
                          disabled={!canChooseCommissionStatus(commission, "approved")}
                        >
                          approved
                        </SelectItem>
                        <SelectItem
                          value="paid"
                          disabled={
                            !canChooseCommissionStatus(commission, "paid") ||
                            !!singlePayBlocker
                          }
                        >
                          paid
                        </SelectItem>
                        <SelectItem
                          value="rejected"
                          disabled={!canChooseCommissionStatus(commission, "rejected")}
                        >
                          rejected
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {commission.fraudFlag && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-negative"
                        title={commission.fraudFlag}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {commission.fraudFlag.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                </TableCell>
                {isRecurring && (
                  <TableCell>
                    <MonthBadge
                      programType={commission.programType}
                      monthIndex={commission.monthIndex}
                      durationMonths={commission.durationMonths}
                      monthsRemaining={commission.monthsRemaining}
                      isFinalMonth={
                        commission.programType === "recurring" &&
                        commission.monthIndex != null &&
                        commission.durationMonths != null &&
                        commission.monthIndex === commission.durationMonths
                      }
                    />
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums text-sm font-medium">
                  {formatCurrency(commission.amount)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PayoutHistorySection({
  selectedProject,
}: {
  selectedProject: string;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<PayoutStatusFilter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["payout-records", selectedProject, statusFilter],
    queryFn: async (): Promise<PayoutRecordsResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/payouts?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch payout history");
      return response.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      payout,
      status,
    }: {
      payout: PayoutRecord;
      status: PayoutStatus;
    }) => {
      const response = await fetch(`/api/payouts/${payout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => ({ error: "Failed to update payout status" }));
        throw new Error(errorBody.error ?? "Failed to update payout status");
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["payout-records"] });
      queryClient.invalidateQueries({
        queryKey: ["partner-detail", variables.payout.partnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["partner-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["partner-payouts-full"] });
    },
  });

  const payouts = data?.payouts ?? [];
  const stats = data?.stats ?? {
    totalPayouts: 0,
    scheduledAmount: 0,
    paidAmount: 0,
    failedAmount: 0,
  };

  return (
    <div className="bg-card border rounded-md p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Payout ledger
          </h3>
          <p className="text-xs text-muted-foreground">
            Partner-visible payout records generated from paid commission batches.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-muted-foreground">
              Records{" "}
              <span className="font-medium text-foreground tabular-nums">
                {stats.totalPayouts}
              </span>
            </span>
            <span className="text-muted-foreground">
              Scheduled{" "}
              <span className="font-medium text-warning tabular-nums">
                {formatCurrency(stats.scheduledAmount)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Paid{" "}
              <span className="font-medium text-positive tabular-nums">
                {formatCurrency(stats.paidAmount)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Failed{" "}
              <span className="font-medium text-negative tabular-nums">
                {formatCurrency(stats.failedAmount)}
              </span>
            </span>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as PayoutStatusFilter)
            }
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PAYOUT_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {statusMutation.error && (
        <div className="mb-4 rounded-md border border-negative/20 bg-negative/5 p-3 text-sm text-negative">
          {statusMutation.error instanceof Error
            ? statusMutation.error.message
            : "Failed to update payout status"}
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-negative/20 bg-negative/5 p-4 text-sm text-negative">
          {(error as Error).message}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partner</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Commissions</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading payout records...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && payouts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  No payout records yet.
                </TableCell>
              </TableRow>
            )}
            {payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell>
                  <div className="font-medium text-sm">
                    {payout.partnerName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {payout.partnerEmail}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {payout.projectName}
                </TableCell>
                <TableCell>
                  <PayoutStatusMenu
                    isPending={
                      statusMutation.isPending &&
                      statusMutation.variables?.payout.id === payout.id
                    }
                    payout={payout}
                    onChange={(status) =>
                      statusMutation.mutate({ payout, status })
                    }
                  />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatPayoutPeriod(payout)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatShortDate(payout.paidAt ?? payout.createdAt)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                  {payout.commissionCount || "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium">
                  {formatCurrency(payout.amount)} {payout.currency}
                </TableCell>
                <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                  {payout.note ?? "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function PayoutStatusMenu({
  isPending,
  payout,
  onChange,
}: {
  isPending: boolean;
  payout: PayoutRecord;
  onChange: (status: PayoutStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          disabled={isPending}
        >
          {isPending && <Loader2 className="size-3 animate-spin" />}
          {getPayoutStatusBadge(payout.status)}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PAYOUT_STATUS_OPTIONS.map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === payout.status || isPending}
            onClick={() => onChange(status)}
          >
            Mark {status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Payouts() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState("all");
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "paid" | "rejected"
  >("all");
  const [fraudOnly, setFraudOnly] = useState(false);
  const [viewMode, setViewMode] = useState<
    "by-customer" | "by-partner" | "by-period"
  >("by-customer");

  useEffect(() => {
    if (viewMode === "by-period" && statusFilter === "all") {
      setStatusFilter("approved");
    }
  }, [viewMode, statusFilter]);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["commissions-by-partner", selectedProject],
    queryFn: async (): Promise<GroupedResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      const response = await fetch(`/api/commissions/by-partner?${params}`);
      if (!response.ok) throw new Error("Failed to fetch commissions");
      return response.json();
    },
  });

  const bulkActionMutation = useMutation({
    mutationFn: async ({
      ids,
      action,
    }: {
      ids: string[];
      action: "approve" | "pay" | "reject";
      fraudFlag?: string;
    }) => {
      const response = await fetch("/api/commissions/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update commissions",
        );
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
      queryClient.invalidateQueries({ queryKey: ["payout-records"] });
    },
  });

  const singleActionMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      fraudFlag,
    }: {
      id: string;
      status: "approved" | "paid" | "rejected";
      fraudFlag?: string;
    }) => {
      const body: { status: string; fraudFlag?: string } = { status };
      if (fraudFlag) body.fraudFlag = fraudFlag;
      const response = await fetch(`/api/commissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to update commission",
        );
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
      queryClient.invalidateQueries({ queryKey: ["payout-records"] });
    },
  });

  const flagCustomerMutation = useMutation({
    mutationFn: async ({ customerId, reason }: { customerId: string; reason: string }) => {
      const response = await fetch(`/api/customers/${customerId}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("Failed to flag customer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const projects = projectsData?.projects ?? [];
  const isMutating = bulkActionMutation.isPending || singleActionMutation.isPending || flagCustomerMutation.isPending;
  const mutationError =
    bulkActionMutation.error ??
    singleActionMutation.error ??
    flagCustomerMutation.error;

  function togglePartner(partnerId: string) {
    setExpandedPartners((prev) => {
      const next = new Set(prev);
      if (next.has(partnerId)) {
        next.delete(partnerId);
      } else {
        next.add(partnerId);
      }
      return next;
    });
  }

  function handleBulkAction(ids: string[], action: "approve" | "pay" | "reject") {
    bulkActionMutation.mutate({ ids, action });
  }

  function handleSingleAction(id: string, status: "approved" | "paid" | "rejected", fraudFlag?: string) {
    singleActionMutation.mutate({ id, status, fraudFlag });
  }

  function handleFlagCustomer(customerId: string, reason: string) {
    flagCustomerMutation.mutate({ customerId, reason });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading payouts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading payouts: {error.message}
        </div>
      </div>
    );
  }

  const totals = data?.totals ?? { pendingAmount: 0, approvedAmount: 0, paidAmount: 0 };
  const partnerGroups = data?.partners ?? [];
  const payoutReadiness = partnerGroups.reduce(
    (acc, partner) => {
      const policy = getPartnerPayoutPolicy(partner);
      acc.scheduledLater += policy.futureAmount;
      if (policy.eligibleCount === 0) return acc;
      if (policy.belowMinimum) {
        acc.belowMinimum += policy.eligibleAmount;
      } else if (!partner.payoutLink?.trim()) {
        acc.needsMethod += policy.eligibleAmount;
      } else {
        acc.ready += policy.eligibleAmount;
      }
      return acc;
    },
    { ready: 0, belowMinimum: 0, needsMethod: 0, scheduledLater: 0 },
  );

  const filteredPartnerGroups: PartnerGroup[] = partnerGroups
    .map((partner) => {
      const filteredCommissions = partner.commissions.filter((c) => {
        if (fraudOnly && !c.fraudFlag) return false;
        if (statusFilter !== "all" && c.status !== statusFilter) return false;
        return true;
      });

      const pending = filteredCommissions.filter((c) => c.status === "pending");
      const approved = filteredCommissions.filter((c) => c.status === "approved");
      const paid = filteredCommissions.filter((c) => c.status === "paid");
      const rejected = filteredCommissions.filter((c) => c.status === "rejected");

      const sum = (items: CommissionDetail[]) =>
        items.reduce((total, c) => total + c.amount, 0);

      return {
        ...partner,
        pendingCount: pending.length,
        pendingAmount: sum(pending),
        approvedCount: approved.length,
        approvedAmount: sum(approved),
        paidCount: paid.length,
        paidAmount: sum(paid),
        rejectedCount: rejected.length,
        rejectedAmount: sum(rejected),
        commissions: filteredCommissions,
      };
    })
    .filter((partner) => partner.commissions.length > 0);

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Payouts</h1>
          <p className="text-muted-foreground">
            Review commissions, pay partners, and keep payout records aligned
          </p>
        </div>
      </div>

      {mutationError && (
        <div className="rounded-md border border-negative/20 bg-negative/5 p-3 text-sm text-negative">
          {(mutationError as Error).message}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="w-40">
          <Select
            value={viewMode}
            onValueChange={(value) =>
              setViewMode(value as typeof viewMode)
            }
          >
            <SelectTrigger className="bg-card">
              <span>
                {viewMode === "by-customer"
                  ? "By Customer"
                  : viewMode === "by-partner"
                    ? "By Partner"
                    : "By Period"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="by-customer">By Customer</SelectItem>
              <SelectItem value="by-partner">By Partner</SelectItem>
              <SelectItem value="by-period">By Period</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="bg-card">
              <span>
                {selectedProject === "all"
                  ? "All Projects"
                  : projects.find((p) => p.id === selectedProject)?.name ??
                    "Select"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as typeof statusFilter)
            }
          >
            <SelectTrigger className="bg-card">
              <span className="capitalize">
                {statusFilter === "all" ? "All Statuses" : statusFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select
            value={fraudOnly ? "flagged" : "all"}
            onValueChange={(v) => setFraudOnly(v === "flagged")}
          >
            <SelectTrigger className="bg-card">
              <span>{fraudOnly ? "Fraud-flagged Only" : "All Commissions"}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Commissions</SelectItem>
              <SelectItem value="flagged">Fraud-flagged Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Pending Review — derived live from Stripe; nothing persisted until
          the user approves or denies. Shown only when a single project is
          selected (the endpoint is project-scoped). */}
      {selectedProject !== "all" && (
        <PendingReviewSection projectId={selectedProject} />
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-6">
        <StatCard
          title="Pending Approval"
          value={formatCurrency(totals.pendingAmount)}
          Icon={Clock}
        />
        <StatCard
          title="Ready to Pay"
          value={formatCurrency(payoutReadiness.ready)}
          Icon={DollarSign}
        />
        <StatCard
          title="Below Minimum"
          value={formatCurrency(payoutReadiness.belowMinimum)}
          Icon={AlertTriangle}
        />
        <StatCard
          title="Needs Method"
          value={formatCurrency(payoutReadiness.needsMethod)}
          Icon={CreditCard}
        />
        <StatCard
          title="Scheduled Later"
          value={formatCurrency(payoutReadiness.scheduledLater)}
          Icon={Calendar}
        />
        <StatCard
          title="Paid"
          value={formatCurrency(totals.paidAmount)}
          Icon={CheckCircle}
        />
      </div>

      <PayoutHistorySection selectedProject={selectedProject} />

      {viewMode === "by-customer" ? (
        <CustomerView
          partners={filteredPartnerGroups}
          onBulkAction={handleBulkAction}
          onSingleAction={handleSingleAction}
          isMutating={isMutating}
        />
      ) : viewMode === "by-period" ? (
        <PeriodView
          partners={filteredPartnerGroups}
          onBulkAction={handleBulkAction}
          onSingleAction={handleSingleAction}
          isMutating={isMutating}
        />
      ) : (
        <div className="bg-card border rounded-md p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Partner payouts ledger
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Partner</TableHead>
                <TableHead>Payout method</TableHead>
                <TableHead>Payout Policy</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Approved (Owed)</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPartnerGroups.map((partner) => (
                <PartnerRow
                  key={partner.partnerId}
                  partner={partner}
                  isExpanded={expandedPartners.has(partner.partnerId)}
                  onToggle={() => togglePartner(partner.partnerId)}
                  onBulkAction={handleBulkAction}
                  onSingleAction={handleSingleAction}
                  onFlagCustomer={handleFlagCustomer}
                  isMutating={isMutating}
                />
              ))}
              {filteredPartnerGroups.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground py-8"
                  >
                    No commissions yet. Commissions are created automatically when
                    conversions are tracked.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function PendingReviewSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["payouts-pending", projectId],
    queryFn: async (): Promise<{ data: PendingPayoutRow[] }> => {
      const r = await fetch(`/api/projects/${projectId}/payouts/pending`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to load pending payouts",
        );
      }
      return r.json();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (input: {
      action: "approve" | "deny";
      row: PendingPayoutRow;
    }) => {
      const r = await fetch(
        `/api/projects/${projectId}/payouts/${input.action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: input.row.paymentId,
            eventId: input.row.eventId,
            monthIndex: input.row.monthIndex,
            revenue: input.row.revenue,
            commissionAmount: input.row.commissionAmount,
            mrr: input.row.mrr,
            eventDate: input.row.eventDate,
          }),
        },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `${input.action} failed`,
        );
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payouts-pending", projectId] });
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });

  if (error) {
    // Stripe-not-connected returns 412; render a friendly inline note.
    return (
      <div className="bg-card border rounded-md p-4 text-sm text-muted-foreground">
        {(error as Error).message}
      </div>
    );
  }

  const rows = data?.data ?? [];

  return (
    <div className="bg-card border rounded-md p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Pending review
          </h3>
          <p className="text-xs text-muted-foreground">
            Live from Stripe. Each row is one paid invoice or charge — approve
            or deny to record the commission.
          </p>
        </div>
        {isLoading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground py-8"
              >
                Nothing pending. Assign Stripe payments to partners on the
                Payments page to see them here.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={`${r.paymentId}-${r.eventId}`}>
              <TableCell>
                <div className="font-medium text-sm">{r.partnerName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.partnerEmail}
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  {r.customerName || r.customerEmail || "—"}
                </div>
                {r.customerName && r.customerEmail && (
                  <div className="text-xs text-muted-foreground">
                    {r.customerEmail}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {r.programName}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(r.eventDate * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <MonthBadge
                    programType={r.programType}
                    monthIndex={r.monthIndex}
                    durationMonths={r.durationMonths}
                    monthsRemaining={r.monthsRemaining}
                    isFinalMonth={r.isFinalMonth}
                  />
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm">
                {formatCurrency(r.revenue)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm font-medium">
                {formatCurrency(r.commissionAmount)}
                <div className="text-[10px] text-muted-foreground font-normal">
                  {r.programType === "one-time" && r.flatAmount != null
                    ? `Flat ${formatCurrency(r.flatAmount)}`
                    : `@ ${Math.round(r.rate * 100)}%`}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-positive hover:text-positive hover:bg-positive/10"
                    disabled={actionMutation.isPending}
                    onClick={() =>
                      actionMutation.mutate({ action: "approve", row: r })
                    }
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-negative hover:text-negative hover:bg-negative/10"
                    disabled={actionMutation.isPending}
                    onClick={() =>
                      actionMutation.mutate({ action: "deny", row: r })
                    }
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    Deny
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default Payouts;
