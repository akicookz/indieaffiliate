import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  MoreHorizontal,
  Loader2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmProvider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  describeSchedule,
  nextPayoutDate,
  formatScheduleDate,
  type PayoutCadence,
} from "@/lib/payout-schedule";
import { parsePayoutMethod } from "@/lib/payout-method";

const CHANNEL_META: Record<string, { label: string; color: string }> = {
  newsletter: { label: "Newsletter", color: "#2563eb" },
  youtube: { label: "Youtube", color: "#dc2626" },
  paid: { label: "Paid", color: "#7c3aed" },
  podcast: { label: "Podcast", color: "#d97706" },
  twitter: { label: "Twitter", color: "#0ea5e9" },
  agency: { label: "Agency", color: "#15803d" },
  blog: { label: "Blog", color: "#78716c" },
  community: { label: "Community", color: "#db2777" },
};

const AVATAR_PALETTE = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#db2777",
  "#15803d",
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtMoney(n: number, opts?: { compact?: boolean }): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts?.compact && n >= 1000 ? "compact" : "standard",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function formatShortDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "-";
  if (!start) return `through ${formatShortDate(end)}`;
  if (!end) return `from ${formatShortDate(start)}`;
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function formatRate(rate: number): string {
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function formatPayoutMethodDetail(value: string | null): string {
  const method = parsePayoutMethod(value);
  if (!method) return "Missing payout method";
  return `${method.label}: ${method.displayValue}`;
}

function payoutStatusTone(status: "scheduled" | "paid" | "failed"): string {
  switch (status) {
    case "scheduled":
      return "bg-warning/10 text-warning";
    case "paid":
      return "bg-positive/10 text-positive";
    case "failed":
      return "bg-negative/10 text-negative";
  }
}

function commissionStatusTone(
  status: "pending" | "approved" | "paid" | "rejected",
): string {
  switch (status) {
    case "pending":
      return "bg-muted text-muted-foreground";
    case "approved":
      return "bg-warning/10 text-warning";
    case "paid":
      return "bg-positive/10 text-positive";
    case "rejected":
      return "bg-negative/10 text-negative";
  }
}

interface DetailResponse {
  partner: {
    id: string;
    name: string;
    email: string;
    status: "active" | "pending" | "inactive";
    commissionRate: number;
    commissionProgramId: string | null;
    referralCode: string;
    payoutLink: string | null;
    channel: string | null;
    createdAt: string;
    projectId: string;
    usesDefaultCommissionProgram: boolean;
    defaultCommissionProgramId: string | null;
    commissionProgram: {
      id: string;
      name: string;
      rate: number;
      type: string;
      durationMonths: number | null;
      flatAmount: number | null;
      payoutCadence: PayoutCadence | null;
      payoutDayOfMonth: number | null;
      payoutDayOfWeek: number | null;
      payoutOrdinal: number | null;
    } | null;
  };
  stats: {
    lifetimeEarned: number;
    customerCount: number;
    pendingPayout: number;
    conversionRate: number;
    clicks: number;
    refs: number;
    epc: number;
    cancelRate: number;
    churnedCustomers: number;
    ltvRevenue: number;
    ltvMonths: number;
  };
  monthlyMrr: { month: string; mrr: number; pending: number }[];
  subscriptions: {
    customerId: string;
    customerName: string;
    startedAt: string | null;
    mrr: number | null;
    perMoEarn: number | null;
    monthIndex: number;
    durationMonths: number | null;
    earned: number;
    total: number | null;
    programType: string | null;
  }[];
  payouts: {
    id: string;
    amount: number;
    currency: string;
    status: "scheduled" | "paid" | "failed";
    note: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    paidAt: string | null;
    createdAt: string;
  }[];
  commissions: {
    id: string;
    customerName: string;
    customerEmail: string;
    amount: number;
    rate: number;
    status: "pending" | "approved" | "paid" | "rejected";
    eventDate: string | null;
    fraudFlag: string | null;
    monthIndex: number | null;
    programName: string | null;
    programType: string | null;
  }[];
  payoutCount: number;
  commissionCount: number;
}

interface CommissionProgram {
  id: string;
  name: string;
  type: string;
  rate: number;
  flatAmount: number | null;
}

type RangeKey = "3M" | "6M" | "12M" | "All";

function PartnerDetailDrawer({
  partnerId,
  open,
  onOpenChange,
}: {
  partnerId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [tab, setTab] = useState<"subs" | "payouts" | "commission" | "activity">(
    "subs",
  );
  const [range, setRange] = useState<RangeKey>("6M");
  const [editing, setEditing] = useState(false);

  // Reset transient state when drawer changes target
  useEffect(() => {
    setTab("subs");
    setRange("6M");
    setEditing(false);
  }, [partnerId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-detail", partnerId],
    queryFn: async (): Promise<DetailResponse> => {
      const r = await fetch(`/api/partners/${partnerId}/detail`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!partnerId && open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:!w-[50vw] sm:!max-w-[50vw] overflow-y-auto p-0 gap-0"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error || !data ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
            <p className="text-sm text-destructive">
              Couldn't load this partner.
            </p>
            <p className="text-xs text-muted-foreground">
              Check your connection and try reopening.
            </p>
          </div>
        ) : editing ? (
          <EditView
            detail={data}
            onClose={() => setEditing(false)}
          />
        ) : (
          <DetailView
            data={data}
            tab={tab}
            setTab={setTab}
            range={range}
            setRange={setRange}
            onEdit={() => setEditing(true)}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailView({
  data,
  tab,
  setTab,
  range,
  setRange,
  onEdit,
  onClose,
}: {
  data: DetailResponse;
  tab: "subs" | "payouts" | "commission" | "activity";
  setTab: (t: "subs" | "payouts" | "commission" | "activity") => void;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { confirm } = useConfirm();
  const p = data.partner;
  const ch = p.channel ? CHANNEL_META[p.channel] : null;
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: async (status: "active" | "inactive") => {
      const r = await fetch(`/api/partners/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed to update status");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-detail", p.id] });
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/partners/${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete partner");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      onClose();
    },
  });

  async function handleDelete() {
    if (
      await confirm({
        title: `Delete ${p.name || p.email}?`,
        description:
          "This removes the partner and their attribution. This cannot be undone.",
        confirmText: "Delete partner",
        destructive: true,
      })
    ) {
      deleteMutation.mutate();
    }
  }

  const subsThisMonth = useMemo(() => data.subscriptions.length, [data]);
  const nextPayout = useMemo(() => {
    const program = p.commissionProgram;
    if (!program) return null;
    return nextPayoutDate({
      cadence: program.payoutCadence,
      dayOfMonth: program.payoutDayOfMonth,
      dayOfWeek: program.payoutDayOfWeek,
      ordinal: program.payoutOrdinal,
    });
  }, [p.commissionProgram]);

  const filteredMrr = useMemo(() => {
    const monthsBack =
      range === "3M" ? 3 : range === "6M" ? 6 : range === "12M" ? 12 : 9999;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    const cutoffKey = cutoff.toISOString().slice(0, 7);
    return data.monthlyMrr.filter((d) => d.month >= cutoffKey);
  }, [data.monthlyMrr, range]);

  const currentMonth = filteredMrr[filteredMrr.length - 1]?.mrr ?? 0;

  return (
    <>
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="size-12 rounded-full flex items-center justify-center text-base font-semibold text-white shrink-0"
            style={{ backgroundColor: avatarColor(p.id) }}
          >
            {initials(p.name || p.email)}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <SheetTitle
                className="text-2xl tracking-tight truncate"
                style={{
                  fontFamily: `"Source Serif 4", Georgia, serif`,
                  fontWeight: 500,
                }}
              >
                {p.name || p.email}
              </SheetTitle>
              <StatusPill status={p.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {p.email} · joined{" "}
              {new Date(p.createdAt).toISOString().slice(0, 10)}
            </p>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {ch && (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: ch.color }}
                  />
                  {ch.label}
                </span>
              )}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {p.referralCode}
              </code>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="secondary" size="sm" asChild>
            <a href={`mailto:${p.email}`}>
              <Send className="size-3.5" />
              Message
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              {p.status !== "active" && (
                <DropdownMenuItem
                  onSelect={() => statusMutation.mutate("active")}
                  disabled={statusMutation.isPending}
                >
                  Approve
                </DropdownMenuItem>
              )}
              {p.status === "active" && (
                <DropdownMenuItem
                  onSelect={() => statusMutation.mutate("inactive")}
                  disabled={statusMutation.isPending}
                >
                  Pause
                </DropdownMenuItem>
              )}
              {p.status === "inactive" && (
                <DropdownMenuItem
                  onSelect={() => statusMutation.mutate("active")}
                  disabled={statusMutation.isPending}
                >
                  Resume
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDelete}
                disabled={deleteMutation.isPending}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border">
        <DrawerStat
          label="Lifetime earned"
          value={fmtMoney(data.stats.lifetimeEarned, { compact: true })}
          subtitle={`from ${data.stats.customerCount} customers`}
        />
        <DrawerStat
          label="Pending payout"
          value={fmtMoney(data.stats.pendingPayout, { compact: true })}
          subtitle={
            nextPayout
              ? `next ${formatScheduleDate(nextPayout)}`
              : "awaiting next cycle"
          }
        />
        <DrawerStat
          label="Customer LTV"
          value={fmtMoney(data.stats.ltvRevenue, { compact: true })}
          subtitle={`${data.stats.ltvMonths.toFixed(1)} mo avg retained`}
        />
        <DrawerStat
          label="Cancel rate"
          value={`${data.stats.cancelRate.toFixed(0)}%`}
          subtitle={`${data.stats.churnedCustomers} of ${data.stats.refs} churned`}
        />
        <DrawerStat
          label="Conversion rate"
          value={`${data.stats.conversionRate.toFixed(1)}%`}
          subtitle={`${data.stats.clicks.toLocaleString()} clicks → ${data.stats.refs.toLocaleString()} subs`}
        />
        <DrawerStat
          label="EPC"
          value={fmtMoney(data.stats.epc)}
          subtitle="earnings per click"
        />
      </div>

      {/* MRR chart */}
      <div className="p-6 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-eyebrow">Monthly attributed MRR</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="text-3xl tracking-tight"
                style={{
                  fontFamily: `"Source Serif 4", Georgia, serif`,
                  fontWeight: 500,
                }}
              >
                {fmtMoney(currentMonth)}
              </span>
              <span className="text-xs text-muted-foreground">this month</span>
            </div>
          </div>
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {(["3M", "6M", "12M", "All"] as const).map((r) => {
              const active = range === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "px-2 h-6 text-xs font-medium rounded transition-colors",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
        <div className="h-44 -mx-2">
          {filteredMrr.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No commission events recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredMrr} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c2410c" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#c2410c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => fmtMoney(Number(v), { compact: true })}
                />
                <Tooltip
                  formatter={(value: number) => fmtMoney(value)}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid #e7e5e4",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="mrr"
                  stroke="#c2410c"
                  strokeWidth={2}
                  fill="url(#mrrFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-6 -mb-px">
          {[
            {
              key: "subs",
              label: `Attributed subscriptions · ${subsThisMonth}`,
            },
            { key: "payouts", label: `Payouts · ${data.payoutCount}` },
            { key: "commission", label: "Commission" },
            { key: "activity", label: "Activity" },
          ].map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() =>
                  setTab(
                    t.key as "subs" | "payouts" | "commission" | "activity",
                  )
                }
                className={cn(
                  "py-3 text-sm font-medium border-b-2 transition-colors",
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {tab === "subs" && (
        <SubscriptionsTab subscriptions={data.subscriptions} />
      )}
      {tab === "payouts" && <PayoutsTab payouts={data.payouts} />}
      {tab === "commission" && (
        <CommissionTab
          commissions={data.commissions}
          partner={p}
          pendingPayout={data.stats.pendingPayout}
        />
      )}
      {tab === "activity" && (
        <ActivityTab
          commissions={data.commissions}
          payouts={data.payouts}
        />
      )}
    </>
  );
}

function StatusPill({ status }: { status: "active" | "pending" | "inactive" }) {
  const map = {
    active: { color: "var(--positive)", bg: "bg-positive/10 text-positive", label: "Active" },
    pending: { color: "var(--warning)", bg: "bg-warning/10 text-warning", label: "Review" },
    inactive: {
      color: "var(--muted-foreground)",
      bg: "bg-muted text-muted-foreground",
      label: "Paused",
    },
  } as const;
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
        m.bg,
      )}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: m.color }} />
      {m.label}
    </span>
  );
}

function DrawerStat({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="bg-card p-5">
      <p className="text-eyebrow">{label}</p>
      <p
        className="text-3xl mt-1 tracking-tight"
        style={{
          fontFamily: `"Source Serif 4", Georgia, serif`,
          fontWeight: 500,
        }}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function SubscriptionsTab({
  subscriptions,
}: {
  subscriptions: DetailResponse["subscriptions"];
}) {
  if (subscriptions.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No attributed subscriptions yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-eyebrow-muted">
            <th className="text-left font-medium px-6 py-3">Customer</th>
            <th className="text-right font-medium px-3 py-3">MRR</th>
            <th className="text-right font-medium px-3 py-3">Per-mo earn</th>
            <th className="text-left font-medium px-3 py-3">Lifecycle</th>
            <th className="text-right font-medium px-6 py-3">Earned / Total</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((s) => (
            <tr key={s.customerId} className="border-t border-border">
              <td className="px-6 py-3">
                <div className="font-medium">{s.customerName}</div>
                {s.startedAt && (
                  <div className="text-xs text-muted-foreground">
                    started {s.startedAt}
                  </div>
                )}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {s.mrr != null ? fmtMoney(s.mrr) : "—"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {s.perMoEarn != null ? fmtMoney(s.perMoEarn) : "—"}
              </td>
              <td className="px-3 py-3">
                <LifecycleBar
                  monthIndex={s.monthIndex}
                  total={s.durationMonths}
                />
              </td>
              <td className="px-6 py-3 text-right tabular-nums">
                <span className="font-medium">{fmtMoney(s.earned)}</span>
                <span className="text-muted-foreground">
                  {" / "}
                  {s.total != null ? fmtMoney(s.total) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-6 py-4 flex items-center gap-4 text-xs text-muted-foreground border-t border-border">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ backgroundColor: "#15803d" }} />
          Paid
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ backgroundColor: "#c2410c" }} />
          Pending next cycle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-dashed border-muted-foreground" />
          Future month
        </span>
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        className,
      )}
    >
      {label}
    </span>
  );
}

function PayoutsTab({ payouts }: { payouts: DetailResponse["payouts"] }) {
  if (payouts.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No payout records yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-eyebrow-muted">
            <th className="text-left font-medium px-6 py-3">Amount</th>
            <th className="text-left font-medium px-3 py-3">Status</th>
            <th className="text-left font-medium px-3 py-3">Period</th>
            <th className="text-left font-medium px-3 py-3">Date</th>
            <th className="text-left font-medium px-6 py-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((payout) => (
            <tr key={payout.id} className="border-t border-border">
              <td className="px-6 py-3 tabular-nums font-medium">
                {fmtMoney(payout.amount)} {payout.currency}
              </td>
              <td className="px-3 py-3">
                <StatusBadge
                  label={payout.status}
                  className={payoutStatusTone(payout.status)}
                />
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {formatPeriod(payout.periodStart, payout.periodEnd)}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {formatShortDate(payout.paidAt ?? payout.createdAt)}
              </td>
              <td className="px-6 py-3 max-w-[240px] truncate text-muted-foreground">
                {payout.note ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommissionTab({
  commissions,
  partner,
  pendingPayout,
}: {
  commissions: DetailResponse["commissions"];
  partner: DetailResponse["partner"];
  pendingPayout: number;
}) {
  const program = partner.commissionProgram;
  const nextPayout = program
    ? nextPayoutDate({
        cadence: program.payoutCadence,
        dayOfMonth: program.payoutDayOfMonth,
        dayOfWeek: program.payoutDayOfWeek,
        ordinal: program.payoutOrdinal,
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border-y border-border">
        <PolicyTile
          label="Program"
          value={program?.name ?? "No program assigned"}
          detail={
            program
              ? `${partner.usesDefaultCommissionProgram ? "Project default · " : ""}${
                  program.type === "one-time" && program.flatAmount != null
                    ? `${fmtMoney(program.flatAmount)} flat · one-time`
                    : `${formatRate(program.rate)} · ${program.type}`
                }`
              : `${formatRate(partner.commissionRate)} fallback rate`
          }
        />
        <PolicyTile
          label="Payout cycle"
          value={
            program
              ? describeSchedule({
                  cadence: program.payoutCadence,
                  dayOfMonth: program.payoutDayOfMonth,
                  dayOfWeek: program.payoutDayOfWeek,
                  ordinal: program.payoutOrdinal,
                })
              : "No schedule set"
          }
          detail={nextPayout ? `Next ${formatScheduleDate(nextPayout)}` : "No next date"}
        />
        <PolicyTile
          label="Ready balance"
          value={fmtMoney(pendingPayout)}
          detail={formatPayoutMethodDetail(partner.payoutLink)}
        />
      </div>

      <RecentCommissionsTable commissions={commissions} />
    </div>
  );
}

function PolicyTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-card p-5 min-w-0">
      <p className="text-eyebrow-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground truncate">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground truncate">{detail}</p>
    </div>
  );
}

function RecentCommissionsTable({
  commissions,
}: {
  commissions: DetailResponse["commissions"];
}) {
  if (commissions.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No commission records yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-eyebrow-muted">
            <th className="text-left font-medium px-6 py-3">Customer</th>
            <th className="text-left font-medium px-3 py-3">Program</th>
            <th className="text-left font-medium px-3 py-3">Status</th>
            <th className="text-right font-medium px-3 py-3">Rate</th>
            <th className="text-right font-medium px-6 py-3">Amount</th>
          </tr>
        </thead>
        <tbody>
          {commissions.map((commission) => (
            <tr key={commission.id} className="border-t border-border">
              <td className="px-6 py-3">
                <div className="font-medium">{commission.customerName}</div>
                <div className="text-xs text-muted-foreground">
                  {formatShortDate(commission.eventDate)}
                  {commission.monthIndex ? ` · month ${commission.monthIndex}` : ""}
                  {commission.fraudFlag ? ` · ${commission.fraudFlag}` : ""}
                </div>
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                <div>{commission.programName ?? "Default"}</div>
                <div className="text-xs capitalize">
                  {commission.programType ?? "legacy"}
                </div>
              </td>
              <td className="px-3 py-3">
                <StatusBadge
                  label={commission.status}
                  className={commissionStatusTone(commission.status)}
                />
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatRate(commission.rate)}
              </td>
              <td className="px-6 py-3 text-right tabular-nums font-medium">
                {fmtMoney(commission.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({
  commissions,
  payouts,
}: {
  commissions: DetailResponse["commissions"];
  payouts: DetailResponse["payouts"];
}) {
  const events = [
    ...commissions.map((commission) => ({
      id: `commission-${commission.id}`,
      date: commission.eventDate,
      title: `${commission.status} commission`,
      detail: `${commission.customerName} · ${fmtMoney(commission.amount)}`,
      tone: commissionStatusTone(commission.status),
    })),
    ...payouts.map((payout) => ({
      id: `payout-${payout.id}`,
      date: payout.paidAt ?? payout.createdAt,
      title: `${payout.status} payout`,
      detail: `${fmtMoney(payout.amount)} ${payout.currency}`,
      tone: payoutStatusTone(payout.status),
    })),
  ]
    .sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 20);

  if (events.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No partner activity yet.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="space-y-3">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
          >
            <span className={cn("mt-1 size-2 rounded-full", event.tone)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium capitalize text-foreground">
                  {event.title}
                </p>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatShortDate(event.date)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {event.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LifecycleBar({
  monthIndex,
  total,
}: {
  monthIndex: number;
  total: number | null;
}) {
  // For "lifetime" / "one-time" or unknown duration, show a single solid + count
  if (!total || total <= 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-sm" style={{ backgroundColor: "#15803d" }} />
        <span className="text-xs text-muted-foreground">{monthIndex} mo</span>
      </div>
    );
  }
  const filled = Math.min(monthIndex - 1, total);
  const current = monthIndex <= total ? 1 : 0;
  const future = Math.max(total - filled - current, 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: filled }).map((_, i) => (
          <span
            key={`f${i}`}
            className="h-2.5 w-3 rounded-sm"
            style={{ backgroundColor: "#15803d" }}
          />
        ))}
        {Array.from({ length: current }).map((_, i) => (
          <span
            key={`c${i}`}
            className="h-2.5 w-3 rounded-sm"
            style={{ backgroundColor: "#c2410c" }}
          />
        ))}
        {Array.from({ length: future }).map((_, i) => (
          <span
            key={`u${i}`}
            className="h-2.5 w-3 rounded-sm border border-dashed border-muted-foreground/40"
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {Math.min(monthIndex, total)}/{total}
      </span>
    </div>
  );
}

function EditView({
  detail,
  onClose,
}: {
  detail: DetailResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const p = detail.partner;
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email);
  const [status, setStatus] = useState<"active" | "pending" | "inactive">(p.status);
  const [channel, setChannel] = useState<string | "__none__">(p.channel ?? "__none__");
  const [programId, setProgramId] = useState<string | "__none__">(
    p.commissionProgramId ?? "__none__",
  );
  const [payoutLink, setPayoutLink] = useState(p.payoutLink ?? "");
  const [referralCode, setReferralCode] = useState(p.referralCode);

  const { data: programsData } = useQuery({
    queryKey: ["commission-programs", p.projectId],
    queryFn: async (): Promise<{ programs: CommissionProgram[] }> => {
      const r = await fetch(
        `/api/projects/${p.projectId}/commission-programs`,
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!p.projectId,
  });
  const programs = programsData?.programs ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/partners/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          status,
          channel: channel === "__none__" ? null : channel,
          commissionProgramId: programId === "__none__" ? null : programId,
          payoutLink: payoutLink.trim() || null,
          referralCode,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Save failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-detail", p.id] });
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      onClose();
    },
  });

  return (
    <>
      <div className="flex items-center justify-between p-6 border-b border-border">
        <SheetTitle
          className="text-2xl tracking-tight"
          style={{
            fontFamily: `"Source Serif 4", Georgia, serif`,
            fontWeight: 500,
          }}
        >
          Edit partner
        </SheetTitle>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cancel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="p-6 space-y-5 max-w-xl">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Review</SelectItem>
              <SelectItem value="inactive">Paused</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Channel">
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {Object.entries(CHANNEL_META).map(([k, m]) => (
                <SelectItem key={k} value={k}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Commission program"
          hint="Setting a program also updates the partner's commission rate."
        >
          {programs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No programs in this project yet.
            </div>
          ) : (
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {p.defaultCommissionProgramId
                    ? "Project default"
                    : "Fallback rate"}
                </SelectItem>
                {programs.map((pr) => (
                  <SelectItem key={pr.id} value={pr.id} textValue={pr.name}>
                    <span className="flex flex-col leading-tight">
                      <span>{pr.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {pr.type === "one-time" &&
                        pr.flatAmount != null &&
                        pr.flatAmount > 0
                          ? `${fmtMoney(pr.flatAmount)} flat · one-time`
                          : `${pr.rate}% · ${pr.type}`}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Payout method">
          <Input
            value={payoutLink}
            onChange={(e) => setPayoutLink(e.target.value)}
            placeholder="paypal.me/name, partner@example.com, or @handle"
          />
        </Field>
        <Field label="Referral code">
          <Input
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
          />
        </Field>

        {saveMutation.isError && (
          <p className="text-sm text-destructive">
            {(saveMutation.error as Error).message}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-eyebrow-muted">{label}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default PartnerDetailDrawer;
