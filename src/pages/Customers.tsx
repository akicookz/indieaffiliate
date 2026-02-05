import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, TrendingUp, Calendar } from "lucide-react";
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

interface Customer {
  id: string;
  email: string;
  status: "trialing" | "paid" | "cancelled";
  revenue: number;
  projectName: string;
  partnerName: string;
  createdAt: string;
}

interface CustomerStats {
  totalCustomers: number;
  paidCustomers: number;
  trialingCustomers: number;
  cancelledCustomers: number;
}

interface CustomersResponse {
  customers: Customer[];
  stats: CustomerStats;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

function Customers() {
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
    queryKey: ["customers", selectedProject, statusFilter],
    queryFn: async (): Promise<CustomersResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/customers?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch customers data");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading customers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading customers: {error.message}
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

  const totalRevenue = data?.customers.reduce((sum, c) => sum + c.revenue, 0) ?? 0;
  const projects = projectsData?.projects ?? [];

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Customers</h1>
        <p className="text-muted-foreground">
          Manage and view all your referred customers
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-card">
              <span>
                {statusFilter === "all" && "All Statuses"}
                {statusFilter === "paid" && "Paid"}
                {statusFilter === "trialing" && "Trialing"}
                {statusFilter === "cancelled" && "Cancelled"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="trialing">Trialing</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Customers"
          value={(data?.stats.totalCustomers ?? 0).toLocaleString()}
          Icon={Users}
        />

        <StatCard
          title="Paid"
          value={(data?.stats.paidCustomers ?? 0).toLocaleString()}
          Icon={UserPlus}
        />

        <StatCard
          title="Trialing"
          value={(data?.stats.trialingCustomers ?? 0).toLocaleString()}
          Icon={Calendar}
        />

        <StatCard
          title="Total Revenue"
          value={`$${totalRevenue.toLocaleString()}`}
          Icon={TrendingUp}
        />
      </div>

      {/* Customers Table */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          All Customers
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Referred By</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{customer.email}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(customer.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {customer.projectName}
                  </span>
                </TableCell>
                <TableCell>{customer.partnerName}</TableCell>
                <TableCell>{getStatusBadge(customer.status)}</TableCell>
                <TableCell className="font-medium">
                  ${customer.revenue.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
            {(!data?.customers || data.customers.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={5}
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
  );
}

export default Customers;
