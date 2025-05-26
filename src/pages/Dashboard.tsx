import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, MousePointer, Users, UserPlus } from "lucide-react";
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
import StatCard from "@/components/StatCard";

interface DashboardData {
  name: string;
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

function Dashboard() {
  const [period, setPeriod] = useState("7d");
  const [selectedProject, setSelectedProject] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", period, selectedProject],
    queryFn: async (): Promise<DashboardData> => {
      // This would typically call your API with the period and project parameters
      const response = await fetch(
        `/api/?period=${period}&project=${selectedProject}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard data");
      }
      const result = (await response.json()) as { name: string };

      // Mock data for now
      return {
        name: result.name || "Affiliate Marketer",
        revenue: {
          total: 15487.32,
          change: 12.5,
          isPositive: true,
        },
        clicks: 8534,
        leads: 342,
        newCustomers: 87,
        topReferrers: [
          {
            id: "1",
            partnerName: "Sarah Johnson",
            email: "sarah@example.com",
            referredCustomers: 23,
            totalRevenue: 4587.5,
            project: "LinkyCal.com",
          },
          {
            id: "2",
            partnerName: "Mike Chen",
            email: "mike@example.com",
            referredCustomers: 18,
            totalRevenue: 3421.75,
            project: "ImageAnimateAI.com",
          },
          {
            id: "3",
            partnerName: "Emma Davis",
            email: "emma@example.com",
            referredCustomers: 15,
            totalRevenue: 2934.8,
            project: "LinkyCal.com",
          },
          {
            id: "4",
            partnerName: "Alex Rodriguez",
            email: "alex@example.com",
            referredCustomers: 12,
            totalRevenue: 2156.9,
            project: "LinkyCal.com",
          },
        ],
        newReferredCustomers: [
          {
            id: "1",
            createdDate: "2024-01-15",
            email: "customer1@example.com",
            referredPartner: "Sarah Johnson",
            status: "paid",
            project: "LinkyCal.com",
          },
          {
            id: "2",
            createdDate: "2024-01-14",
            email: "customer2@example.com",
            referredPartner: "Mike Chen",
            status: "trialing",
            project: "ImageAnimateAI.com",
          },
          {
            id: "3",
            createdDate: "2024-01-14",
            email: "customer3@example.com",
            referredPartner: "Emma Davis",
            status: "paid",
            project: "LinkyCal.com",
          },
          {
            id: "4",
            createdDate: "2024-01-13",
            email: "customer4@example.com",
            referredPartner: "Alex Rodriguez",
            status: "cancelled",
            project: "ImageAnimateAI.com",
          },
          {
            id: "5",
            createdDate: "2024-01-13",
            email: "customer5@example.com",
            referredPartner: "Sarah Johnson",
            status: "trialing",
            project: "LinkyCal.com",
          },
        ],
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading dashboard...</div>
      </div>
    );
  }

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
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${
          styles[status as keyof typeof styles]
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
        <div className="w-48">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="bg-card">
              <span>
                {selectedProject === "all" && "All Projects"}
                {selectedProject === "linkycal" && "LinkyCal.com"}
                {selectedProject === "imageanimateai" && "ImageAnimateAI.com"}
                {selectedProject === "launchfast" && "LaunchFast.shop"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="linkycal">LinkyCal.com</SelectItem>
              <SelectItem value="imageanimateai">ImageAnimateAI.com</SelectItem>
              <SelectItem value="launchfast">LaunchFast.shop</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="bg-card">
              <span>
                {period === "7d" && "Last 7 days"}
                {period === "30d" && "Last 30 days"}
                {period === "90d" && "Last 90 days"}
                {period === "1y" && "Last year"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Revenue"
          value={`$${data?.revenue.total.toLocaleString()}`}
          Icon={TrendingUp}
          isPositive={data?.revenue.isPositive}
          change={data?.revenue.change}
        />

        <StatCard
          title="Clicks"
          value={data?.clicks.toLocaleString() || "0"}
          Icon={MousePointer}
        />

        <StatCard
          title="Leads"
          value={data?.leads.toLocaleString() || "0"}
          Icon={Users}
        />

        <StatCard
          title="New Customers"
          value={data?.newCustomers.toLocaleString() || "0"}
          Icon={UserPlus}
        />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Referrers Table */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            Top referrers
          </h3>
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
              {data?.topReferrers.map((referrer) => (
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
            </TableBody>
          </Table>
        </div>

        {/* New Referred Customers Table */}
        <div className="shadow-xs bg-card/50 rounded-2xl p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">
            New referred customers
          </h3>
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
              {data?.newReferredCustomers.map((customer) => (
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
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
