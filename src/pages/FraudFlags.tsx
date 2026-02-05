import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
import StatCard from "@/components/StatCard";

interface FraudFlag {
  id: string;
  projectId: string;
  partnerId: string | null;
  type: string;
  severity: "low" | "medium" | "high";
  status: "open" | "dismissed" | "confirmed";
  details: string;
  relatedCommissionId: string | null;
  relatedClickId: string | null;
  partnerName: string;
  partnerEmail: string;
  projectName: string;
  createdAt: string;
}

interface FraudFlagStats {
  total: number;
  open: number;
  high: number;
  dismissed: number;
  confirmed: number;
}

interface FraudFlagsResponse {
  flags: FraudFlag[];
  stats: FraudFlagStats;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

function getFraudTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    self_referral: "Self Referral",
    owner_as_partner: "Owner as Partner",
    duplicate_commission: "Duplicate Commission",
    click_flood: "Click Flood",
    bot_click: "Bot Click",
    geo_mismatch: "Geo Mismatch",
    velocity_spike: "Velocity Spike",
    multi_account: "Multi Account",
    customer_reuse: "Customer Reuse",
    revenue_cap: "Revenue Cap",
    suspicious_activity: "Suspicious Activity",
    policy_violation: "Policy Violation",
    manual: "Manual",
  };
  return labels[type] ?? type;
}

function formatFlagDetails(type: string, details: string): string {
  try {
    const d = JSON.parse(details);
    switch (type) {
      case "self_referral":
        return `Partner email matches customer: ${d.email}`;
      case "owner_as_partner":
        return `Project owner (${d.ownerEmail}) registered as partner`;
      case "click_flood":
        return `${d.clickCount} clicks from same IP in ${d.windowMinutes}min`;
      case "bot_click":
        return `Bot score: ${d.botScore ?? "N/A"}${d.matchedPattern ? `, pattern: ${d.matchedPattern}` : ""}`;
      case "geo_mismatch":
        return `Clicks from ${d.clickCountry}, conversion from ${d.conversionCountry}`;
      case "velocity_spike":
        return `${d.conversionCount} conversions in ${d.windowMinutes}min`;
      case "multi_account":
        return `${d.partnerCount} partners registered from same IP`;
      case "customer_reuse":
        return `${d.email} attributed to ${d.partnerCount} different partners`;
      case "revenue_cap":
        return `$${Number(d.revenue).toFixed(2)} exceeds $${Number(d.threshold).toLocaleString()} cap`;
      case "suspicious_activity":
      case "policy_violation":
        return d.reason ?? d.commissionId ?? "Manually flagged";
      default:
        return details.slice(0, 100);
    }
  } catch {
    return details.slice(0, 100);
  }
}

function FraudFlags() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const projects = projectsData?.projects ?? [];
  const activeProjectId = selectedProject !== "all" ? selectedProject : projects[0]?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["fraud-flags", activeProjectId, statusFilter, severityFilter, typeFilter],
    queryFn: async (): Promise<FraudFlagsResponse> => {
      if (!activeProjectId) return { flags: [], stats: { total: 0, open: 0, high: 0, dismissed: 0, confirmed: 0 } };
      const params = new URLSearchParams({ project: activeProjectId });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const response = await fetch(`/api/fraud-flags?${params}`);
      if (!response.ok) throw new Error("Failed to fetch fraud flags");
      return response.json();
    },
    enabled: !!activeProjectId,
  });

  const updateFlagMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "dismissed" | "confirmed";
    }) => {
      const response = await fetch(`/api/fraud-flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update flag");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading fraud flags...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading fraud flags: {error.message}
        </div>
      </div>
    );
  }

  function getSeverityBadge(severity: string) {
    const styles: Record<string, string> = {
      high: "bg-red-100 text-red-800",
      medium: "bg-yellow-100 text-yellow-800",
      low: "bg-gray-100 text-gray-700",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${
          styles[severity] ?? ""
        }`}
      >
        {severity}
      </span>
    );
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      open: "bg-blue-100 text-blue-800",
      dismissed: "bg-gray-100 text-gray-700",
      confirmed: "bg-red-100 text-red-800",
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

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Fraud Detection
        </h1>
        <p className="text-muted-foreground">
          Review flagged activity across your projects
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        {projects.length > 1 && (
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
        )}
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-card">
              <span>
                {statusFilter === "all" && "All Statuses"}
                {statusFilter === "open" && "Open"}
                {statusFilter === "dismissed" && "Dismissed"}
                {statusFilter === "confirmed" && "Confirmed"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="bg-card">
              <span>
                {severityFilter === "all" && "All Severities"}
                {severityFilter === "high" && "High"}
                {severityFilter === "medium" && "Medium"}
                {severityFilter === "low" && "Low"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="bg-card">
              <span>
                {typeFilter === "all"
                  ? "All Types"
                  : getFraudTypeLabel(typeFilter)}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="self_referral">Self Referral</SelectItem>
              <SelectItem value="owner_as_partner">Owner as Partner</SelectItem>
              <SelectItem value="click_flood">Click Flood</SelectItem>
              <SelectItem value="bot_click">Bot Click</SelectItem>
              <SelectItem value="velocity_spike">Velocity Spike</SelectItem>
              <SelectItem value="multi_account">Multi Account</SelectItem>
              <SelectItem value="customer_reuse">Customer Reuse</SelectItem>
              <SelectItem value="revenue_cap">Revenue Cap</SelectItem>
              <SelectItem value="geo_mismatch">Geo Mismatch</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Open Flags"
          value={data?.stats.open ?? 0}
          Icon={ShieldAlert}
        />
        <StatCard
          title="High Severity"
          value={data?.stats.high ?? 0}
          Icon={AlertTriangle}
        />
        <StatCard
          title="Dismissed"
          value={data?.stats.dismissed ?? 0}
          Icon={XCircle}
        />
        <StatCard
          title="Confirmed"
          value={data?.stats.confirmed ?? 0}
          Icon={CheckCircle}
        />
      </div>

      {/* Flags Table */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          All Fraud Flags
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.flags.map((flag) => (
              <TableRow key={flag.id}>
                <TableCell>
                  <span className="text-sm font-medium">
                    {getFraudTypeLabel(flag.type)}
                  </span>
                </TableCell>
                <TableCell>
                  {flag.partnerId ? (
                    <div>
                      <div className="font-medium text-sm">{flag.partnerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {flag.partnerEmail}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{getSeverityBadge(flag.severity)}</TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground max-w-xs truncate block">
                    {formatFlagDetails(flag.type, flag.details)}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(flag.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>{getStatusBadge(flag.status)}</TableCell>
                <TableCell>
                  {flag.status === "open" && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          updateFlagMutation.mutate({
                            id: flag.id,
                            status: "dismissed",
                          })
                        }
                        disabled={updateFlagMutation.isPending}
                        aria-label="Dismiss flag"
                      >
                        Dismiss
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() =>
                          updateFlagMutation.mutate({
                            id: flag.id,
                            status: "confirmed",
                          })
                        }
                        disabled={updateFlagMutation.isPending}
                        aria-label="Confirm fraud"
                      >
                        Confirm
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(!data?.flags || data.flags.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  No fraud flags detected. The system automatically monitors for
                  suspicious activity.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default FraudFlags;
