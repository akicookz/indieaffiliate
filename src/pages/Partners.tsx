import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Upload, Download } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import CsvImportPanel from "@/components/CsvImportPanel";
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
import { cn } from "@/lib/utils";
import InvitePartnerDialog from "@/components/InvitePartnerDialog";
import PartnerDetailDrawer from "@/components/PartnerDetailDrawer";

export interface PartnerListRow {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive" | "pending";
  referredCustomers: number;
  totalRevenue: number;
  commissionRate: number;
  commissionProgramId: string | null;
  commissionProgram: {
    id: string;
    name: string;
    rate: number;
    type: string;
    durationMonths: number | null;
    flatAmount: number | null;
  } | null;
  usesDefaultCommissionProgram: boolean;
  defaultCommissionProgramId: string | null;
  channel: string | null;
  projectName: string;
  projectId: string;
  referralCode: string;
  payoutLink: string | null;
  createdAt: string;
  cancelRate: number;
  ltvRevenue: number;
  ltvMonths: number;
  metrics: {
    refs: number;
    clicks: number;
    conv: number;
    epc: number;
    mrr: number;
  };
}

interface PartnersResponse {
  partners: PartnerListRow[];
  stats: { totalPartners: number; activePartners: number; pendingPartners: number };
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

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

const STATUS_TONE: Record<string, string> = {
  active: "bg-positive/10 text-positive",
  pending: "bg-warning/10 text-warning",
  inactive: "bg-muted text-muted-foreground",
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

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function formatProgramAmount(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function commissionSummary(partner: PartnerListRow): {
  primary: string;
  secondary: string;
} {
  const program = partner.commissionProgram;
  if (!program) {
    return {
      primary: `${(partner.commissionRate * 100).toFixed(0)}%`,
      secondary: partner.defaultCommissionProgramId
        ? "Default program unavailable"
        : "Fallback rate",
    };
  }
  const amount =
    program.type === "one-time" &&
    program.flatAmount != null &&
    program.flatAmount > 0
      ? `${formatProgramAmount(program.flatAmount)} flat`
      : `${program.rate}%`;
  return {
    primary: `${amount} · ${program.type}`,
    secondary: partner.usesDefaultCommissionProgram
      ? "Project default"
      : "Assigned",
  };
}

function statusFromTab(tab: string): string {
  switch (tab) {
    case "active":
      return "active";
    case "review":
      return "pending";
    case "paused":
      return "inactive";
    default:
      return "all";
  }
}

function downloadCsv(rows: PartnerListRow[]) {
  const header = [
    "name",
    "email",
    "code",
    "channel",
    "commission",
    "refs",
    "conv",
    "epc",
    "mrr",
    "status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.name,
      r.email,
      r.referralCode,
      r.channel ?? "",
      `${commissionSummary(r).primary} (${commissionSummary(r).secondary})`,
      r.metrics.refs,
      `${r.metrics.conv.toFixed(1)}%`,
      r.metrics.epc.toFixed(2),
      r.metrics.mrr.toFixed(2),
      r.status,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partners-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Partners() {
  // Honor deep-links from the dashboard: ?status=pending opens the review tab,
  // ?partner=<id> opens that partner's detail drawer.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"all" | "active" | "review" | "paused">(
    searchParams.get("status") === "pending" ? "review" : "all",
  );
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    searchParams.get("partner"),
  );
  const [importOpen, setImportOpen] = useState(false);
  const [importProjectId, setImportProjectId] = useState<string>("");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["partners", tab, search, channelFilter],
    queryFn: async (): Promise<PartnersResponse> => {
      const params = new URLSearchParams();
      const status = statusFromTab(tab);
      if (status !== "all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      if (channelFilter !== "all") params.set("channel", channelFilter);
      const r = await fetch(`/api/partners?${params.toString()}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const partners = data?.partners ?? [];
  const reviewCount = useMemo(
    () => partners.filter((p) => p.status === "pending").length,
    [partners],
  );
  const channelCount = useMemo(
    () => new Set(partners.map((p) => p.channel).filter(Boolean)).size,
    [partners],
  );
  const activeLast30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return partners.filter(
      (p) => p.status === "active" && new Date(p.createdAt).getTime() > cutoff,
    ).length;
  }, [partners]);

  const subtitle = `${data?.stats.totalPartners ?? 0} partners across ${channelCount} channels · ${activeLast30} active in last 30 days`;

  const tabs: { value: typeof tab; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "review", label: reviewCount > 0 ? `Review (${reviewCount})` : "Review" },
    { value: "paused", label: "Paused" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Partners" subtitle={subtitle}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const projects = projectsData?.projects ?? [];
            if (!importProjectId && projects.length > 0) {
              setImportProjectId(projects[0].id);
            }
            setImportOpen(true);
          }}
        >
          <Upload className="size-3.5" />
          Import
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadCsv(partners)}
        >
          <Download className="size-3.5" />
          Export
        </Button>
        <InvitePartnerDialog projects={projectsData?.projects ?? []} />
      </PageHeader>

      <div className="bg-card shadow-card rounded-lg">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row gap-3 p-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or code…"
              className="pl-9 h-9"
            />
          </div>

          <div className="inline-flex items-center p-1 bg-muted rounded-md gap-1">
            {tabs.map((t) => {
              const active = t.value === tab;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
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

          <FilterSelect
            value={channelFilter}
            onChange={setChannelFilter}
            placeholder="Channel"
            options={[
              { value: "all", label: "All channels" },
              { value: "unset", label: "Unset" },
              ...Object.entries(CHANNEL_META).map(([v, m]) => ({
                value: v,
                label: m.label,
              })),
            ]}
          />
        </div>

        {/* Table */}
        <Table className="px-2 pb-2">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Partner</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead className="text-right">LTV</TableHead>
              <TableHead className="text-right">Cancel %</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                  Loading partners…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && isError && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-destructive text-sm">
                  Couldn't load partners. Check your connection and try again.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && partners.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                  No partners match these filters.
                </TableCell>
              </TableRow>
            )}
            {!isError && partners.map((p) => {
              return (
                <TableRow
                  key={p.id}
                  className="cursor-pointer [&>td]:py-2.5"
                  onClick={() => setSelectedPartnerId(p.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="size-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                        style={{ backgroundColor: avatarColor(p.id) }}
                      >
                        {initials(p.name || p.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {p.name || "—"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {p.referralCode}
                    </code>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.referredCustomers.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(p.totalRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(p.metrics.mrr)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(p.ltvRevenue)}
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {p.ltvMonths.toFixed(1)}mo
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      p.cancelRate >= 30 ? "text-negative" : "text-foreground",
                    )}
                  >
                    {p.cancelRate.toFixed(0)}%
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                        STATUS_TONE[p.status] ?? "bg-muted",
                      )}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor:
                            p.status === "active"
                              ? "var(--positive)"
                              : p.status === "pending"
                                ? "var(--warning)"
                                : "var(--muted-foreground)",
                        }}
                      />
                      {p.status === "pending"
                        ? "Review"
                        : p.status === "inactive"
                          ? "Paused"
                          : "Active"}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PartnerDetailDrawer
        partnerId={selectedPartnerId}
        open={!!selectedPartnerId}
        onOpenChange={(o) => !o && setSelectedPartnerId(null)}
      />

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent
          side="right"
          className="w-full sm:!w-[640px] sm:!max-w-[640px] overflow-y-auto p-6 gap-0"
        >
          <SheetTitle className="text-2xl tracking-tight mb-1">
            Import partners from CSV
          </SheetTitle>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a CSV with your partner list. We'll auto-map columns where
            we can.
          </p>

          {(projectsData?.projects ?? []).length > 1 && (
            <div className="space-y-1.5 mb-4">
              <p className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground">
                Project
              </p>
              <Select
                value={importProjectId}
                onValueChange={setImportProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a project" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsData?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {importProjectId &&
            (() => {
              const proj = (projectsData?.projects ?? []).find(
                (p) => p.id === importProjectId,
              );
              return proj ? (
                <CsvImportPanel
                  project={proj}
                  defaultType="partners"
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

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-36">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default Partners;
