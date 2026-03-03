import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HandHeart, Users, TrendingUp, UserPlus, Copy, Check, ExternalLink, Pencil, Upload, CheckCircle, XCircle, Search } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatCard from "@/components/StatCard";
import InvitePartnerDialog from "@/components/InvitePartnerDialog";

interface Partner {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive" | "pending";
  referredCustomers: number;
  totalRevenue: number;
  commissionRate: number;
  projectName: string;
  referralCode: string;
  payoutLink: string | null;
  createdAt: string;
}

interface PartnerStats {
  totalPartners: number;
  activePartners: number;
  pendingPartners: number;
}

interface PartnersResponse {
  partners: Partner[];
  stats: PartnerStats;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

function CopyReferralLink({ referralCode }: { referralCode: string }) {
  const [copied, setCopied] = useState(false);
  const referralUrl = `${window.location.origin}/api/t/${referralCode}`;

  function handleCopy() {
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
        {referralCode}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={handleCopy}
        aria-label="Copy referral link"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-600" />
        ) : (
          <Copy className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}

function EditPartnerSheet({
  partner,
  open,
  onOpenChange,
}: {
  partner: Partner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(partner.name);
  const [email, setEmail] = useState(partner.email);
  const [status, setStatus] = useState(partner.status);
  const [commissionRate, setCommissionRate] = useState(
    String(Math.round(partner.commissionRate * 100)),
  );
  const [referralCode, setReferralCode] = useState(partner.referralCode);
  const [payoutLink, setPayoutLink] = useState(partner.payoutLink ?? "");

  // Reset form when partner changes
  useEffect(() => {
    setName(partner.name);
    setEmail(partner.email);
    setStatus(partner.status);
    setCommissionRate(String(Math.round(partner.commissionRate * 100)));
    setReferralCode(partner.referralCode);
    setPayoutLink(partner.payoutLink ?? "");
  }, [partner]);

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await fetch(`/api/partners/${partner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error((body as { error?: string }).error ?? "Failed to update partner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const updates: Record<string, unknown> = {};

    if (name.trim() !== partner.name) updates.name = name.trim();
    if (email.trim() !== partner.email) updates.email = email.trim().toLowerCase();
    if (status !== partner.status) updates.status = status;

    const rateDecimal = parseFloat(commissionRate) / 100;
    if (!isNaN(rateDecimal) && rateDecimal !== partner.commissionRate) {
      updates.commissionRate = rateDecimal;
    }

    if (referralCode.trim() !== partner.referralCode) {
      updates.referralCode = referralCode.trim();
    }

    const newPayoutLink = payoutLink.trim() || null;
    if (newPayoutLink !== partner.payoutLink) {
      updates.payoutLink = newPayoutLink;
    }

    if (Object.keys(updates).length === 0) {
      onOpenChange(false);
      return;
    }

    updateMutation.mutate(updates);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit Partner</SheetTitle>
          <SheetDescription>
            Update partner details. Changes are saved immediately.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6 px-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Partner name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Partner["status"])}>
              <SelectTrigger id="edit-status">
                <span className="capitalize">{status}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-commission">Commission Rate (%)</Label>
            <Input
              id="edit-commission"
              type="number"
              min="1"
              max="100"
              step="1"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-referral">Referral Code</Label>
            <Input
              id="edit-referral"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder="CODE123"
              className="font-mono"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-payout">Payout Link</Label>
            <Input
              id="edit-payout"
              value={payoutLink}
              onChange={(e) => setPayoutLink(e.target.value)}
              placeholder="paypal.me/name or wise.com/pay/..."
            />
          </div>

          {updateMutation.error && (
            <p className="text-sm text-destructive">
              {updateMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Partners() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/partners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error((body as { error?: string }).error ?? "Failed to update status");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["partners", selectedProject, statusFilter, searchQuery],
    queryFn: async (): Promise<PartnersResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const response = await fetch(`/api/partners?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch partners data");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading partners...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading partners: {error.message}
        </div>
      </div>
    );
  }

  function getStatusBadge(status: string) {
    const styles = {
      active: "bg-green-100 text-green-800",
      pending: "bg-yellow-100 text-yellow-800",
      inactive: "bg-red-100 text-red-800 border border-red-300",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${
          styles[status as keyof typeof styles]
        }`}
      >
        {status}
      </span>
    );
  }

  const totalRevenue = data?.partners.reduce((sum, p) => sum + p.totalRevenue, 0) ?? 0;
  const projects = projectsData?.projects ?? [];

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Partners</h1>
          <p className="text-muted-foreground">
            Manage and view all your affiliate partners
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Link>
          </Button>
          <InvitePartnerDialog projects={projects} />
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
        <div className="w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-card">
              <span>
                {statusFilter === "all" && "All Statuses"}
                {statusFilter === "active" && "Active"}
                {statusFilter === "pending" && "Pending"}
                {statusFilter === "inactive" && "Inactive"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name, email, code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-card"
            aria-label="Search partners"
          />
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Partners"
          value={(data?.stats.totalPartners ?? 0).toLocaleString()}
          Icon={HandHeart}
        />

        <StatCard
          title="Active Partners"
          value={(data?.stats.activePartners ?? 0).toLocaleString()}
          Icon={Users}
        />

        <StatCard
          title="Pending"
          value={(data?.stats.pendingPartners ?? 0).toLocaleString()}
          Icon={UserPlus}
        />

        <StatCard
          title="Total Revenue"
          value={`$${totalRevenue.toLocaleString()}`}
          Icon={TrendingUp}
        />
      </div>

      {/* Partners Table */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          All Partners
        </h3>
         <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partner</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Referral Link</TableHead>
              <TableHead>Payout Link</TableHead>
              <TableHead>Customers</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.partners.map((partner) => (
              <TableRow
                key={partner.id}
                className={partner.status === "pending" ? "bg-amber-50/30 dark:bg-amber-950/10" : undefined}
              >
                <TableCell>
                  <div>
                    <div className="font-medium">{partner.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {partner.email}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {partner.projectName}
                  </span>
                </TableCell>
                <TableCell>{getStatusBadge(partner.status)}</TableCell>
                <TableCell>
                  <CopyReferralLink referralCode={partner.referralCode} />
                </TableCell>
                <TableCell>
                  {partner.payoutLink ? (
                    <a
                      href={partner.payoutLink.startsWith("http") ? partner.payoutLink : `https://${partner.payoutLink}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-[140px]"
                    >
                      {partner.payoutLink}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  {partner.referredCustomers}
                </TableCell>
                <TableCell className="font-medium">
                  ${partner.totalRevenue.toFixed(2)}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(partner.commissionRate * 100)}%
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {partner.status === "pending" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/30"
                          onClick={() => statusMutation.mutate({ id: partner.id, status: "active" })}
                          disabled={statusMutation.isPending}
                          aria-label="Approve partner"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                          onClick={() => statusMutation.mutate({ id: partner.id, status: "inactive" })}
                          disabled={statusMutation.isPending}
                          aria-label="Reject partner"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditingPartner(partner)}
                      aria-label="Edit partner"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(!data?.partners || data.partners.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8"
                >
                  No partners yet. Create a project first, then invite partners.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Partner Sheet */}
      {editingPartner && (
        <EditPartnerSheet
          partner={editingPartner}
          open={editingPartner !== null}
          onOpenChange={(open) => {
            if (!open) setEditingPartner(null);
          }}
        />
      )}
    </div>
  );
}

export default Partners;
