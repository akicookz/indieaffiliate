import { useMemo, useState } from "react";
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
  MoreHorizontal,
  ExternalLink,
  Flag,
  Trash2,
  UserPlus,
  UserMinus,
  DollarSign,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface PaymentRow {
  id: string;
  projectId: string;
  partnerId: string | null;
  source: string;
  externalPaymentId: string;
  kind: "subscription" | "one_time";
  customerEmail: string | null;
  customerName: string | null;
  planName: string | null;
  mrr: number | null;
  startedAt: string | null;
  status: string | null;
  flagReason: string | null;
}

interface PaymentsResponse {
  payments: PaymentRow[];
  counts: {
    all: number;
    unassigned: number;
    assigned: number;
    flagged: number;
  };
}

type AssignedFilter = "all" | "unassigned" | "assigned" | "flagged";
type SourceFilter = "all" | "stripe" | "csv";

const FRAUD_REASONS = [
  { value: "self_referral", label: "Self referral" },
  { value: "bot_click", label: "Bot / fake traffic" },
  { value: "suspicious_activity", label: "Suspicious activity" },
  { value: "policy_violation", label: "Policy violation" },
] as const;

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

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function stripeDeepLink(p: PaymentRow): string {
  if (p.source !== "stripe") return "#";
  if (p.kind === "subscription") {
    return `https://dashboard.stripe.com/subscriptions/${p.externalPaymentId}`;
  }
  return `https://dashboard.stripe.com/payments/${p.externalPaymentId}`;
}

function Payments() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);

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

  const { data, isLoading } = useQuery({
    queryKey: [
      "payments",
      projectId,
      assignedFilter,
      sourceFilter,
      search,
    ],
    queryFn: async (): Promise<PaymentsResponse> => {
      const params = new URLSearchParams();
      if (assignedFilter !== "all") params.set("assigned", assignedFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (search.trim()) params.set("search", search.trim());
      const r = await fetch(
        `/api/projects/${projectId}/payments?${params.toString()}`,
      );
      if (!r.ok) throw new Error("Failed");
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

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/payments/sync`, {
        method: "POST",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Sync failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", projectId] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (input: { id: string; partnerId: string | null }) => {
      const r = await fetch(`/api/payments/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: input.partnerId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", projectId] });
    },
  });

  const flagMutation = useMutation({
    mutationFn: async (input: { id: string; flagReason: string | null }) => {
      const r = await fetch(`/api/payments/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagReason: input.flagReason }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/payments/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", projectId] });
    },
  });

  async function bulkAssign(partnerId: string | null) {
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        assignMutation.mutateAsync({ id, partnerId }),
      ),
    );
    setSelectedIds(new Set());
  }

  const payments = data?.payments ?? [];
  const counts = data?.counts ?? { all: 0, unassigned: 0, assigned: 0, flagged: 0 };
  const allSelected =
    payments.length > 0 && selectedIds.size === payments.length;

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(payments.map((p) => p.id)));
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const subtitle = `${counts.all} payments · ${counts.assigned} attributed · ${counts.flagged} flagged`;

  const tabs: { value: AssignedFilter; label: string }[] = [
    { value: "all", label: `All` },
    { value: "unassigned", label: `Unassigned (${counts.unassigned})` },
    { value: "assigned", label: `Assigned (${counts.assigned})` },
    { value: "flagged", label: `Flagged (${counts.flagged})` },
  ];

  return (
    <div className="p-6">
      <PageHeader eyebrow="BILLING" title="Payments" subtitle={subtitle}>
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
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || !projectId}
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

      {syncMutation.isError && (
        <div className="mb-4 p-3 rounded-md bg-warning/10 text-warning text-sm border border-warning/30">
          {(syncMutation.error as Error).message}
        </div>
      )}

      <div className="bg-card border rounded-md">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row gap-3 p-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, email, sub_id…"
              className="pl-9 h-9"
            />
          </div>
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {tabs.map((t) => {
              const active = t.value === assignedFilter;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setAssignedFilter(t.value)}
                  className={cn(
                    "px-3 h-7 text-sm font-medium rounded transition-colors",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {(["all", "stripe", "csv"] as const).map((s) => {
              const active = sourceFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSourceFilter(s)}
                  className={cn(
                    "px-3 h-7 text-sm font-medium rounded transition-colors capitalize",
                    active
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "all" ? "All" : s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border-y border-border text-sm">
            <span className="text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="secondary">
                  <UserPlus className="size-3.5" />
                  Assign to partner
                </Button>
              </PopoverTrigger>
              <PartnerPickerContent
                partners={partners}
                onPick={(partnerId) => bulkAssign(partnerId)}
              />
            </Popover>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => bulkAssign(null)}
            >
              <UserMinus className="size-3.5" />
              Unassign
            </Button>
            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        <Table className="px-2 pb-2">
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-12 w-10 px-4">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">Customer</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">External ID</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">Plan</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">Source</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">Started</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4 text-right">MRR</TableHead>
              <TableHead className="text-eyebrow-muted h-12 px-4">Attributed to</TableHead>
              <TableHead className="h-12 w-10 px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16">
                  <p className="text-sm text-muted-foreground mb-3">
                    No payments yet.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Click <strong>Sync from Stripe</strong> to pull
                    subscriptions and one-time charges.
                  </p>
                </TableCell>
              </TableRow>
            )}
            {payments.map((p) => {
              const partner = p.partnerId ? partnerById.get(p.partnerId) : null;
              const checked = selectedIds.has(p.id);
              return (
                <TableRow
                  key={p.id}
                  className="border-0 [&>td]:py-4 [&>td]:px-4"
                >
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleOne(p.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {p.customerName || p.customerEmail || "—"}
                    </div>
                    {p.customerName && p.customerEmail && (
                      <div className="text-xs text-muted-foreground">
                        {p.customerEmail}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {p.externalPaymentId}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.planName ?? "—"}
                    {p.kind === "one_time" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        One-time
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.source === "stripe" ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <DollarSign className="size-3 text-accent" />
                        Stripe
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Upload className="size-3 text-muted-foreground" />
                        CSV
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {p.startedAt
                      ? new Date(p.startedAt).toISOString().slice(0, 10)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {p.mrr != null
                      ? p.kind === "subscription"
                        ? `${fmtMoney(p.mrr)}/mo`
                        : `${fmtMoney(p.mrr)} once`
                      : "—"}
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
                        currentId={p.partnerId}
                        onPick={(partnerId) =>
                          assignMutation.mutate({ id: p.id, partnerId })
                        }
                      />
                    </Popover>
                    {p.flagReason && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-destructive">
                        <Flag className="size-3" />
                        {p.flagReason.replace(/_/g, " ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="More"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {p.partnerId && (
                          <DropdownMenuItem
                            onSelect={() =>
                              assignMutation.mutate({
                                id: p.id,
                                partnerId: null,
                              })
                            }
                          >
                            Unassign
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            Flag…
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {FRAUD_REASONS.map((r) => (
                              <DropdownMenuItem
                                key={r.value}
                                onSelect={() =>
                                  flagMutation.mutate({
                                    id: p.id,
                                    flagReason: r.value,
                                  })
                                }
                              >
                                {r.label}
                              </DropdownMenuItem>
                            ))}
                            {p.flagReason && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() =>
                                    flagMutation.mutate({
                                      id: p.id,
                                      flagReason: null,
                                    })
                                  }
                                >
                                  Clear flag
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {p.source === "stripe" && (
                          <DropdownMenuItem asChild>
                            <a
                              href={stripeDeepLink(p)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="size-3.5" />
                              Open in Stripe
                            </a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => {
                            if (confirm("Remove this payment row?")) {
                              deleteMutation.mutate(p.id);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          Delete row
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent
          side="right"
          className="w-full sm:!w-[640px] sm:!max-w-[640px] overflow-y-auto p-6 gap-0"
        >
          <SheetTitle
            className="text-2xl tracking-tight mb-1"
            style={{
              fontFamily: `"Source Serif 4", Georgia, serif`,
              fontWeight: 500,
            }}
          >
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
  currentId?: string | null;
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
