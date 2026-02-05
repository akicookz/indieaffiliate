import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandHeart, Users, TrendingUp, UserPlus, Copy, Check } from "lucide-react";
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

function Partners() {
  const [selectedProject, setSelectedProject] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["partners", selectedProject, statusFilter],
    queryFn: async (): Promise<PartnersResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      if (statusFilter !== "all") params.set("status", statusFilter);
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
        <InvitePartnerDialog projects={projects} />
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
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
              <TableHead>Customers</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.partners.map((partner) => (
              <TableRow key={partner.id}>
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
              </TableRow>
            ))}
            {(!data?.partners || data.partners.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  No partners yet. Create a project first, then invite partners.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default Partners;
