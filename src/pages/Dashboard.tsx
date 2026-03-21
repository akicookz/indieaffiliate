import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, MousePointer, Users, Clock, Upload, BarChart3 } from "lucide-react";
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

interface DashboardData {
  revenue: {
    total: number;
    change: number;
    isPositive: boolean;
  };
  clicks: number;
  leads: number;
  newCustomers: number;
  topReferrers: Array<{
    id: string;
    partnerName: string;
    email: string;
    referredCustomers: number;
    totalRevenue: number;
    project: string;
  }>;
  newReferredCustomers: Array<{
    id: string;
    createdDate: string;
    email: string;
    referredPartner: string;
    status: "trialing" | "paid" | "cancelled";
    project: string;
  }>;
}

interface CommissionsTotals {
  partners: unknown[];
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

function Dashboard() {
  const [selectedProject, setSelectedProject] = useState("all");

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const projects = projectsData?.projects ?? [];
  const shouldRedirectToOnboarding = !projectsLoading && projects.length === 0;
  const showProjectColumn = projects.length > 1;

  const { data: dashData, isLoading: dashLoading, error: dashError } = useQuery({
    queryKey: ["dashboard", selectedProject],
    queryFn: async (): Promise<DashboardData> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      const response = await fetch(`/api/dashboard?${params}`);
      if (!response.ok) throw new Error("Failed to fetch dashboard data");
      return response.json();
    },
    enabled: !projectsLoading && projects.length > 0,
  });

  const { data: commissionsData } = useQuery({
    queryKey: ["commissions-by-partner", selectedProject],
    queryFn: async (): Promise<CommissionsTotals> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      const response = await fetch(`/api/commissions/by-partner?${params}`);
      if (!response.ok) throw new Error("Failed to fetch commissions");
      return response.json();
    },
    enabled: !projectsLoading && projects.length > 0,
  });

  if (shouldRedirectToOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (projectsLoading || dashLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading dashboard...</div>
      </div>
    );
  }

  if (dashError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading dashboard: {dashError.message}
        </div>
      </div>
    );
  }

  function getStatusBadge(status: string) {
    const styles = {
      paid: "bg-green-100 text-green-800",
      trialing: "bg-yellow-100 text-yellow-800",
      cancelled: "bg-red-100 text-red-800 border border-red-300",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${styles[status as keyof typeof styles]
          }`}
      >
        {status}
      </span>
    );
  }

  const pendingAmount = commissionsData?.totals.pendingAmount ?? 0;

  return (
    <div className="space-y-6 bg-background">
      {/* Header with Filters */}
      <div className="flex gap-4 items-center">
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/import">
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Link>
        </Button>
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
        <div className="ml-auto">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/app/analytics">
              <BarChart3 className="w-4 h-4 mr-2" />
              View Analytics
            </Link>
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Revenue"
          value={`$${(dashData?.revenue.total ?? 0).toLocaleString()}`}
          Icon={TrendingUp}
          isPositive={dashData?.revenue.isPositive}
          change={dashData?.revenue.change}
        />
        <StatCard
          title="Clicks"
          value={(dashData?.clicks ?? 0).toLocaleString()}
          Icon={MousePointer}
        />
        <StatCard
          title="Customers"
          value={(dashData?.newCustomers ?? 0).toLocaleString()}
          Icon={Users}
        />
        <StatCard
          title="Pending Commissions"
          value={`$${pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          Icon={Clock}
        />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Referrers Table */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">
              Top referrers
            </h3>
            <Link
              to="/app/partners"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                {showProjectColumn && <TableHead>Project</TableHead>}
                <TableHead>Customers</TableHead>
                <TableHead>Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashData?.topReferrers.map((referrer) => (
                <TableRow key={referrer.id}>
                  <TableCell>
                    <div>
                      <Link
                        to={`/app/customers?partner=${referrer.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {referrer.partnerName}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {referrer.email}
                      </div>
                    </div>
                  </TableCell>
                  {showProjectColumn && (
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {referrer.project}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {referrer.referredCustomers}
                  </TableCell>
                  <TableCell className="font-medium">
                    ${referrer.totalRevenue.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
              {(!dashData?.topReferrers || dashData.topReferrers.length === 0) && (
                <TableRow>
                  <TableCell
                    colSpan={showProjectColumn ? 4 : 3}
                    className="text-center text-muted-foreground py-8"
                  >
                    No partners yet. Invite your first partner to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* New Referred Customers Table */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">
              New referred customers
            </h3>
            <Link
              to="/app/customers"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                {showProjectColumn && <TableHead>Project</TableHead>}
                <TableHead>Partner</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashData?.newReferredCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{customer.email}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(customer.createdDate).toLocaleDateString()}
                      </div>
                    </div>
                  </TableCell>
                  {showProjectColumn && (
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {customer.project}
                      </span>
                    </TableCell>
                  )}
                  <TableCell>{customer.referredPartner}</TableCell>
                  <TableCell>{getStatusBadge(customer.status)}</TableCell>
                </TableRow>
              ))}
              {(!dashData?.newReferredCustomers ||
                dashData.newReferredCustomers.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={showProjectColumn ? 4 : 3}
                      className="text-center text-muted-foreground py-8"
                    >
                      No customers yet.
                    </TableCell>
                  </TableRow>
                )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
