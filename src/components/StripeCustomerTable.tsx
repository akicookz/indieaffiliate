import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ChevronsUpDown,
  UserPlus,
  Loader2,
  Check,
  X,
  Users,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StripeCustomerRow {
  stripeCustomerId: string;
  name: string | null;
  email: string | null;
  subscriptionStatus: string | null;
  latestPaymentAmount: number | null;
  latestPaymentDate: number | null;
  metadata: Record<string, string>;
}

interface StripeCustomerListResult {
  customers: StripeCustomerRow[];
  hasMore: boolean;
  nextCursor?: string;
}

interface PartnerForAssign {
  id: string;
  name: string;
  email: string;
  referralCode: string;
}

interface AssignResult {
  customersProcessed: number;
  commissionsCreated: number;
  duplicatesSkipped: number;
}

interface StripeCustomerTableProps {
  projectId: string;
  partners: PartnerForAssign[];
  onPartnerCreated?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

function StripeCustomerTable({
  projectId,
  partners,
  onPartnerCreated,
}: StripeCustomerTableProps) {
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<"recent" | "active_subscribers">("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allCustomers, setAllCustomers] = useState<StripeCustomerRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  // Assign partner popover
  const [assignOpen, setAssignOpen] = useState(false);

  // Create partner dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerEmail, setNewPartnerEmail] = useState("");
  const [newPartnerCommission, setNewPartnerCommission] = useState("20");

  // Success toast
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Debounce search input
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Reset accumulated customers when query/filter changes
  useEffect(() => {
    setAllCustomers([]);
    setNextCursor(undefined);
    setHasMore(false);
    setSelectedIds(new Set());
  }, [debouncedQuery, filter]);

  const queryKey = ["stripe-customers", projectId, debouncedQuery, filter];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async (): Promise<StripeCustomerListResult> => {
      const params = new URLSearchParams({
        filter,
        limit: "20",
      });
      if (debouncedQuery) params.set("query", debouncedQuery);

      const response = await fetch(
        `/api/projects/${projectId}/stripe/customers?${params}`,
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error((body as { error?: string }).error ?? "Failed to fetch customers");
      }
      return response.json();
    },
    enabled: !!projectId,
  });

  // Sync query data into accumulated state
  useEffect(() => {
    if (data) {
      setAllCustomers(data.customers);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    }
  }, [data]);

  // Load more mutation
  const loadMoreMutation = useMutation({
    mutationFn: async (): Promise<StripeCustomerListResult> => {
      const params = new URLSearchParams({
        filter,
        limit: "20",
      });
      if (debouncedQuery) params.set("query", debouncedQuery);
      if (nextCursor) params.set("starting_after", nextCursor);

      const response = await fetch(
        `/api/projects/${projectId}/stripe/customers?${params}`,
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error((err as { error?: string }).error ?? "Failed to load more");
      }
      return response.json();
    },
    onSuccess: (result) => {
      setAllCustomers((prev) => [...prev, ...result.customers]);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    },
  });

  // Assign partner mutation
  const assignMutation = useMutation({
    mutationFn: async (partnerId: string): Promise<AssignResult> => {
      const response = await fetch(
        `/api/projects/${projectId}/stripe/assign-partner`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId,
            stripeCustomerIds: [...selectedIds],
          }),
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to assign partner");
      }
      return response.json();
    },
    onSuccess: (result) => {
      setSelectedIds(new Set());
      setAssignOpen(false);
      setSuccessMessage(
        `Synced ${result.customersProcessed} customer${result.customersProcessed !== 1 ? "s" : ""}: ${result.commissionsCreated} commission${result.commissionsCreated !== 1 ? "s" : ""} created, ${result.duplicatesSkipped} duplicate${result.duplicatesSkipped !== 1 ? "s" : ""} skipped`,
      );
      setTimeout(() => setSuccessMessage(null), 5000);
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });

  // Create partner mutation
  const createPartnerMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      email: string;
      commissionRate: number;
    }) => {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: data.name,
          email: data.email,
          commissionRate: data.commissionRate,
          sendInvite: false,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          (body as { error?: string }).error ?? "Failed to create partner",
        );
      }
      return response.json() as Promise<{ partner: PartnerForAssign }>;
    },
    onSuccess: (result) => {
      setCreateDialogOpen(false);
      setNewPartnerName("");
      setNewPartnerEmail("");
      setNewPartnerCommission("20");
      onPartnerCreated?.();
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partners-for-assign"] });

      // Auto-assign the newly created partner if customers are selected
      if (selectedIds.size > 0) {
        assignMutation.mutate(result.partner.id);
      }
    },
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === allCustomers.length && allCustomers.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allCustomers.map((c) => c.stripeCustomerId)));
    }
  }, [selectedIds.size, allCustomers]);

  function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    if (!newPartnerName.trim() || !newPartnerEmail.trim()) return;
    createPartnerMutation.mutate({
      name: newPartnerName.trim(),
      email: newPartnerEmail.trim().toLowerCase(),
      commissionRate: parseFloat(newPartnerCommission) / 100,
    });
  }

  function formatAmount(cents: number | null) {
    if (cents === null) return "-";
    return `$${(cents / 100).toFixed(2)}`;
  }

  function formatDate(timestamp: number | null) {
    if (!timestamp) return "-";
    return new Date(timestamp * 1000).toLocaleDateString();
  }

  const allSelected = allCustomers.length > 0 && selectedIds.size === allCustomers.length;

  return (
    <div className="space-y-4">
      {/* Search + Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or metadata (e.g. ref=CODE)..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setFilter("recent")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "recent"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="w-3 h-3" />
            Recent
          </button>
          <button
            onClick={() => setFilter("active_subscribers")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "active_subscribers"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3 h-3" />
            Active Subscribers
          </button>
        </div>
      </div>

      {/* Assign Partner action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-muted/50 border border-border rounded-xl px-4 py-2.5">
          <span className="text-sm text-foreground">
            {selectedIds.size} customer{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <Popover open={assignOpen} onOpenChange={setAssignOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                disabled={assignMutation.isPending}
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5 mr-1.5" />
                    Assign Partner
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search partners..." />
                <CommandList>
                  <CommandEmpty>No partners found.</CommandEmpty>
                  <CommandGroup heading="Partners">
                    {partners.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`${p.name} ${p.email}`}
                        onSelect={() => {
                          assignMutation.mutate(p.id);
                        }}
                      >
                        <div className="truncate">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-muted-foreground ml-1 text-xs">{p.email}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setAssignOpen(false);
                        setCreateDialogOpen(true);
                        setNewPartnerName("");
                        setNewPartnerEmail("");
                        setNewPartnerCommission("20");
                        createPartnerMutation.reset();
                      }}
                    >
                      <UserPlus className="w-3 h-3 mr-2" />
                      Create new partner
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Latest Payment</TableHead>
            <TableHead>Metadata</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && allCustomers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Loading customers from Stripe...</p>
              </TableCell>
            </TableRow>
          ) : allCustomers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                {debouncedQuery
                  ? "No customers found matching your search."
                  : "No recent customers found."}
              </TableCell>
            </TableRow>
          ) : (
            allCustomers.map((customer) => (
              <TableRow
                key={customer.stripeCustomerId}
                data-state={selectedIds.has(customer.stripeCustomerId) ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(customer.stripeCustomerId)}
                    onCheckedChange={() => toggleSelect(customer.stripeCustomerId)}
                    aria-label={`Select ${customer.name ?? customer.email ?? customer.stripeCustomerId}`}
                  />
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium text-foreground">
                      {customer.name ?? "No name"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {customer.email ?? customer.stripeCustomerId}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {customer.subscriptionStatus ? (
                    <Badge
                      variant={
                        ["active", "succeeded"].includes(customer.subscriptionStatus)
                          ? "default"
                          : ["failed", "canceled", "past_due", "unpaid"].includes(customer.subscriptionStatus)
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {customer.subscriptionStatus}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div>
                    <p className="font-medium tabular-nums">
                      {formatAmount(customer.latestPaymentAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(customer.latestPaymentDate)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {Object.keys(customer.metadata).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(customer.metadata)
                        .slice(0, 3)
                        .map(([key, value]) => (
                          <span
                            key={key}
                            className="inline-flex items-center text-xs bg-muted px-1.5 py-0.5 rounded font-mono"
                          >
                            {key}={value}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Load More */}
      {hasMore && !debouncedQuery && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMoreMutation.mutate()}
            disabled={loadMoreMutation.isPending}
          >
            {loadMoreMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Loading...
              </>
            ) : (
              "Load More"
            )}
          </Button>
        </div>
      )}

      {/* Loading overlay for refetch */}
      {isFetching && allCustomers.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Refreshing...
        </div>
      )}

      {/* Assign error */}
      {assignMutation.error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-center gap-2">
          <span className="text-sm text-destructive">{assignMutation.error.message}</span>
        </div>
      )}

      {/* Success toast */}
      {successMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            {successMessage}
          </span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-green-600 hover:text-green-800 dark:hover:text-green-300 ml-2"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Create Partner Dialog */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setNewPartnerName("");
            setNewPartnerEmail("");
            setNewPartnerCommission("20");
            createPartnerMutation.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Partner</DialogTitle>
            <DialogDescription>
              Create a partner and assign the selected customer{selectedIds.size !== 1 ? "s" : ""} to them.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreatePartner} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sct-name">Name</Label>
              <Input
                id="sct-name"
                value={newPartnerName}
                onChange={(e) => setNewPartnerName(e.target.value)}
                placeholder="Partner name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sct-email">Email</Label>
              <Input
                id="sct-email"
                type="email"
                value={newPartnerEmail}
                onChange={(e) => setNewPartnerEmail(e.target.value)}
                placeholder="partner@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sct-commission">Commission Rate (%)</Label>
              <Input
                id="sct-commission"
                type="number"
                min="1"
                max="100"
                step="1"
                value={newPartnerCommission}
                onChange={(e) => setNewPartnerCommission(e.target.value)}
              />
            </div>

            {createPartnerMutation.error && (
              <p className="text-sm text-destructive">
                {createPartnerMutation.error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createPartnerMutation.isPending}
              >
                {createPartnerMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Create & Assign
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default StripeCustomerTable;
