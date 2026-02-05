import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
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
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard";

interface Commission {
  id: string;
  partnerId: string;
  customerId: string;
  projectId: string;
  amount: number;
  rate: number;
  status: "pending" | "approved" | "paid" | "rejected";
  partnerName: string;
  partnerEmail: string;
  customerEmail: string;
  projectName: string;
  createdAt: string;
}

interface CommissionStats {
  totalCommissions: number;
  pendingAmount: number;
  approvedAmount: number;
  paidAmount: number;
}

interface CommissionsResponse {
  commissions: Commission[];
  stats: CommissionStats;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

function Payouts() {
  const queryClient = useQueryClient();
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
    queryKey: ["commissions", selectedProject, statusFilter],
    queryFn: async (): Promise<CommissionsResponse> => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/commissions?${params}`);
      if (!response.ok) throw new Error("Failed to fetch commissions");
      return response.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected" | "paid";
    }) => {
      const response = await fetch(`/api/commissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update commission");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });

  const projects = projectsData?.projects ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading commissions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-destructive">
          Error loading commissions: {error.message}
        </div>
      </div>
    );
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border ${
          styles[status] ?? ""
        }`}
      >
        {status}
      </span>
    );
  }

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Payouts & Commissions
        </h1>
        <p className="text-muted-foreground">
          Review, approve, and manage affiliate commissions
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
                {statusFilter === "pending" && "Pending"}
                {statusFilter === "approved" && "Approved"}
                {statusFilter === "paid" && "Paid"}
                {statusFilter === "rejected" && "Rejected"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard
          title="Total Commissions"
          value={(data?.stats.totalCommissions ?? 0).toLocaleString()}
          Icon={DollarSign}
        />
        <StatCard
          title="Pending"
          value={`$${(data?.stats.pendingAmount ?? 0).toFixed(2)}`}
          Icon={Clock}
        />
        <StatCard
          title="Approved"
          value={`$${(data?.stats.approvedAmount ?? 0).toFixed(2)}`}
          Icon={CheckCircle}
        />
        <StatCard
          title="Paid"
          value={`$${(data?.stats.paidAmount ?? 0).toFixed(2)}`}
          Icon={CheckCircle}
        />
      </div>

      {/* Commissions Table */}
      <div className="shadow-xs bg-card/50 rounded-2xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          All Commissions
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partner</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.commissions.map((commission) => (
              <TableRow key={commission.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{commission.partnerName}</div>
                    <div className="text-sm text-muted-foreground">
                      {commission.partnerEmail}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {commission.customerEmail}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {commission.projectName}
                </TableCell>
                <TableCell className="font-medium">
                  ${commission.amount.toFixed(2)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {Math.round(commission.rate * 100)}%
                </TableCell>
                <TableCell>{getStatusBadge(commission.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(commission.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {commission.status === "pending" && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            id: commission.id,
                            status: "approved",
                          })
                        }
                        disabled={updateStatusMutation.isPending}
                        aria-label="Approve commission"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            id: commission.id,
                            status: "rejected",
                          })
                        }
                        disabled={updateStatusMutation.isPending}
                        aria-label="Reject commission"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                  {commission.status === "approved" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      onClick={() =>
                        updateStatusMutation.mutate({
                          id: commission.id,
                          status: "paid",
                        })
                      }
                      disabled={updateStatusMutation.isPending}
                    >
                      Mark Paid
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(!data?.commissions || data.commissions.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  No commissions yet. Commissions are created automatically when
                  conversions are tracked.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default Payouts;
