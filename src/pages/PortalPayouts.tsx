import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
}

function PortalPayouts() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-payouts-full"],
    queryFn: async (): Promise<{ payouts: Payout[] }> => {
      const response = await fetch("/api/partner/payouts", {
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json() as { error: string };
        throw new Error(err.error || "Failed to load payouts");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading payouts…</p>
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
      scheduled: "bg-warning/15 text-warning",
      paid: "bg-positive/15 text-positive",
      failed: "bg-destructive/15 text-destructive",
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

  const payoutsList = data?.payouts ?? [];

  // Summary
  const totals = payoutsList.reduce(
    (acc, p) => {
      if (p.status === "paid") acc.paid += p.amount;
      if (p.status === "scheduled") acc.scheduled += p.amount;
      return acc;
    },
    { paid: 0, scheduled: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Payouts</h1>
        <p className="text-muted-foreground">
          Your payout history and upcoming payments
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Total Paid</p>
          <p className="text-2xl font-medium mt-1 text-positive">
            ${totals.paid.toFixed(2)}
          </p>
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm text-muted-foreground">Upcoming</p>
          <p className="text-2xl font-medium mt-1 text-warning">
            ${totals.scheduled.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Payouts Table */}
      <div className="bg-card border border-border rounded-md p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Paid Date</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payoutsList.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell className="font-medium">
                  ${payout.amount.toFixed(2)} {payout.currency}
                </TableCell>
                <TableCell>{getStatusBadge(payout.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {payout.periodStart && payout.periodEnd
                    ? `${new Date(payout.periodStart).toLocaleDateString()} - ${new Date(payout.periodEnd).toLocaleDateString()}`
                    : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {payout.paidAt
                    ? new Date(payout.paidAt).toLocaleDateString()
                    : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {payout.note ?? "-"}
                </TableCell>
              </TableRow>
            ))}
            {payoutsList.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No payouts yet. Payouts will appear here once they are scheduled by the project owner.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default PortalPayouts;
