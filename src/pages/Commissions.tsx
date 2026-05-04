import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
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
  payoutCadence?: "monthly_day" | "monthly_ordinal" | "weekly" | null;
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
  payoutCadence: "monthly_day" | "monthly_ordinal" | "weekly" | null;
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
  const [creating, setCreating] = useState(false);

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

  const createProgramMutation = useMutation({
    mutationFn: async (input: Omit<Commission, "id" | "partners" | "gtvMonth">) => {
      const res = await fetch(
        `/api/projects/${projectId}/commission-programs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: input.code,
            name: input.name,
            type: input.type,
            rate: input.rate,
            durationMonths: input.durationMonths ?? null,
            flatAmount: input.flatAmount ?? null,
            description: input.description,
            minPayout: input.minPayout,
            payoutCadence: input.payoutCadence ?? null,
            payoutDayOfMonth: input.payoutDayOfMonth ?? null,
            payoutDayOfWeek: input.payoutDayOfWeek ?? null,
            payoutOrdinal: input.payoutOrdinal ?? null,
          }),
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
      setCreating(false);
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
        <Button onClick={() => setCreating(true)}>
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
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New commission
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {programs.map((c) => (
            <CommissionCard key={c.id} commission={c} />
          ))}
        </div>
      )}

      {/* Coupon code attribution */}
      <div className="bg-card border rounded-md">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-card-title text-foreground">
            Coupon code attribution
          </h2>
          <Button variant="secondary" size="sm">
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </div>

      <NewCommissionDialog
        open={creating}
        onOpenChange={setCreating}
        isPending={createProgramMutation.isPending}
        onCreate={(c) => createProgramMutation.mutate(c)}
      />
    </div>
  );
}

function CommissionCard({ commission }: { commission: Commission }) {
  const isRecurring = commission.type === "recurring";

  return (
    <div className="bg-card border rounded-md p-6 space-y-4">
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize",
            typeColor(commission.type)
          )}
        >
          <span className={cn("size-1.5 rounded-full", typeDot(commission.type))} />
          {commission.type}
        </span>
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
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive">
                Archive
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
            {commission.rate}
            <span className="text-2xl text-muted-foreground">%</span>
          </span>
          {isRecurring && commission.durationMonths && (
            <span className="text-sm text-muted-foreground">
              for {commission.durationMonths} months
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {commission.description}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
        <Stat label="Min payout" value={`$${commission.minPayout}`} />
        <Stat label="Partners" value={String(commission.partners)} />
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

interface NewCommissionInput {
  name: string;
  type: RuleType;
  rate: number;
  durationMonths?: number;
  durationUnit: "months" | "weeks" | "days";
  description: string;
  minPayout: number;
  cookieWindowDays: number;
  payOnlyFirstConversion: boolean;
  refundWindowDays: number;
  payoutCadence: "monthly_day" | "monthly_ordinal" | "weekly";
  payoutDayOfMonth: number;
  payoutDayOfWeek: number;
  payoutOrdinal: number;
}

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
    desc: "A flat amount on conversion",
  },
];

function plainEnglish(form: NewCommissionInput): string {
  const rate = form.rate || 0;
  switch (form.type) {
    case "recurring": {
      const dur = form.durationMonths ?? 0;
      const unit =
        dur === 1 ? form.durationUnit.replace(/s$/, "") : form.durationUnit;
      return `Partners earn ${rate}% of each payment for the first ${dur} ${unit} after a referral converts.`;
    }
    case "lifetime":
      return `Partners earn ${rate}% of every payment for as long as the referred customer remains active.`;
    case "one-time":
      return `Partners earn a flat ${rate}% on the first payment. No recurring payout.`;
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

function NewCommissionDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (c: Omit<Commission, "id" | "partners" | "gtvMonth">) => void;
  isPending: boolean;
}) {
  const initial: NewCommissionInput = {
    name: "",
    type: "recurring",
    rate: 30,
    durationMonths: 3,
    durationUnit: "months",
    description: "",
    minPayout: 50,
    cookieWindowDays: 60,
    payOnlyFirstConversion: false,
    refundWindowDays: 30,
    payoutCadence: "monthly_day",
    payoutDayOfMonth: 1,
    payoutDayOfWeek: 0,
    payoutOrdinal: 1,
  };
  const [form, setForm] = useState<NewCommissionInput>(initial);

  function reset() {
    setForm(initial);
  }

  function handleSubmit() {
    if (!form.name) return;
    const baseSlug = slugify(form.name) || "program";
    const code = `${baseSlug}-${randomSuffix()}`;
    onCreate({
      ...form,
      code,
      description: form.description || plainEnglish(form),
    });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">New commission rule</DialogTitle>
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
              form.type === "recurring" ? "grid-cols-2" : "grid-cols-1"
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
                  value={form.rate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, rate: Number(e.target.value) }))
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
                    value={form.durationMonths ?? 0}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        durationMonths: Number(e.target.value),
                      }))
                    }
                  />
                  <Select
                    value={form.durationUnit}
                    onValueChange={(v: "months" | "weeks" | "days") =>
                      setForm((f) => ({ ...f, durationUnit: v }))
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="months">months</SelectItem>
                      <SelectItem value="weeks">weeks</SelectItem>
                      <SelectItem value="days">days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground -mt-3">
            Applied to the partner's net referred revenue.
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
                        payoutCadence: opt.value as NewCommissionInput["payoutCadence"],
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
            <p className="text-eyebrow-muted">Conditions</p>
            <div className="rounded-md border bg-card divide-y divide-border">
              <ConditionRow label="Min payout">
                <NumberSuffixInput
                  value={form.minPayout}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, minPayout: v }))
                  }
                  prefix="$"
                />
              </ConditionRow>
              <ConditionRow label="Cookie window">
                <NumberSuffixInput
                  value={form.cookieWindowDays}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, cookieWindowDays: v }))
                  }
                  suffix="days"
                />
              </ConditionRow>
              <ConditionRow label="Pay only on first conversion">
                <Switch
                  checked={form.payOnlyFirstConversion}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, payOnlyFirstConversion: v }))
                  }
                />
              </ConditionRow>
              <ConditionRow label="Eligible after refund window">
                <NumberSuffixInput
                  value={form.refundWindowDays}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, refundWindowDays: v }))
                  }
                  suffix="days"
                />
              </ConditionRow>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isPending ? "Creating…" : "Create commission"}
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
  prefix,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {prefix && (
        <span className="text-sm text-muted-foreground">{prefix}</span>
      )}
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-8 text-right font-mono tabular-nums"
      />
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

export default Commissions;
