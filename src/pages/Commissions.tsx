import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Code2, MoreHorizontal, Loader2, CalendarClock } from "lucide-react";
import { describeSchedule } from "@/lib/payout-schedule";

import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RuleType = "recurring" | "lifetime" | "one-time";
type PayoutCadence = "monthly_day" | "monthly_ordinal" | "weekly";

interface Commission {
  id: string;
  code: string;
  name: string;
  type: RuleType;
  rate: number; // %
  durationMonths?: number; // for recurring
  flatAmount?: number; // for one-time
  description: string;
  minPayout: number;
  partners: number;
  gtvMonth: number;
  payoutCadence?: PayoutCadence | null;
  payoutDayOfMonth?: number | null;
  payoutDayOfWeek?: number | null;
  payoutOrdinal?: number | null;
}

interface Coupon {
  id: string;
  code: string;
  partnerName: string;
  partnerEmail: string;
  partnerInitials: string;
  partnerColor: string;
  customerDiscount: string;
  stripeCoupon: string;
  redemptions: number;
  mrrAttributed: number;
  status: "live" | "paused";
}



function typeColor(type: RuleType): string {
  switch (type) {
    case "recurring":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
    case "lifetime":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "one-time":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  }
}

function typeDot(type: RuleType): string {
  switch (type) {
    case "recurring":
      return "bg-orange-500";
    case "lifetime":
      return "bg-emerald-500";
    case "one-time":
      return "bg-blue-500";
  }
}

function formatProgramAmount(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function formatProgramSummary(program: Commission): string {
  const isFlatOneTime =
    program.type === "one-time" &&
    program.flatAmount != null &&
    program.flatAmount > 0;
  return isFlatOneTime
    ? `Flat ${formatProgramAmount(program.flatAmount!)}`
    : `${program.rate}%`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface ApiProgram {
  id: string;
  code: string;
  name: string;
  type: RuleType;
  rate: number;
  durationMonths: number | null;
  flatAmount: number | null;
  description: string | null;
  minPayout: number;
  partners: number;
  gtvMonth: number;
  payoutCadence: PayoutCadence | null;
  payoutDayOfMonth: number | null;
  payoutDayOfWeek: number | null;
  payoutOrdinal: number | null;
}

interface ApiCoupon {
  id: string;
  code: string;
  customerDiscount: string | null;
  stripeCoupon: string | null;
  redemptions: number;
  mrrAttributed: number;
  status: "live" | "paused" | "archived";
  partnerName: string;
  partnerEmail: string;
}

interface PartnerForCoupon {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive" | "pending";
  commissionProgramId: string | null;
  referralCode: string;
}

interface PartnersForCouponResponse {
  partners: PartnerForCoupon[];
}

interface BrandingResponse {
  branding: {
    defaultCommissionProgramId: string | null;
  } | null;
}

interface CommissionProgramPayload {
  code: string;
  name: string;
  type: RuleType;
  rate: number;
  durationMonths: number | null;
  flatAmount: number | null;
  description: string;
  minPayout: number;
  payoutCadence: PayoutCadence | null;
  payoutDayOfMonth: number | null;
  payoutDayOfWeek: number | null;
  payoutOrdinal: number | null;
}

interface UpdateCommissionProgramInput {
  programId: string;
  input: CommissionProgramPayload;
}

type CommissionDialogState =
  | { mode: "create" }
  | { mode: "edit"; commission: Commission }
  | { mode: "duplicate"; commission: Commission };

interface CouponPayload {
  code: string;
  partnerId: string;
  commissionProgramId: string | null;
  customerDiscount: string | null;
  stripeCoupon: string | null;
}

const COUPON_AVATAR_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-fuchsia-500",
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COUPON_AVATAR_COLORS[Math.abs(hash) % COUPON_AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function Commissions() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<CommissionDialogState | null>(null);
  const [couponDialogOpen, setCouponDialogOpen] = useState(false);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);
  const projectId = project?.id;

  const { data: programsData, isLoading: programsLoading } = useQuery({
    queryKey: ["commission-programs", projectId],
    queryFn: async (): Promise<{ programs: ApiProgram[] }> => {
      const res = await fetch(
        `/api/projects/${projectId}/commission-programs`
      );
      if (!res.ok) throw new Error("Failed to fetch programs");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: couponsData } = useQuery({
    queryKey: ["coupons", projectId],
    queryFn: async (): Promise<{ coupons: ApiCoupon[] }> => {
      const res = await fetch(`/api/projects/${projectId}/coupons`);
      if (!res.ok) throw new Error("Failed to fetch coupons");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: couponPartnersData, isLoading: couponPartnersLoading } = useQuery({
    queryKey: ["partners", "coupon-select", projectId],
    queryFn: async (): Promise<PartnersForCouponResponse> => {
      const params = new URLSearchParams();
      params.set("project", projectId ?? "");
      params.set("status", "active");
      const res = await fetch(`/api/partners?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch partners");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: brandingData } = useQuery({
    queryKey: ["branding", projectId],
    queryFn: async (): Promise<BrandingResponse> => {
      const res = await fetch(`/api/projects/${projectId}/branding`);
      if (!res.ok) throw new Error("Failed to fetch branding");
      return res.json();
    },
    enabled: !!projectId,
  });

  const createProgramMutation = useMutation({
    mutationFn: async (input: CommissionProgramPayload) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(
        `/api/projects/${projectId}/commission-programs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["commission-programs", projectId],
      });
      setDialog(null);
    },
  });

  const createCouponMutation = useMutation({
    mutationFn: async (input: CouponPayload) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(`/api/projects/${projectId}/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to create coupon");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", projectId] });
      setCouponDialogOpen(false);
    },
  });

  const deleteCouponMutation = useMutation({
    mutationFn: async (couponId: string) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(
        `/api/projects/${projectId}/coupons/${couponId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to delete coupon");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", projectId] });
    },
    onError: (error) => {
      window.alert(
        error instanceof Error ? error.message : "Failed to delete coupon"
      );
    },
  });

  const updateProgramMutation = useMutation({
    mutationFn: async ({ programId, input }: UpdateCommissionProgramInput) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(
        `/api/projects/${projectId}/commission-programs/${programId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["commission-programs", projectId],
      });
      setDialog(null);
    },
  });

  const archiveProgramMutation = useMutation({
    mutationFn: async (programId: string) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(
        `/api/projects/${projectId}/commission-programs/${programId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to archive");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["commission-programs", projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["branding", projectId] });
    },
    onError: (error) => {
      window.alert(
        error instanceof Error ? error.message : "Failed to archive program"
      );
    },
  });

  const setDefaultProgramMutation = useMutation({
    mutationFn: async (programId: string) => {
      if (!projectId) throw new Error("Project is still loading");
      const res = await fetch(`/api/projects/${projectId}/branding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCommissionProgramId: programId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to set default program");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["commission-programs", projectId],
      });
    },
    onError: (error) => {
      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to set default program",
      );
    },
  });

  const apiPrograms = programsData?.programs ?? [];
  const programs: Commission[] = apiPrograms.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    rate: p.rate,
    durationMonths: p.durationMonths ?? undefined,
    flatAmount: p.flatAmount ?? undefined,
    description: p.description ?? "",
    minPayout: p.minPayout,
    partners: p.partners,
    gtvMonth: p.gtvMonth,
    payoutCadence: p.payoutCadence,
    payoutDayOfMonth: p.payoutDayOfMonth,
    payoutDayOfWeek: p.payoutDayOfWeek,
    payoutOrdinal: p.payoutOrdinal,
  }));

  const apiCoupons = couponsData?.coupons ?? [];
  const couponRows: Coupon[] = apiCoupons.map((c) => ({
    id: c.id,
    code: c.code,
    partnerName: c.partnerName,
    partnerEmail: c.partnerEmail,
    partnerInitials: getInitials(c.partnerName),
    partnerColor: hashColor(c.partnerName),
    customerDiscount: c.customerDiscount ?? "",
    stripeCoupon: c.stripeCoupon ?? "",
    redemptions: c.redemptions,
    mrrAttributed: c.mrrAttributed,
    status: c.status === "archived" ? "paused" : c.status,
  }));
  const couponPartners = couponPartnersData?.partners ?? [];
  const defaultProgramId =
    brandingData?.branding?.defaultCommissionProgramId ?? null;

  function openCommissionDialog(nextDialog: CommissionDialogState) {
    createProgramMutation.reset();
    updateProgramMutation.reset();
    setDialog(nextDialog);
  }

  function handleSubmitCommission(input: CommissionProgramPayload) {
    if (dialog?.mode === "edit") {
      updateProgramMutation.mutate({
        programId: dialog.commission.id,
        input,
      });
      return;
    }
    createProgramMutation.mutate(input);
  }

  function handleArchiveCommission(commission: Commission) {
    const defaultCopy =
      commission.id === defaultProgramId
        ? " This program is currently the join-page default and will be cleared."
        : "";
    const confirmed = window.confirm(
      `Archive ${commission.name}? Existing partner assignments and historical commissions stay intact.${defaultCopy}`
    );
    if (!confirmed) return;
    archiveProgramMutation.mutate(commission.id);
  }

  function handleCreateCoupon(input: CouponPayload) {
    createCouponMutation.mutate(input);
  }

  function handleSetDefaultProgram(commission: Commission) {
    setDefaultProgramMutation.mutate(commission.id);
  }

  function handleDeleteCoupon(coupon: Coupon) {
    const confirmed = window.confirm(
      `Delete coupon ${coupon.code}? Existing attribution totals stay in history.`
    );
    if (!confirmed) return;
    deleteCouponMutation.mutate(coupon.id);
  }

  const dialogMode = dialog?.mode ?? "create";
  const dialogCommission =
    dialog && dialog.mode !== "create" ? dialog.commission : undefined;
  const dialogPending =
    createProgramMutation.isPending || updateProgramMutation.isPending;
  const dialogError =
    dialogMode === "edit"
      ? mutationErrorMessage(updateProgramMutation.error)
      : mutationErrorMessage(createProgramMutation.error);
  const couponError = mutationErrorMessage(createCouponMutation.error);

  return (
    <div className="p-6 space-y-8 max-w-7xl">
      <PageHeader
        eyebrow="Programs"
        title="Commission rules"
        subtitle="Define how partners earn — recurring, lifetime, one-time, or tiered."
      >
        <Button variant="secondary" asChild>
          <a href={`/app/projects/${slug}/webhooks`}>
            <Code2 className="size-4" />
            Webhooks & API
          </a>
        </Button>
        <Button onClick={() => openCommissionDialog({ mode: "create" })}>
          <Plus className="size-4" />
          New commission
        </Button>
      </PageHeader>

      {/* Cards grid */}
      {programsLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading programs…
        </div>
      ) : programs.length === 0 ? (
        <div className="bg-card border rounded-md px-6 py-16 text-center space-y-3">
          <p className="text-eyebrow-muted">No programs yet</p>
          <h2 className="font-heading text-2xl text-foreground">
            Define how partners earn
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Create a recurring, lifetime, or one-time program. Partners get
            assigned to a program, and earn based on its rules.
          </p>
          <div className="pt-2">
            <Button onClick={() => openCommissionDialog({ mode: "create" })}>
              <Plus className="size-4" />
              New commission
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {programs.map((c) => (
            <CommissionCard
              key={c.id}
              commission={c}
              isDefault={c.id === defaultProgramId}
              isArchivePending={
                archiveProgramMutation.isPending &&
                archiveProgramMutation.variables === c.id
              }
              isSetDefaultPending={
                setDefaultProgramMutation.isPending &&
                setDefaultProgramMutation.variables === c.id
              }
              onArchive={handleArchiveCommission}
              onDuplicate={(commission) =>
                openCommissionDialog({ mode: "duplicate", commission })
              }
              onEdit={(commission) =>
                openCommissionDialog({ mode: "edit", commission })
              }
              onSetDefault={handleSetDefaultProgram}
            />
          ))}
        </div>
      )}

      {/* Coupon code attribution */}
      <div className="bg-card border rounded-md">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-card-title text-foreground">
            Coupon code attribution
          </h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              createCouponMutation.reset();
              setCouponDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            New coupon
          </Button>
        </div>
        {couponRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No coupons yet. Attribute a coupon code to a partner to track
            redemptions and MRR.
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Code</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Customer Discount</TableHead>
              <TableHead>Stripe Coupon</TableHead>
              <TableHead className="text-right">Redemptions</TableHead>
              <TableHead className="text-right">MRR Attributed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {couponRows.map((c) => (
              <TableRow key={c.id} className="hover:bg-muted/30">
                <TableCell className="pl-5">
                  <span className="font-mono text-xs bg-muted text-foreground px-2 py-1 rounded">
                    {c.code}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "size-7 rounded-full flex items-center justify-center text-xs font-semibold text-white",
                        c.partnerColor
                      )}
                    >
                      {c.partnerInitials}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {c.partnerName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.partnerEmail}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground">
                  {c.customerDiscount}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {c.stripeCoupon}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {c.redemptions}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  ${c.mrrAttributed.toLocaleString()}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-sm text-positive">
                    <span className="size-1.5 rounded-full bg-positive" />
                    Live
                  </span>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        disabled={
                          deleteCouponMutation.isPending &&
                          deleteCouponMutation.variables === c.id
                        }
                        onClick={() => handleDeleteCoupon(c)}
                      >
                        {deleteCouponMutation.isPending &&
                        deleteCouponMutation.variables === c.id
                          ? "Deleting..."
                          : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </div>

      <CommissionDialog
        commission={dialogCommission}
        errorMessage={dialogError}
        isPending={dialogPending}
        mode={dialogMode}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={handleSubmitCommission}
      />
      <CouponDialog
        defaultProgramId={defaultProgramId}
        errorMessage={couponError}
        isLoadingPartners={couponPartnersLoading}
        isPending={createCouponMutation.isPending}
        open={couponDialogOpen}
        partners={couponPartners}
        programs={programs}
        onOpenChange={setCouponDialogOpen}
        onSubmit={handleCreateCoupon}
      />
    </div>
  );
}

interface CommissionCardProps {
  commission: Commission;
  isArchivePending: boolean;
  isDefault: boolean;
  isSetDefaultPending: boolean;
  onArchive: (commission: Commission) => void;
  onDuplicate: (commission: Commission) => void;
  onEdit: (commission: Commission) => void;
  onSetDefault: (commission: Commission) => void;
}

function CommissionCard({
  commission,
  isArchivePending,
  isDefault,
  isSetDefaultPending,
  onArchive,
  onDuplicate,
  onEdit,
  onSetDefault,
}: CommissionCardProps) {
  const isRecurring = commission.type === "recurring";
  const isFlatOneTime =
    commission.type === "one-time" &&
    commission.flatAmount != null &&
    commission.flatAmount > 0;

  return (
    <div className="bg-card border rounded-md p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize",
              typeColor(commission.type)
            )}
          >
            <span className={cn("size-1.5 rounded-full", typeDot(commission.type))} />
            {commission.type}
          </span>
          {isDefault && (
            <span className="inline-flex items-center rounded-full bg-positive/10 px-2 py-1 text-xs font-medium text-positive">
              Default
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-muted-foreground">
            {commission.code}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(commission)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(commission)}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isDefault || isSetDefaultPending}
                onClick={() => onSetDefault(commission)}
              >
                {isSetDefaultPending
                  ? "Setting default..."
                  : isDefault
                    ? "Current default"
                    : "Set as default"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                disabled={isArchivePending}
                onClick={() => onArchive(commission)}
              >
                {isArchivePending ? "Archiving…" : "Archive"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-heading text-2xl text-foreground tracking-tight">
          {commission.name}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-5xl text-foreground tabular-nums leading-none">
            {isFlatOneTime ? formatProgramAmount(commission.flatAmount!) : commission.rate}
            {!isFlatOneTime && (
              <span className="text-2xl text-muted-foreground">%</span>
            )}
          </span>
          {isRecurring && commission.durationMonths && (
            <span className="text-sm text-muted-foreground">
              for {commission.durationMonths} months
            </span>
          )}
          {isFlatOneTime && (
            <span className="text-sm text-muted-foreground">
              per first payment
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {commission.description}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
        <Stat label="Min payout" value={`$${commission.minPayout}`} />
        <Stat
          label={isDefault ? "Partners using" : "Partners"}
          value={String(commission.partners)}
        />
        <Stat label="GTV month" value={formatCompact(commission.gtvMonth)} />
      </div>

      {commission.payoutCadence && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
          <CalendarClock className="size-3" />
          {describeSchedule({
            cadence: commission.payoutCadence,
            dayOfMonth: commission.payoutDayOfMonth ?? null,
            dayOfWeek: commission.payoutDayOfWeek ?? null,
            ordinal: commission.payoutOrdinal ?? null,
          })}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-sm text-foreground tabular-nums">{value}</p>
    </div>
  );
}

interface CommissionFormInput {
  name: string;
  type: RuleType;
  rate: number;
  durationMonths?: number;
  flatAmount: number | null;
  description: string;
  minPayout: number;
  payoutCadence: PayoutCadence;
  payoutDayOfMonth: number;
  payoutDayOfWeek: number;
  payoutOrdinal: number;
}

const DEFAULT_COMMISSION_FORM: CommissionFormInput = {
  name: "",
  type: "recurring",
  rate: 30,
  durationMonths: 3,
  flatAmount: null,
  description: "",
  minPayout: 50,
  payoutCadence: "monthly_day",
  payoutDayOfMonth: 1,
  payoutDayOfWeek: 0,
  payoutOrdinal: 1,
};

const TYPE_TILES: {
  value: RuleType;
  title: string;
  desc: string;
}[] = [
  {
    value: "recurring",
    title: "Recurring",
    desc: "A % of each payment, for a fixed window",
  },
  {
    value: "lifetime",
    title: "Lifetime",
    desc: "A % for as long as the customer pays",
  },
  {
    value: "one-time",
    title: "One-time",
    desc: "A % or fixed bounty on first payment",
  },
];

function plainEnglish(form: CommissionFormInput): string {
  const rate = form.rate || 0;
  switch (form.type) {
    case "recurring": {
      const dur = form.durationMonths ?? 0;
      const unit = dur === 1 ? "month" : "months";
      return `Partners earn ${rate}% of each payment for the first ${dur} ${unit} after a referral converts.`;
    }
    case "lifetime":
      return `Partners earn ${rate}% of every payment for as long as the referred customer remains active.`;
    case "one-time":
      if (form.flatAmount != null && form.flatAmount > 0) {
        return `Partners earn ${formatProgramAmount(form.flatAmount)} on the first payment. No recurring payout.`;
      }
      return `Partners earn ${rate}% on the first payment. No recurring payout.`;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

function commissionFormError(form: CommissionFormInput): string | null {
  if (!form.name.trim()) return "Name is required";
  if (form.type === "recurring" && (form.durationMonths ?? 0) <= 0) {
    return "Recurring programs need a duration";
  }
  if (form.type !== "one-time" && form.rate <= 0) {
    return "Percentage programs need a positive rate";
  }
  if (
    form.type === "one-time" &&
    (!form.flatAmount || form.flatAmount <= 0) &&
    form.rate <= 0
  ) {
    return "One-time programs need a positive rate or flat bounty";
  }
  return null;
}

function commissionToForm(
  commission: Commission | undefined,
  mode: CommissionDialogState["mode"]
): CommissionFormInput {
  if (!commission) {
    return { ...DEFAULT_COMMISSION_FORM };
  }

  return {
    ...DEFAULT_COMMISSION_FORM,
    name:
      mode === "duplicate"
        ? `${commission.name} copy`
        : commission.name,
    type: commission.type,
    rate: commission.rate,
    durationMonths:
      commission.durationMonths ?? DEFAULT_COMMISSION_FORM.durationMonths,
    flatAmount: commission.flatAmount ?? null,
    description: commission.description,
    minPayout: commission.minPayout,
    payoutCadence:
      commission.payoutCadence ?? DEFAULT_COMMISSION_FORM.payoutCadence,
    payoutDayOfMonth:
      commission.payoutDayOfMonth ??
      DEFAULT_COMMISSION_FORM.payoutDayOfMonth,
    payoutDayOfWeek:
      commission.payoutDayOfWeek ?? DEFAULT_COMMISSION_FORM.payoutDayOfWeek,
    payoutOrdinal:
      commission.payoutOrdinal ?? DEFAULT_COMMISSION_FORM.payoutOrdinal,
  };
}

function buildCommissionPayload(
  form: CommissionFormInput,
  mode: CommissionDialogState["mode"],
  commission: Commission | undefined
): CommissionProgramPayload {
  const name = form.name.trim();
  const cadence = form.payoutCadence;

  return {
    code:
      mode === "edit" && commission
        ? commission.code
        : `${slugify(name) || "program"}-${randomSuffix()}`,
    name,
    type: form.type,
    rate: form.rate,
    durationMonths:
      form.type === "recurring" ? form.durationMonths ?? null : null,
    flatAmount:
      form.type === "one-time" && form.flatAmount != null && form.flatAmount > 0
        ? form.flatAmount
        : null,
    description: form.description.trim() || plainEnglish(form),
    minPayout: form.minPayout,
    payoutCadence: cadence,
    payoutDayOfMonth:
      cadence === "monthly_day" ? form.payoutDayOfMonth : null,
    payoutDayOfWeek:
      cadence === "monthly_day" ? null : form.payoutDayOfWeek,
    payoutOrdinal:
      cadence === "monthly_ordinal" ? form.payoutOrdinal : null,
  };
}

function CommissionDialog({
  commission,
  errorMessage,
  isPending,
  mode,
  open,
  onOpenChange,
  onSubmit,
}: {
  commission?: Commission;
  errorMessage: string | null;
  isPending: boolean;
  mode: CommissionDialogState["mode"];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: CommissionProgramPayload) => void;
}) {
  const [form, setForm] = useState<CommissionFormInput>(() =>
    commissionToForm(commission, mode)
  );

  useEffect(() => {
    if (open) {
      setForm(commissionToForm(commission, mode));
    }
  }, [commission, mode, open]);

  function handleSubmit() {
    if (formError) return;
    onSubmit(buildCommissionPayload(form, mode, commission));
  }

  const formError = commissionFormError(form);
  const dialogTitle =
    mode === "edit"
      ? "Edit commission rule"
      : mode === "duplicate"
        ? "Duplicate commission rule"
        : "New commission rule";
  const actionLabel =
    mode === "edit"
      ? "Save changes"
      : mode === "duplicate"
        ? "Duplicate commission"
        : "Create commission";
  const pendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{dialogTitle}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Define how partners earn from referred revenue
          </p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="comm-name" className="text-eyebrow-muted">
              Name
            </Label>
            <Input
              id="comm-name"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="Recurring 30% × 3 months"
            />
          </div>

          {/* Type tiles */}
          <div className="space-y-2">
            <p className="text-eyebrow-muted">Commission type</p>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_TILES.map((tile) => {
                const isActive = form.type === tile.value;
                return (
                  <button
                    key={tile.value}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, type: tile.value }))
                    }
                    className={cn(
                      "text-left rounded-md border p-3.5 transition-colors duration-150 ease-out",
                      isActive
                        ? "border-foreground ring-1 ring-foreground bg-card"
                        : "border-border bg-card hover:border-foreground/40"
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {tile.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-snug">
                      {tile.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rate + Duration */}
          <div
            className={cn(
              "grid gap-4",
              form.type === "lifetime" ? "grid-cols-1" : "grid-cols-2"
            )}
          >
            <div className="space-y-2">
              <Label htmlFor="comm-rate" className="text-eyebrow-muted">
                Commission rate
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="comm-rate"
                  type="number"
                  min={0}
                  max={100}
                  value={form.rate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      rate: Math.min(100, Math.max(0, Number(e.target.value))),
                    }))
                  }
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            {form.type === "recurring" && (
              <div className="space-y-2">
                <Label htmlFor="comm-duration" className="text-eyebrow-muted">
                  Duration
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="comm-duration"
                    type="number"
                    min={1}
                    max={120}
                    value={form.durationMonths ?? 0}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        durationMonths: Math.min(
                          120,
                          Math.max(1, Number(e.target.value)),
                        ),
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">months</span>
                </div>
              </div>
            )}

            {form.type === "one-time" && (
              <div className="space-y-2">
                <Label htmlFor="comm-flat" className="text-eyebrow-muted">
                  Flat bounty
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="comm-flat"
                    type="number"
                    min={0}
                    max={100000}
                    value={form.flatAmount ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        flatAmount:
                          e.target.value === ""
                            ? null
                            : Math.min(
                                100000,
                                Math.max(0, Number(e.target.value)),
                              ),
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground -mt-3">
            {form.type === "one-time" && form.flatAmount
              ? "Flat bounty overrides the percentage for this one-time program."
              : "Applied to the partner's net referred revenue."}
          </p>

          {/* Plain English preview */}
          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Plain English</p>
            <div className="rounded-md border-2 border-dashed border-border bg-background/50 px-4 py-3">
              <p className="text-sm text-foreground leading-relaxed">
                {plainEnglish(form)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comm-description" className="text-eyebrow-muted">
              Description
            </Label>
            <Textarea
              id="comm-description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={plainEnglish(form)}
              rows={3}
            />
          </div>

          {/* Payout schedule */}
          <div className="space-y-2">
            <p className="text-eyebrow-muted">Payout schedule</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "monthly_day", label: "Day of month" },
                { value: "monthly_ordinal", label: "Nth weekday" },
                { value: "weekly", label: "Weekly" },
              ].map((opt) => {
                const active = form.payoutCadence === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        payoutCadence:
                          opt.value as CommissionFormInput["payoutCadence"],
                      }))
                    }
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-foreground ring-1 ring-foreground bg-card"
                        : "border-border bg-card hover:border-foreground/40",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {form.payoutCadence === "monthly_day" && (
              <div className="rounded-md border bg-card divide-y divide-border">
                <ConditionRow label="Day of month">
                  <NumberSuffixInput
                    value={form.payoutDayOfMonth}
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        payoutDayOfMonth: Math.min(31, Math.max(1, v)),
                      }))
                    }
                    min={1}
                    max={31}
                    suffix="(1–31)"
                  />
                </ConditionRow>
              </div>
            )}

            {form.payoutCadence === "monthly_ordinal" && (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(form.payoutOrdinal)}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, payoutOrdinal: Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">First</SelectItem>
                    <SelectItem value="2">Second</SelectItem>
                    <SelectItem value="3">Third</SelectItem>
                    <SelectItem value="4">Fourth</SelectItem>
                    <SelectItem value="5">Last</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={String(form.payoutDayOfWeek)}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, payoutDayOfWeek: Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.payoutCadence === "weekly" && (
              <Select
                value={String(form.payoutDayOfWeek)}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, payoutDayOfWeek: Number(v) }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sunday</SelectItem>
                  <SelectItem value="1">Monday</SelectItem>
                  <SelectItem value="2">Tuesday</SelectItem>
                  <SelectItem value="3">Wednesday</SelectItem>
                  <SelectItem value="4">Thursday</SelectItem>
                  <SelectItem value="5">Friday</SelectItem>
                  <SelectItem value="6">Saturday</SelectItem>
                </SelectContent>
              </Select>
            )}

            <p className="text-xs text-muted-foreground">
              {describeSchedule({
                cadence: form.payoutCadence,
                dayOfMonth: form.payoutDayOfMonth,
                dayOfWeek: form.payoutDayOfWeek,
                ordinal: form.payoutOrdinal,
              })}
              .
            </p>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            <p className="text-eyebrow-muted">Payout minimum</p>
            <div className="rounded-md border bg-card divide-y divide-border">
              <ConditionRow label="Min payout">
                <NumberSuffixInput
                  value={form.minPayout}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, minPayout: v }))
                  }
                  min={0}
                  max={100000}
                  prefix="$"
                />
              </ConditionRow>
            </div>
          </div>
        </div>

        {errorMessage && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        {formError && form.name.trim() && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {formError}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !!formError}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isPending ? pendingLabel : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CouponFormInput {
  code: string;
  partnerId: string;
  commissionProgramId: string;
  customerDiscount: string;
  stripeCoupon: string;
}

const EMPTY_COUPON_FORM: CouponFormInput = {
  code: "",
  partnerId: "",
  commissionProgramId: "__partner__",
  customerDiscount: "",
  stripeCoupon: "",
};

function normalizeCouponCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function CouponDialog({
  defaultProgramId,
  errorMessage,
  isLoadingPartners,
  isPending,
  open,
  partners,
  programs,
  onOpenChange,
  onSubmit,
}: {
  defaultProgramId: string | null;
  errorMessage: string | null;
  isLoadingPartners: boolean;
  isPending: boolean;
  open: boolean;
  partners: PartnerForCoupon[];
  programs: Commission[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CouponPayload) => void;
}) {
  const [form, setForm] = useState<CouponFormInput>(EMPTY_COUPON_FORM);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_COUPON_FORM);
    }
  }, [open]);

  function selectedPartner(): PartnerForCoupon | undefined {
    return partners.find((partner) => partner.id === form.partnerId);
  }

  function selectedProgramId(): string | null {
    if (form.commissionProgramId === "__none__") return null;
    if (form.commissionProgramId === "__partner__") {
      return selectedPartner()?.commissionProgramId ?? defaultProgramId;
    }
    return form.commissionProgramId;
  }

  function handlePartnerChange(partnerId: string) {
    const partner = partners.find((item) => item.id === partnerId);
    const hasInheritedProgram = Boolean(
      partner?.commissionProgramId || defaultProgramId,
    );
    setForm((current) => ({
      ...current,
      partnerId,
      commissionProgramId: hasInheritedProgram ? "__partner__" : "__none__",
    }));
  }

  function handleSubmit() {
    const code = normalizeCouponCode(form.code);
    if (!code || !form.partnerId) return;
    onSubmit({
      code,
      partnerId: form.partnerId,
      commissionProgramId: selectedProgramId(),
      customerDiscount: form.customerDiscount.trim() || null,
      stripeCoupon: form.stripeCoupon.trim() || null,
    });
  }

  const partner = selectedPartner();
  const partnerProgram = programs.find(
    (program) => program.id === partner?.commissionProgramId
  );
  const defaultProgram = programs.find(
    (program) => program.id === defaultProgramId
  );
  const selectedProgram = programs.find(
    (program) => program.id === selectedProgramId()
  );
  const canSubmit = !!normalizeCouponCode(form.code) && !!form.partnerId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">New coupon attribution</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Link a coupon code to a partner so redemptions and referred revenue stay attributable.
          </p>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="coupon-code" className="text-eyebrow-muted">
                Coupon code
              </Label>
              <Input
                id="coupon-code"
                value={form.code}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="PARTNER20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-eyebrow-muted">Partner</Label>
              <Select
                value={form.partnerId}
                onValueChange={handlePartnerChange}
                disabled={isLoadingPartners || partners.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingPartners ? "Loading partners..." : "Select partner"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name || item.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {partners.length === 0 && !isLoadingPartners && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Add or activate a partner before creating coupon attribution.
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-eyebrow-muted">Commission program</Label>
            <Select
              value={form.commissionProgramId}
              onValueChange={(commissionProgramId) =>
                setForm((current) => ({ ...current, commissionProgramId }))
              }
              disabled={!form.partnerId}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__partner__">
                  {partnerProgram
                    ? `Partner default - ${partnerProgram.name}`
                    : defaultProgram
                      ? `Project default - ${defaultProgram.name}`
                      : "Partner default"}
                </SelectItem>
                <SelectItem value="__none__">No commission program</SelectItem>
                {programs.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.name} - {formatProgramSummary(program)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedProgram
                ? `${selectedProgram.name} · ${formatProgramSummary(selectedProgram)}`
                : "No commission program selected."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="coupon-discount" className="text-eyebrow-muted">
                Customer discount
              </Label>
              <Input
                id="coupon-discount"
                value={form.customerDiscount}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    customerDiscount: e.target.value,
                  }))
                }
                placeholder="20% off first year"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe-coupon" className="text-eyebrow-muted">
                Stripe coupon ID
              </Label>
              <Input
                id="stripe-coupon"
                value={form.stripeCoupon}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    stripeCoupon: e.target.value,
                  }))
                }
                placeholder="promo_..."
              />
            </div>
          </div>
        </div>

        {errorMessage && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isPending ? "Creating..." : "Create coupon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConditionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function NumberSuffixInput({
  value,
  onChange,
  min,
  max,
  prefix,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
}) {
  function handleChange(nextValue: number) {
    let normalized = nextValue;
    if (min != null) normalized = Math.max(min, normalized);
    if (max != null) normalized = Math.min(max, normalized);
    onChange(normalized);
  }

  return (
    <div className="flex items-center gap-1.5">
      {prefix && (
        <span className="text-sm text-muted-foreground">{prefix}</span>
      )}
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => handleChange(Number(e.target.value))}
        className="w-20 h-8 text-right font-mono tabular-nums"
      />
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

export default Commissions;
