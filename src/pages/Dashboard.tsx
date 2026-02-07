import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp, MousePointer, Users, DollarSign, Upload } from "lucide-react";
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
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
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

interface AnalyticsData {
  clicksByDay: Array<{ date: string; count: number }>;
  conversionsByDay: Array<{ date: string; count: number }>;
  revenueByDay: Array<{ date: string; revenue: number; commissions: number }>;
  topPartners: Array<{
    id: string;
    name: string;
    email: string;
    clicks: number;
    customers: number;
    revenue: number;
  }>;
  totals: {
    clicks: number;
    conversions: number;
    revenue: number;
    commissions: number;
  };
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

const clicksChartConfig = {
  count: {
    label: "Clicks",
    color: "var(--color-chart-1)",
  },
} satisfies ChartConfig;

const revenueChartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--color-chart-2)",
  },
  commissions: {
    label: "Commissions",
    color: "var(--color-chart-3)",
  },
} satisfies ChartConfig;

function Dashboard() {
  const [days, setDays] = useState("30");
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

  const { data: analyticsData, isLoading: analyticsLoading, error: analyticsError } = useQuery({
    queryKey: ["analytics", selectedProject, days],
    queryFn: async (): Promise<AnalyticsData> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      params.set("days", days);
      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) throw new Error("Failed to fetch analytics");
      return response.json();
    },
    enabled: !projectsLoading && projects.length > 0,
  });

  if (shouldRedirectToOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (projectsLoading || (dashLoading && analyticsLoading)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading dashboard...</div>
      </div>
    );
  }

  const error = dashError ?? analyticsError;
  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading dashboard: {error.message}
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
        <div className="w-48">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="bg-card">
              <span>
                {days === "7" && "Last 7 days"}
                {days === "30" && "Last 30 days"}
                {days === "90" && "Last 90 days"}
                {days === "365" && "Last year"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
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
          value={(analyticsData?.totals.clicks ?? dashData?.clicks ?? 0).toLocaleString()}
          Icon={MousePointer}
        />
        <StatCard
          title="Conversions"
          value={(analyticsData?.totals.conversions ?? 0).toLocaleString()}
          Icon={Users}
        />
        <StatCard
          title="Commissions"
          value={`$${(analyticsData?.totals.commissions ?? 0).toLocaleString()}`}
          Icon={DollarSign}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Click Analytics Chart */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Click Analytics
          </h3>
          {analyticsData?.clicksByDay && analyticsData.clicksByDay.length > 0 ? (
            <ChartContainer config={clicksChartConfig} className="h-64 w-full">
              <AreaChart data={analyticsData.clicksByDay} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  fill="var(--color-count)"
                  fillOpacity={0.15}
                  stroke="var(--color-count)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="h-64 flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl">
              <p className="text-muted-foreground text-sm">No click data yet</p>
            </div>
          )}
        </div>

        {/* Revenue Chart */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Revenue Trends
          </h3>
          {analyticsData?.revenueByDay && analyticsData.revenueByDay.length > 0 ? (
            <ChartContainer config={revenueChartConfig} className="h-64 w-full">
              <LineChart data={analyticsData.revenueByDay} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(v) => `$${v}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-revenue)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="commissions"
                  stroke="var(--color-commissions)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="h-64 flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl">
              <p className="text-muted-foreground text-sm">
                No revenue data yet
              </p>
            </div>
          )}
        </div>
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
                <TableHead>Project</TableHead>
                <TableHead>Customers</TableHead>
                <TableHead>Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashData?.topReferrers.map((referrer) => (
                <TableRow key={referrer.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{referrer.partnerName}</div>
                      <div className="text-sm text-muted-foreground">
                        {referrer.email}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {referrer.project}
                    </span>
                  </TableCell>
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
                    colSpan={4}
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
                <TableHead>Project</TableHead>
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
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {customer.project}
                    </span>
                  </TableCell>
                  <TableCell>{customer.referredPartner}</TableCell>
                  <TableCell>{getStatusBadge(customer.status)}</TableCell>
                </TableRow>
              ))}
              {(!dashData?.newReferredCustomers ||
                dashData.newReferredCustomers.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
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
