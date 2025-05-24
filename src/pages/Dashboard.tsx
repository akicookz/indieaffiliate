import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  MousePointer,
  Users,
  UserPlus,
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
  }>;
  newReferredCustomers: Array<{
    id: string;
    createdDate: string;
    email: string;
    referredPartner: string;
    status: "pending" | "approved" | "rejected";
  }>;
}

function Dashboard() {
  const [period, setPeriod] = useState("7d");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: async (): Promise<DashboardData> => {
      // This would typically call your API with the period parameter
      const response = await fetch(`/api/?period=${period}`);
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
          },
          {
            id: "2",
            partnerName: "Mike Chen",
            email: "mike@example.com",
            referredCustomers: 18,
            totalRevenue: 3421.75,
          },
          {
            id: "3",
            partnerName: "Emma Davis",
            email: "emma@example.com",
            referredCustomers: 15,
            totalRevenue: 2934.8,
          },
          {
            id: "4",
            partnerName: "Alex Rodriguez",
            email: "alex@example.com",
            referredCustomers: 12,
            totalRevenue: 2156.9,
          },
        ],
        newReferredCustomers: [
          {
            id: "1",
            createdDate: "2024-01-15",
            email: "customer1@example.com",
            referredPartner: "Sarah Johnson",
            status: "approved",
          },
          {
            id: "2",
            createdDate: "2024-01-14",
            email: "customer2@example.com",
            referredPartner: "Mike Chen",
            status: "pending",
          },
          {
            id: "3",
            createdDate: "2024-01-14",
            email: "customer3@example.com",
            referredPartner: "Emma Davis",
            status: "approved",
          },
          {
            id: "4",
            createdDate: "2024-01-13",
            email: "customer4@example.com",
            referredPartner: "Alex Rodriguez",
            status: "rejected",
          },
          {
            id: "5",
            createdDate: "2024-01-13",
            email: "customer5@example.com",
            referredPartner: "Sarah Johnson",
            status: "pending",
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
      approved: "bg-green-100 text-green-800 border-green-200",
      pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
      rejected: "bg-red-100 text-red-800 border-red-200",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
          styles[status as keyof typeof styles]
        }`}
      >
        {status}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Period Selector */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Welcome back, {data?.name}!
          </h1>
          <p className="text-foreground/70">
            Here's your affiliate marketing overview
          </p>
        </div>
        <div className="w-48">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger>
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

      {/* Revenue Card */}
      <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-muted-foreground mb-1">
              Total Revenue
            </h3>
            <p className="text-4xl font-bold text-foreground">
              ${data?.revenue.total.toLocaleString()}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {data?.revenue.isPositive ? (
              <TrendingUp className="h-6 w-6 text-green-600" />
            ) : (
              <TrendingDown className="h-6 w-6 text-red-600" />
            )}
            <span
              className={`text-lg font-semibold ${
                data?.revenue.isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {data?.revenue.isPositive ? "+" : ""}
              {data?.revenue.change}%
            </span>
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <MousePointer className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                Clicks
              </h3>
              <p className="text-2xl font-bold text-foreground">
                {data?.clicks.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                Leads
              </h3>
              <p className="text-2xl font-bold text-foreground">
                {data?.leads.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <UserPlus className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                New Customers
              </h3>
              <p className="text-2xl font-bold text-foreground">
                {data?.newCustomers.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Referrers Table */}
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Top Referrers
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
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
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            New Referred Customers
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
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
