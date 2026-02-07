import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, TrendingUp, Calendar, Upload, ShieldAlert, ShieldCheck, MoreHorizontal } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import StatCard from "@/components/StatCard";

const FLAG_REASONS: Record<string, string> = {
  self_referral: "Self Referral",
  bot_click: "Bot / Fake Traffic",
  suspicious_activity: "Suspicious Activity",
  policy_violation: "Policy Violation",
};

interface Customer {
  id: string;
  email: string;
  isSelfReferral: boolean;
  flagReason: string | null;
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
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const flagMutation = useMutation({
    mutationFn: async ({ customerId, reason }: { customerId: string; reason: string | null }) => {
      const response = await fetch(`/api/customers/${customerId}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("Failed to update customer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["commissions-by-partner"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["fraud-flags"] });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Referred Customers</h1>
          <p className="text-muted-foreground">
            Customers acquired through your affiliate partners
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Link>
          </Button>
        </div>
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
          All Referred Customers
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Referred By</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                   <div>
                     <div className="flex items-center gap-2">
                       <span className="font-medium">{customer.email}</span>
                       {customer.flagReason && FLAG_REASONS[customer.flagReason] && (
                         <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-300">
                           <ShieldAlert className="w-3 h-3 mr-1" />
                           {FLAG_REASONS[customer.flagReason]}
                         </span>
                       )}
                     </div>
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
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label="Customer actions"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {customer.flagReason ? (
                        <DropdownMenuItem
                          onClick={() => flagMutation.mutate({ customerId: customer.id, reason: null })}
                          disabled={flagMutation.isPending}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 mr-2 text-green-600" />
                          Remove Flag
                        </DropdownMenuItem>
                      ) : (
                        <>
                          {[
                            { label: "Self Referral", reason: "self_referral" },
                            { label: "Bot / Fake Traffic", reason: "bot_click" },
                            { label: "Suspicious Activity", reason: "suspicious_activity" },
                            { label: "Policy Violation", reason: "policy_violation" },
                          ].map((item) => (
                            <DropdownMenuItem
                              key={item.reason}
                              onClick={() => flagMutation.mutate({ customerId: customer.id, reason: item.reason })}
                              disabled={flagMutation.isPending}
                              className="text-orange-600"
                            >
                              <ShieldAlert className="w-3.5 h-3.5 mr-2" />
                              {item.label}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {(!data?.customers || data.customers.length === 0) && (
              <TableRow>
                <TableCell
                   colSpan={6}
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
