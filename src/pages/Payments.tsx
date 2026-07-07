import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Search,
  Upload,
  RefreshCw,
  Loader2,
  UserPlus,
  UserMinus,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import CsvImportPanel from "@/components/CsvImportPanel";
import { cn } from "@/lib/utils";

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface PartnerLite {
  id: string;
  name: string;
  email: string;
  referralCode: string;
}

type Kind = "subscription" | "one_time";
type AssignedFilter = "unassigned" | "assigned" | "all";

interface AssignmentSnapshot {
  paymentId: string;
  partnerId: string;
  commissionProgramId: string | null;
  programType: "recurring" | "lifetime" | "one-time" | null;
  durationMonths: number | null;
  rate: number | null;
  flatAmount: number | null;
  flagReason: string | null;
}

interface LivePaymentRow {
  source: "stripe";
  externalPaymentId: string;
  kind: Kind;
  customer: { stripeCustomerId: string | null; email: string | null; name: string | null };
  metadata: Record<string, string>;
  status?: string;
  billingCycleAnchor?: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  startedAt?: number;
  plan?: {
    name: string | null;
    unitAmount: number | null;
    interval: string | null;
    intervalCount: number | null;
  };
  amount?: number;
  created?: number;
  description?: string | null;
  assignment: AssignmentSnapshot | null;
}

interface ListResponse {
  data: LivePaymentRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const n = cents / 100;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function fmtMoneyDollars(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  });
}

function formatAssignmentPlan(
  assignment: AssignmentSnapshot | null,
): string | null {
  if (!assignment?.programType) return null;
  if (assignment.programType === "one-time" && assignment.flatAmount != null) {
    return `flat ${fmtMoneyDollars(assignment.flatAmount)}`;
  }
  const rate =
    assignment.rate != null ? `${(assignment.rate * 100).toFixed(0)}%` : null;
  if (
    assignment.programType === "recurring" &&
    assignment.durationMonths != null
  ) {
    return `${assignment.durationMonths}mo${rate ? ` · ${rate}` : ""}`;
  }
  return rate;
}

function stripeDeepLink(p: LivePaymentRow): string {
  if (p.kind === "subscription") {
    return `https://dashboard.stripe.com/subscriptions/${p.externalPaymentId}`;
  }
  return `https://dashboard.stripe.com/payments/${p.externalPaymentId}`;
}

function fmtDate(unixSec: number | undefined | null): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function assignedFilterLabel(filter: AssignedFilter): string {
  switch (filter) {
    case "unassigned":
      return "Unassigned";
    case "assigned":
      return "Assigned";
    case "all":
      return "All";
  }
}

function paymentEmptyLabel(filter: AssignedFilter, kind: Kind): string {
  const kindLabel = kind === "subscription" ? "subscriptions" : "one-time charges";
  if (filter === "all") return `No ${kindLabel} found.`;
  return `No ${filter} ${kindLabel} found.`;
}

function Payments() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState<Kind>("subscription");
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>("unassigned");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "succeeded" | "failed" | "refunded"
  >("all");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  // Cursor stack lets us go back: pop the previous cursor on Prev.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const currentCursor = cursorStack[cursorStack.length - 1];

  // Debounce search input → committed `search` (which is in the queryKey).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setCursorStack([]);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const projects = projectsData?.projects ?? [];
  const fallbackProject = projects[0]?.id;
  const projectId = searchParams.get("project") ?? fallbackProject;

  // Pull fresh Stripe records on demand (same sync as the daily cron).
  const syncMutation = useMutation({
    mutationFn: async (): Promise<{ processedCount?: number }> => {
      const response = await fetch(`/api/projects/${projectId}/stripe/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        processedCount?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      return body;
    },
    onSuccess: (result) => {
      const n = result.processedCount ?? 0;
      setSyncMessage(
        n > 0
          ? `Synced — ${n} new commission${n === 1 ? "" : "s"} added.`
          : "Synced — no new commissions found.",
      );
      queryClient.invalidateQueries({ queryKey: ["payments-live", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
    },
    onError: (err) => {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed.");
    },
  });

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [
      "payments-live",
      projectId,
      kind,
      assignedFilter,
      search,
      pageSize,
      currentCursor ?? "first",
    ],
    queryFn: async (): Promise<ListResponse> => {
      const params = new URLSearchParams();
      params.set("kind", kind);
      params.set("assigned", assignedFilter);
      params.set("limit", String(pageSize));
      if (currentCursor) params.set("cursor", currentCursor);
      if (search) params.set("query", search);
      const r = await fetch(
        `/api/projects/${projectId}/payments?${params.toString()}`,
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load");
      }
      return r.json();
    },
    enabled: !!projectId,
  });

  const { data: partnersData } = useQuery({
    queryKey: ["partners-lite", projectId],
    queryFn: async (): Promise<{ partners: PartnerLite[] }> => {
      const r = await fetch(`/api/partners?project=${projectId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!projectId,
  });
  const partners = partnersData?.partners ?? [];
  const partnerById = useMemo(
    () => new Map(partners.map((p) => [p.id, p])),
    [partners],
  );

  async function assignOne(row: LivePaymentRow, partnerId: string) {
    const r = await fetch(`/api/projects/${projectId}/payments/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "stripe",
        externalPaymentId: row.externalPaymentId,
        kind: row.kind,
        partnerId,
        customerEmail: row.customer.email,
        customerName: row.customer.name,
        planName:
          row.kind === "subscription"
            ? row.plan?.name ?? null
            : row.description ?? null,
        mrr:
          row.kind === "subscription"
            ? row.plan?.unitAmount != null
              ? row.plan.unitAmount / 100
              : null
            : row.amount != null
              ? row.amount / 100
              : null,
        startedAt: row.startedAt ?? row.created ?? null,
        status: row.status ?? null,
        subscriptionAnchorAt:
          row.kind === "subscription" ? row.billingCycleAnchor ?? null : null,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Assign failed");
    }
    return r.json();
  }

  const assignMutation = useMutation({
    mutationFn: (input: { row: LivePaymentRow; partnerId: string }) =>
      assignOne(input.row, input.partnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments-live", projectId] });
      queryClient.invalidateQueries({ queryKey: ["payouts-pending", projectId] });
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (partnerId: string) => {
      const targets = rows.filter((r) => selectedIds.has(r.externalPaymentId));
      // Run in parallel; collect any failures so the user sees a partial-error message.
      const results = await Promise.allSettled(
        targets.map((row) => assignOne(row, partnerId)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        throw new Error(
          `${failed} of ${targets.length} assignments failed`,
        );
      }
      return { count: targets.length };
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkOpen(false);
      queryClient.invalidateQueries({ queryKey: ["payments-live", projectId] });
      queryClient.invalidateQueries({ queryKey: ["payouts-pending", projectId] });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (externalPaymentId: string) => {
      const r = await fetch(`/api/projects/${projectId}/payments/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalPaymentId }),
      });
      if (!r.ok) throw new Error("Unassign failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments-live", projectId] });
      queryClient.invalidateQueries({ queryKey: ["payouts-pending", projectId] });
    },
  });

  // Status filter is applied client-side to the loaded page (payments stream
  // live from Stripe; "succeeded" also covers paid invoices, etc.).
  const allRows = data?.data ?? [];
  const rows =
    statusFilter === "all"
      ? allRows
      : allRows.filter((r) => {
          const s = (r.status ?? "").toLowerCase();
          if (statusFilter === "succeeded") return s === "succeeded" || s === "paid";
          if (statusFilter === "failed")
            return (
              s === "failed" ||
              s === "uncollectible" ||
              s === "past_due" ||
              s === "open"
            );
          return s === "refunded";
        });
  const hasMore = data?.hasMore ?? false;
  const nextCursor = data?.nextCursor;

  // Drop any selections that aren't in the current page (after filter/search/page change).
  useEffect(() => {
    if (selectedIds.size === 0 || !data) return;
    const visible = new Set(data.data.map((r) => r.externalPaymentId));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (visible.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedIds(next);
  }, [data, selectedIds]);

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.externalPaymentId)));
    }
  }

  function applyFilter(next: () => void) {
    setCursorStack([]); // reset pagination on any filter change
    setSelectedIds(new Set());
    next();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Bring in Stripe & CSV revenue, attribute it to partners, then review commissions in Payouts."
      >
        {projects.length > 1 && (
          <Select
            value={projectId ?? ""}
            onValueChange={(v) => {
              const next = new URLSearchParams(searchParams);
              next.set("project", v);
              setSearchParams(next);
            }}
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setSyncMessage(null);
            syncMutation.mutate();
          }}
          disabled={!projectId || syncMutation.isPending}
        >
          {syncMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {syncMutation.isPending ? "Syncing…" : "Sync from Stripe"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setImportOpen(true)}
          disabled={!projectId}
        >
          <Upload className="size-3.5" />
          Import CSV
        </Button>
      </PageHeader>
      {syncMessage && (
        <div className="mb-4 text-xs text-muted-foreground">{syncMessage}</div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm border border-destructive/30">
          {(error as Error).message}
        </div>
      )}

      <div className="bg-card shadow-card rounded-lg">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row gap-3 p-4">
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {(["subscription", "one_time"] as const).map((k) => {
              const active = k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyFilter(() => setKind(k))}
                  className={cn(
                    "px-3 h-7 text-sm font-medium rounded transition-colors",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k === "subscription" ? "Subscriptions" : "One-time"}
                </button>
              );
            })}
          </div>
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {(["unassigned", "assigned", "all"] as const).map((a) => {
              const active = a === assignedFilter;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => applyFilter(() => setAssignedFilter(a))}
                  className={cn(
                    "px-3 h-7 text-sm font-medium rounded transition-colors",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {assignedFilterLabel(a)}
                </button>
              );
            })}
          </div>
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {(["all", "succeeded", "failed", "refunded"] as const).map((s) => {
              const active = s === statusFilter;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 h-7 text-sm font-medium rounded transition-colors capitalize",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "all" ? "Any status" : s}
                </button>
              );
            })}
          </div>
          <div className="flex flex-1 gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name, email, or metadata (e.g. referral_code=lvm-skool)"
                className="pl-9 h-9"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-muted/40">
            <span className="text-sm text-foreground">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
              <Popover open={bulkOpen} onOpenChange={setBulkOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" disabled={bulkAssignMutation.isPending}>
                    {bulkAssignMutation.isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Assigning…
                      </>
                    ) : (
                      <>
                        <UserPlus className="size-3.5" />
                        Assign Partner
                      </>
                    )}
                  </Button>
                </PopoverTrigger>
                <PartnerPickerContent
                  partners={partners}
                  currentId={null}
                  onPick={(partnerId) => {
                    if (partnerId) bulkAssignMutation.mutate(partnerId);
                  }}
                />
              </Popover>
            </div>
          </div>
        )}

        {(bulkAssignMutation.error ||
          assignMutation.error ||
          unassignMutation.error) && (
          <div className="mx-4 my-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs border border-destructive/30">
            {(
              (bulkAssignMutation.error ||
                assignMutation.error ||
                unassignMutation.error) as Error
            ).message}
          </div>
        )}

        {/* Table */}
        <Table className="px-2 pb-2">
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected || (someSelected && "indeterminate")}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                  disabled={rows.length === 0}
                />
              </TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>External ID</TableHead>
              <TableHead>
                {kind === "subscription" ? "Plan" : "Description"}
              </TableHead>
              <TableHead>
                {kind === "subscription" ? "Anchor" : "Date"}
              </TableHead>
              <TableHead className="text-right">
                {kind === "subscription" ? "MRR" : "Amount"}
              </TableHead>
              <TableHead>Attributed to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(isLoading || isFetching) && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                  Loading from Stripe…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
                  <p className="text-sm text-muted-foreground mb-1">
                    {paymentEmptyLabel(assignedFilter, kind)}
                  </p>
                  {search && (
                    <p className="text-xs text-muted-foreground">
                      Try clearing the search.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => {
              const partner = p.assignment
                ? partnerById.get(p.assignment.partnerId)
                : null;
              const checked = selectedIds.has(p.externalPaymentId);
              return (
                <TableRow
                  key={p.externalPaymentId}
                  data-state={checked ? "selected" : undefined}
                  className="border-0 [&>td]:py-4 [&>td]:px-4"
                >
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSelect(p.externalPaymentId)}
                      aria-label={`Select ${p.customer.name ?? p.customer.email ?? p.externalPaymentId}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {p.customer.name || p.customer.email || "—"}
                    </div>
                    {p.customer.name && p.customer.email && (
                      <div className="text-xs text-muted-foreground">
                        {p.customer.email}
                      </div>
                    )}
                    {Object.keys(p.metadata).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(p.metadata).slice(0, 3).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground"
                          >
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <a
                      href={stripeDeepLink(p)}
                      target="_blank"
                      rel="noreferrer"
                      title="Open in Stripe"
                    >
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono hover:bg-muted/70 hover:underline underline-offset-2">
                        {p.externalPaymentId}
                      </code>
                    </a>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.kind === "subscription"
                      ? p.plan?.name ?? "—"
                      : p.description ?? "—"}
                    {p.kind === "subscription" && p.status && (
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
                        {p.status}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {p.kind === "subscription"
                      ? fmtDate(p.billingCycleAnchor)
                      : fmtDate(p.created)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {p.kind === "subscription"
                      ? p.plan?.unitAmount != null
                        ? `${fmtMoneyCents(p.plan.unitAmount)}/${p.plan.interval ?? "mo"}`
                        : "—"
                      : fmtMoneyCents(p.amount)}
                  </TableCell>
                  <TableCell>
                    <Popover>
                      <PopoverTrigger asChild>
                        {partner ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 max-w-full"
                          >
                            <div
                              className="size-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0"
                              style={{ backgroundColor: avatarColor(partner.id) }}
                            >
                              {initialsOf(partner.name || partner.email)}
                            </div>
                            <span className="text-sm truncate">
                              {partner.name || partner.email}
                            </span>
                            {formatAssignmentPlan(p.assignment) && (
                              <span className="text-[10px] text-muted-foreground">
                                ({formatAssignmentPlan(p.assignment)})
                              </span>
                            )}
                          </button>
                        ) : (
                          <Button size="sm" variant="secondary">
                            <UserPlus className="size-3.5" />
                            Assign
                          </Button>
                        )}
                      </PopoverTrigger>
                      <PartnerPickerContent
                        partners={partners}
                        currentId={p.assignment?.partnerId ?? null}
                        onPick={(partnerId) => {
                          if (partnerId) {
                            assignMutation.mutate({ row: p, partnerId });
                          } else {
                            unassignMutation.mutate(p.externalPaymentId);
                          }
                        }}
                      />
                    </Popover>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between p-3 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) =>
                applyFilter(() => setPageSize(parseInt(v, 10)))
              }
            >
              <SelectTrigger className="h-7 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={cursorStack.length === 0 || isFetching}
              onClick={() => setCursorStack((s) => s.slice(0, -1))}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasMore || !nextCursor || isFetching}
              onClick={() => {
                if (nextCursor) setCursorStack((s) => [...s, nextCursor]);
              }}
            >
              {isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent
          side="right"
          className="w-full sm:!w-[640px] sm:!max-w-[640px] overflow-y-auto p-6 gap-0"
        >
          <SheetTitle className="text-2xl tracking-tight mb-1">
            Import payments from CSV
          </SheetTitle>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a CSV with customer + revenue data. We'll auto-map columns
            where we can.
          </p>

          {projectId &&
            (() => {
              const proj = projects.find((p) => p.id === projectId);
              return proj ? (
                <CsvImportPanel
                  project={proj}
                  defaultType="customers"
                  hideTypeSelect
                  framed={false}
                />
              ) : null;
            })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PartnerPickerContent({
  partners,
  currentId,
  onPick,
}: {
  partners: PartnerLite[];
  currentId: string | null;
  onPick: (partnerId: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = partners.filter((p) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(t) ||
      p.email.toLowerCase().includes(t) ||
      p.referralCode.toLowerCase().includes(t)
    );
  });
  return (
    <PopoverContent align="start" className="w-72 p-0">
      <div className="p-2 border-b border-border">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search partners…"
          className="h-8 text-sm"
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-4 text-xs text-muted-foreground text-center">
            No partners.
          </p>
        )}
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/50 transition",
              currentId === p.id && "bg-muted/40",
            )}
          >
            <div
              className="size-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0"
              style={{ backgroundColor: avatarColor(p.id) }}
            >
              {initialsOf(p.name || p.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate">{p.name || "—"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {p.email}
              </div>
            </div>
          </button>
        ))}
      </div>
      {currentId && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <UserMinus className="size-3.5 inline mr-2" />
            Unassign
          </button>
        </div>
      )}
    </PopoverContent>
  );
}

export default Payments;
