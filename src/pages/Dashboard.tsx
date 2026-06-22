import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Users,
  Clock,
  Upload,
  HandHeart,
  CheckCircle,
  AlertTriangle,
  UserPlus,
  ArrowRight,
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
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

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
    commissionRate: number;
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

interface CommissionsTotals {
  partners: unknown[];
  totals: {
    pendingAmount: number;
    approvedAmount: number;
    paidAmount: number;
  };
}

interface PartnerStats {
  totalPartners: number;
  activePartners: number;
  pendingPartners: number;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface StripeStatus {
  connected: boolean;
  syncStatus?: string;
  syncError?: string | null;
  lastSyncAt?: string | null;
}

interface CommissionProgramSummary {
  id: string;
}

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

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "hsl(var(--muted-foreground))",
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getStatusIcon(status: string) {
  switch (status) {
    case "paid":
      return <CheckCircle className="w-4 h-4 text-positive" />;
    case "trialing":
      return <Clock className="w-4 h-4 text-info" />;
    case "cancelled":
      return <AlertTriangle className="w-4 h-4 text-negative" />;
    default:
      return <UserPlus className="w-4 h-4 text-muted-foreground" />;
  }
}

function SetupChecklist({
  project,
  stripeConnected,
  programCount,
  partnerCount,
  approvedAmount,
  pendingAmount,
}: {
  project: Project | undefined;
  stripeConnected: boolean;
  programCount: number;
  partnerCount: number;
  approvedAmount: number;
  pendingAmount: number;
}) {
  if (!project) return null;

  const hasProgram = programCount > 0;
  const hasPartners = partnerCount > 0;
  const hasCommissions = approvedAmount > 0 || pendingAmount > 0;
  const steps = [
    {
      label: "Connect Stripe",
      done: stripeConnected,
      href: `/app/projects/${project.slug}/settings`,
      action: stripeConnected ? "Connected" : "Connect",
    },
    {
      label: "Define commission program",
      done: hasProgram,
      href: `/app/projects/${project.slug}/commissions`,
      action: hasProgram ? `${programCount} active` : "Create",
    },
    {
      label: "Add partners",
      done: hasPartners,
      href: "/app/partners",
      action: hasPartners ? `${partnerCount} partners` : "Invite",
    },
    {
      label: "Assign revenue",
      done: hasCommissions,
      href: `/app/payments?project=${project.id}`,
      action: hasCommissions ? "Tracked" : "Assign",
    },
    {
      label: "Review payouts",
      done: approvedAmount > 0,
      href: "/app/payouts",
      action: approvedAmount > 0
        ? `$${approvedAmount.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })} ready`
        : "Review",
    },
  ];
  const completed = steps.filter((step) => step.done).length;

  return (
    <div className="bg-card border rounded-md p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Launch checklist
          </h2>
          <p className="text-xs text-muted-foreground">
            {project.name} · {completed} of {steps.length} complete
          </p>
        </div>
        <div className="h-2 w-full sm:w-40 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-positive"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {steps.map((step) => (
          <Link
            key={step.label}
            to={step.href}
            className="rounded-md border border-border bg-background/50 px-3 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              {step.done ? (
                <CheckCircle className="w-4 h-4 text-positive shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {step.label}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {step.action}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const [days, setDays] = useState("30");
  const [selectedProject, setSelectedProject] = useState("all");
  const { data: session } = useSession();
  const userName = session?.user?.name?.split(" ")[0] ?? "there";

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
  const setupProject =
    selectedProject === "all"
      ? projects[0]
      : projects.find((p) => p.id === selectedProject);

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

  const { data: analyticsData } = useQuery({
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

  const { data: partnersData } = useQuery({
    queryKey: ["partners", selectedProject],
    queryFn: async (): Promise<{ partners: unknown[]; stats: PartnerStats }> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      const response = await fetch(`/api/partners?${params}`);
      if (!response.ok) throw new Error("Failed to fetch partners");
      return response.json();
    },
    enabled: !projectsLoading && projects.length > 0,
  });

  const { data: stripeStatus } = useQuery({
    queryKey: ["stripe-connection", setupProject?.id],
    queryFn: async (): Promise<StripeStatus> => {
      const response = await fetch(`/api/projects/${setupProject!.id}/stripe`);
      if (!response.ok) throw new Error("Failed to fetch Stripe status");
      return response.json();
    },
    enabled: !!setupProject?.id,
  });

  const { data: programsData } = useQuery({
    queryKey: ["commission-programs", setupProject?.id],
    queryFn: async (): Promise<{ programs: CommissionProgramSummary[] }> => {
      const response = await fetch(
        `/api/projects/${setupProject!.id}/commission-programs`,
      );
      if (!response.ok) throw new Error("Failed to fetch commission programs");
      return response.json();
    },
    enabled: !!setupProject?.id,
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

  const totalRevenue = dashData?.revenue.total ?? 0;
  const totalClicks = analyticsData?.totals.clicks ?? dashData?.clicks ?? 0;
  const totalConversions = analyticsData?.totals.conversions ?? dashData?.newCustomers ?? 0;
  const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : "0";
  const pendingAmount = commissionsData?.totals.pendingAmount ?? 0;
  const approvedAmount = commissionsData?.totals.approvedAmount ?? 0;
  const activePartners = partnersData?.stats.activePartners ?? 0;
  const pendingPartners = partnersData?.stats.pendingPartners ?? 0;
  const totalPartners = partnersData?.stats.totalPartners ?? 0;
  const programCount = programsData?.programs.length ?? 0;

  const topReferrers = dashData?.topReferrers ?? [];
  const pieData = topReferrers
    .filter((r) => r.totalRevenue > 0)
    .slice(0, 5)
    .map((r) => ({
      name: r.partnerName,
      value: r.totalRevenue,
    }));
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pb-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Overview &middot; {monthYear}
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            {getGreeting()}, {userName}.
          </h1>
          {totalRevenue > 0 && (
            <p className="text-muted-foreground">
              Your program has generated{" "}
              <span className="font-semibold text-foreground">
                ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{" "}
              in attributed revenue across{" "}
              <span className="font-semibold text-foreground">{activePartners}</span>{" "}
              active partner{activePartners !== 1 ? "s" : ""}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-40">
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
          {showProjectColumn && (
            <div className="w-40">
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger className="bg-card">
                  <span>
                    {selectedProject === "all"
                      ? "All Projects"
                      : projects.find((p) => p.id === selectedProject)?.name ?? "Select"}
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
          <Button variant="secondary" asChild>
            <Link to="/app/import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Link>
          </Button>
        </div>
      </div>

      <SetupChecklist
        project={setupProject}
        stripeConnected={stripeStatus?.connected ?? false}
        programCount={programCount}
        partnerCount={totalPartners}
        approvedAmount={approvedAmount}
        pendingAmount={pendingAmount}
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border rounded-md p-5 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Revenue</p>
          <p className="text-2xl font-semibold text-foreground">
            ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{dashData?.newCustomers ?? 0} customers</span>
          </div>
        </div>

        <div className="bg-card border rounded-md p-5 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Partners</p>
          <p className="text-2xl font-semibold text-foreground">{activePartners}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HandHeart className="w-3.5 h-3.5" />
            {pendingPartners > 0 ? (
              <Link to="/app/partners?status=pending" className="text-warning hover:underline">
                +{pendingPartners} pending review
              </Link>
            ) : (
              <span>all approved</span>
            )}
          </div>
        </div>

        <div className="bg-card border rounded-md p-5 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversion Rate</p>
          <p className="text-2xl font-semibold text-foreground">{conversionRate}%</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span>{totalClicks.toLocaleString()} clicks &rarr; {totalConversions.toLocaleString()} customers</span>
          </div>
        </div>

        <div className="bg-card border rounded-md p-5 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Commissions</p>
          <p className="text-2xl font-semibold text-foreground">
            ${pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <Link to="/app/payouts" className="hover:underline">
              Review in Payouts &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Revenue Chart + Partner Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="bg-card border rounded-md p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Attributed revenue</h3>
              <p className="text-xs text-muted-foreground">Revenue and commissions from affiliate-referred customers</p>
            </div>
          </div>
          {analyticsData?.revenueByDay && analyticsData.revenueByDay.length > 0 ? (
            <ChartContainer config={revenueChartConfig} className="h-72 w-full">
              <AreaChart data={analyticsData.revenueByDay} accessibilityLayer>
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
                <Area
                  type="monotone"
                  dataKey="revenue"
                  fill="var(--color-revenue)"
                  fillOpacity={0.1}
                  stroke="var(--color-revenue)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="commissions"
                  fill="var(--color-commissions)"
                  fillOpacity={0.1}
                  stroke="var(--color-commissions)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="h-72 flex items-center justify-center border-2 border-dashed border-border/30 rounded-md">
              <p className="text-muted-foreground text-sm">No revenue data yet</p>
            </div>
          )}
        </div>

        {/* Partner Revenue Breakdown */}
        <div className="bg-card border rounded-md p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Revenue by partner</h3>
          {pieData.length > 0 ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-2 mt-2">
                {pieData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-foreground truncate">{entry.name}</span>
                    </div>
                    <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                      {pieTotal > 0 ? Math.round((entry.value / pieTotal) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center border-2 border-dashed border-border/30 rounded-md">
              <p className="text-muted-foreground text-sm">No partner data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Referrers + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Partners Table */}
        <div className="bg-card border rounded-md p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">Top partners</h3>
            <Link
              to="/app/partners"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Customers</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topReferrers.map((referrer) => {
                const commEst = referrer.totalRevenue * (referrer.commissionRate ?? 0.2);
                return (
                  <TableRow key={referrer.id}>
                    <TableCell>
                      <div>
                        <Link
                          to={`/app/customers?partner=${referrer.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {referrer.partnerName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {referrer.email}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {referrer.referredCustomers}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      ${referrer.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      ${commEst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                );
              })}
              {topReferrers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No partners yet. Invite your first partner to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Activity Feed */}
        <div className="bg-card border rounded-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">Recent activity</h3>
            <Link
              to="/app/customers"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="space-y-4">
            {dashData?.newReferredCustomers.map((customer) => (
              <div key={customer.id} className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {getStatusIcon(customer.status)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground leading-snug">
                    <span className="font-medium">{customer.referredPartner}</span>
                    {" "}referred{" "}
                    <span className="font-medium">{customer.email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(customer.createdDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                    {" "}&middot;{" "}
                    <span className="capitalize">{customer.status}</span>
                  </p>
                </div>
              </div>
            ))}
            {(!dashData?.newReferredCustomers || dashData.newReferredCustomers.length === 0) && (
              <div className="text-center text-muted-foreground text-sm py-6">
                No activity yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
