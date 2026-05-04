import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Commission {
  id: string;
  amount: number;
  rate: number;
  status: string;
  maskedCustomerEmail: string;
  createdAt: string;
}

function PortalCommissions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-commissions"],
    queryFn: async (): Promise<{ commissions: Commission[] }> => {
      const response = await fetch("/api/partner/commissions", {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load commissions");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading commissions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 rounded-md border border-border bg-card p-8">
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    );
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      pending: "bg-warning/15 text-warning",
      approved: "bg-info/15 text-info",
      paid: "bg-positive/15 text-positive",
      rejected: "bg-destructive/15 text-destructive",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border capitalize ${
          styles[status] ?? "bg-muted text-muted-foreground"
        }`}
      >
        {status}
      </span>
    );
  }

  const commissions = data?.commissions ?? [];

  // Calculate totals
  const totals = commissions.reduce(
    (acc, c) => {
      acc.total += c.amount;
      if (c.status === "pending") acc.pending += c.amount;
      if (c.status === "approved") acc.approved += c.amount;
      if (c.status === "paid") acc.paid += c.amount;
      return acc;
    },
    { total: 0, pending: 0, approved: 0, paid: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Commissions</h1>
        <p className="text-muted-foreground">
          Track your earned commissions from referred customers
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-medium mt-1 text-foreground">${totals.total.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-2xl font-medium mt-1 text-warning">${totals.pending.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Approved</p>
          <p className="text-2xl font-medium mt-1 text-info">${totals.approved.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="text-2xl font-medium mt-1 text-positive">${totals.paid.toFixed(2)}</p>
        </div>
      </div>

      {/* Commission Table */}
      <div className="bg-card border border-border rounded-md p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commissions.map((commission) => (
              <TableRow key={commission.id}>
                <TableCell className="text-sm">
                  {commission.maskedCustomerEmail}
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
              </TableRow>
            ))}
            {commissions.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No commissions yet. Commissions are earned when your referrals make purchases.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PortalCommissions;
