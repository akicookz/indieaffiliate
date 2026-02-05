import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";
import { MousePointer, Users, TrendingUp, DollarSign } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import StatCard from "@/components/StatCard";

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

function Analytics() {
  const [selectedProject, setSelectedProject] = useState("all");
  const [days, setDays] = useState("30");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", selectedProject, days],
    queryFn: async (): Promise<AnalyticsData> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      params.set("days", days);
      const response = await fetch(`/api/analytics?${params}`);
      if (!response.ok) throw new Error("Failed to fetch analytics");
      return response.json();
    },
  });

  const projects = projectsData?.projects ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading analytics: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Analytics</h1>
        <p className="text-muted-foreground">
          Detailed insights into your affiliate performance
        </p>
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
          title="Total Clicks"
          value={(data?.totals.clicks ?? 0).toLocaleString()}
          Icon={MousePointer}
        />
        <StatCard
          title="Conversions"
          value={(data?.totals.conversions ?? 0).toLocaleString()}
          Icon={Users}
        />
        <StatCard
          title="Revenue"
          value={`$${(data?.totals.revenue ?? 0).toLocaleString()}`}
          Icon={TrendingUp}
        />
        <StatCard
          title="Commissions"
          value={`$${(data?.totals.commissions ?? 0).toLocaleString()}`}
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
          {data?.clicksByDay && data.clicksByDay.length > 0 ? (
            <ChartContainer config={clicksChartConfig} className="h-64 w-full">
              <AreaChart data={data.clicksByDay} accessibilityLayer>
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
          {data?.revenueByDay && data.revenueByDay.length > 0 ? (
            <ChartContainer config={revenueChartConfig} className="h-64 w-full">
              <BarChart data={data.revenueByDay} accessibilityLayer>
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
                <Bar
                  dataKey="revenue"
                  fill="var(--color-revenue)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="commissions"
                  fill="var(--color-commissions)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
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

      {/* Top Performing Partners */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Top Performing Partners
        </h3>
        {data?.topPartners && data.topPartners.length > 0 ? (
          <div className="space-y-3">
            {data.topPartners.map((partner) => (
              <div
                key={partner.id}
                className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/30"
              >
                <div>
                  <p className="font-medium text-foreground">{partner.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {partner.email}
                  </p>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="font-semibold text-foreground">
                      {partner.clicks}
                    </p>
                    <p className="text-xs text-muted-foreground">clicks</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {partner.customers}
                    </p>
                    <p className="text-xs text-muted-foreground">customers</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      ${partner.revenue.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">revenue</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No partner data for this period
          </div>
        )}
      </div>
    </div>
  );
}

export default Analytics;
