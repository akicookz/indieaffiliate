import { useState } from "react";
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
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
import StatCard from "@/components/StatCard";

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

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
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

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function getCustomerStatusBadge(status: string | null) {
  if (!status) return null;
  const styles: Record<string, string> = {
    paid: "bg-green-100 text-green-800 border-green-200",
    trialing: "bg-blue-100 text-blue-800 border-blue-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
    past_due: "bg-orange-100 text-orange-800 border-orange-200",
    refunded: "bg-purple-100 text-purple-800 border-purple-200",
    cancels_on: "bg-yellow-100 text-yellow-800 border-yellow-200",
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
        styles[status] ?? "bg-gray-100 text-gray-800 border-gray-200"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function buildPaymentNote(partner: PartnerGroup) {
  const approved = partner.commissions.filter((c) => c.status === "approved");
  if (approved.length === 0) return "";

  // Group by month, then by amount within each month
  const byMonth = new Map<string, CommissionDetail[]>();
  for (const c of approved) {
    const d = c.eventDate ?? c.createdAt;
    const month = new Date(d).toLocaleDateString("en-US", { month: "short" });
    const list = byMonth.get(month) ?? [];
    list.push(c);
    byMonth.set(month, list);
  }

  const projectName = approved[0]?.projectName ?? "Affiliate";

  const months = Array.from(byMonth.entries()).map(([month, comms]) => {
    const total = comms.reduce((s, c) => s + c.amount, 0);
    const counts = new Map<number, number>();
    for (const c of comms) counts.set(c.amount, (counts.get(c.amount) ?? 0) + 1);
    const items = Array.from(counts.entries())
      .map(([amt, n]) => `${formatCurrency(amt)} x${n}`)
      .join(", ");
    return `${month}: ${formatCurrency(total)} (${items})`;
  });

  return `${projectName} Affiliate payout ${formatCurrency(partner.approvedAmount)}: ${months.join(", ")} - thank you!`;
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

  if (partner.approvedAmount <= 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 mr-1 text-green-600" />
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
  const pendingIds = partner.commissions.filter((c) => c.status === "pending" && !c.fraudFlag).map((c) => c.id);
  const approvedIds = partner.commissions.filter((c) => c.status === "approved" && !c.fraudFlag).map((c) => c.id);
  const flaggedPendingIds = partner.commissions.filter((c) => c.status === "pending" && c.fraudFlag).map((c) => c.id);

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
          {partner.payoutLink ? (
            <a
              href={partner.payoutLink.startsWith("http") ? partner.payoutLink : `https://${partner.payoutLink}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {partner.payoutLink}
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">Not set</span>
          )}
        </TableCell>
        <TableCell>
          {partner.pendingCount > 0 ? (
            <div className="text-sm">
              <span className="font-medium text-yellow-700 dark:text-yellow-400">
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
              <span className="font-medium text-blue-700 dark:text-blue-400">
                {formatCurrency(partner.approvedAmount)}
              </span>
              <span className="text-muted-foreground ml-1">({partner.approvedCount})</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>
          {partner.paidCount > 0 ? (
            <div className="text-sm">
              <span className="font-medium text-green-700 dark:text-green-400">
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
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onBulkAction(pendingIds, "approve")}
                disabled={isMutating}
              >
                <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                Approve All ({pendingIds.length})
              </Button>
            )}
            {approvedIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onBulkAction(approvedIds, "pay")}
                disabled={isMutating}
              >
                <DollarSign className="w-3 h-3 mr-1 text-blue-600" />
                Mark All Paid ({approvedIds.length})
              </Button>
            )}
            <CopyNoteButton partner={partner} />
            {flaggedPendingIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
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

      {/* Expanded commission detail rows */}
      {isExpanded && partner.commissions.map((commission) => {
        const eventDate = commission.eventDate
          ? new Date(commission.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        const createdDate = new Date(commission.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        return (
          <TableRow key={commission.id} className="bg-muted/20">
            <TableCell />
            {/* Customer info + subscription status */}
            <TableCell>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{commission.customerEmail}</span>
                  {getCustomerStatusBadge(commission.customerStatus)}
                </div>
                {commission.customerRevenue > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                    <CreditCard className="w-3 h-3" />
                    {formatCurrency(commission.customerRevenue)} lifetime revenue
                  </div>
                )}
              </div>
            </TableCell>
            {/* Event date */}
            <TableCell>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                {eventDate ? (
                  <span>{eventDate}</span>
                ) : (
                  <span className="italic">{createdDate}</span>
                )}
              </div>
            </TableCell>
            {/* Commission amount @ rate */}
            <TableCell>
              <span className="text-sm font-medium">
                {formatCurrency(commission.amount)} <span className="text-muted-foreground font-normal">@ {Math.round(commission.rate * 100)}%</span>
              </span>
            </TableCell>
            {/* Status + fraud flag */}
            <TableCell>
              <div className="flex items-center gap-1.5">
                {getStatusBadge(commission.status)}
                {commission.fraudFlag && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-200" title={commission.fraudFlag}>
                    <AlertTriangle className="w-3 h-3" />
                    {commission.fraudFlag.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </TableCell>
            {/* Actions */}
            <TableCell onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-1">
                {commission.status === "pending" && (
                  <>
                    {!commission.fraudFlag && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() => onSingleAction(commission.id, "approved")}
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
                          className="h-6 px-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={isMutating}
                          aria-label="Reject"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => onFlagCustomer(commission.customerId, "self_referral")}
                          className="text-orange-600 font-medium"
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
                            onClick={() => onSingleAction(commission.id, "rejected", item.flag)}
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
                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={() => onSingleAction(commission.id, "paid")}
                    disabled={isMutating}
                  >
                    Mark Paid
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </>
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
      if (!response.ok) throw new Error("Failed to update commissions");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
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
      if (!response.ok) throw new Error("Failed to update commission");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
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
            Review commissions by partner, approve, and track payments
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
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

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-6">
        <StatCard
          title="Pending Approval"
          value={formatCurrency(totals.pendingAmount)}
          Icon={Clock}
        />
        <StatCard
          title="Approved (Owed)"
          value={formatCurrency(totals.approvedAmount)}
          Icon={DollarSign}
        />
        <StatCard
          title="Paid"
          value={formatCurrency(totals.paidAmount)}
          Icon={CheckCircle}
        />
      </div>

      {/* Partner payouts table */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Partner payouts ledger
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Partner</TableHead>
              <TableHead>Payout Link</TableHead>
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
                  colSpan={7}
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
    </div>
  );
}

export default Payouts;
