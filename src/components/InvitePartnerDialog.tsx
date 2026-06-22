import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { UserPlus } from "lucide-react";

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface CommissionProgram {
  id: string;
  name: string;
  type: "recurring" | "lifetime" | "one-time";
  rate: number;
  flatAmount: number | null;
}

interface BrandingResponse {
  branding: {
    defaultCommissionProgramId: string | null;
  } | null;
}

interface InvitePartnerDialogProps {
  projects: Project[];
}

function formatProgramAmount(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

function formatProgramSummary(program: CommissionProgram): string {
  if (
    program.type === "one-time" &&
    program.flatAmount != null &&
    program.flatAmount > 0
  ) {
    return `${formatProgramAmount(program.flatAmount)} flat`;
  }
  return `${program.rate}% · ${program.type}`;
}

function InvitePartnerDialog({ projects }: InvitePartnerDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [commissionRate, setCommissionRate] = useState("20");
  const [commissionProgramId, setCommissionProgramId] = useState("__default__");
  const [payoutLink, setPayoutLink] = useState("");

  useEffect(() => {
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  const { data: programsData } = useQuery({
    queryKey: ["commission-programs", projectId],
    queryFn: async (): Promise<{ programs: CommissionProgram[] }> => {
      const response = await fetch(
        `/api/projects/${projectId}/commission-programs`,
      );
      if (!response.ok) throw new Error("Failed to load commission programs");
      return response.json();
    },
    enabled: !!projectId && open,
  });

  const { data: brandingData } = useQuery({
    queryKey: ["branding", projectId],
    queryFn: async (): Promise<BrandingResponse> => {
      const response = await fetch(`/api/projects/${projectId}/branding`);
      if (!response.ok) throw new Error("Failed to load project defaults");
      return response.json();
    },
    enabled: !!projectId && open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          ...(name.trim() && { name: name.trim() }),
          ...(email.trim() && { email: email.trim().toLowerCase() }),
          commissionRate: parseFloat(commissionRate) / 100,
          commissionProgramId:
            commissionProgramId === "__default__"
              ? null
              : commissionProgramId,
          ...(payoutLink.trim() && { payoutLink: payoutLink.trim() }),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to invite partner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      setOpen(false);
      resetForm();
    },
  });

  function resetForm() {
    setName("");
    setEmail("");
    setCommissionRate("20");
    setCommissionProgramId("__default__");
    setPayoutLink("");
    setProjectId(projects[0]?.id ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    mutation.mutate();
  }

  function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);
    setCommissionProgramId("__default__");
  }

  const programs = programsData?.programs ?? [];
  const defaultProgramId =
    brandingData?.branding?.defaultCommissionProgramId ?? null;
  const defaultProgram = programs.find(
    (program) => program.id === defaultProgramId,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={projects.length === 0}>
          <UserPlus className="w-4 h-4 mr-2" />
          Invite Partner
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a Partner</DialogTitle>
          <DialogDescription>
            Add an affiliate partner to your project. They'll receive a unique
            referral link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="partner-project">Project</Label>
            <Select value={projectId} onValueChange={handleProjectChange}>
              <SelectTrigger id="partner-project" className="bg-card">
                <span>
                  {projects.find((p) => p.id === projectId)?.name ??
                    "Select a project"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-name">Name</Label>
            <Input
              id="partner-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Partner's name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-email">Email</Label>
            <Input
              id="partner-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-payout">Payout method</Label>
            <Input
              id="partner-payout"
              value={payoutLink}
              onChange={(e) => setPayoutLink(e.target.value)}
              placeholder="paypal.me/name, partner@example.com, or @handle"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-program">Commission program</Label>
            <Select
              value={commissionProgramId}
              onValueChange={setCommissionProgramId}
              disabled={!projectId}
            >
              <SelectTrigger id="partner-program" className="bg-card">
                <span>
                  {commissionProgramId === "__default__"
                    ? defaultProgram
                      ? `Project default - ${defaultProgram.name}`
                      : "Project fallback rate"
                    : programs.find((program) => program.id === commissionProgramId)
                        ?.name ?? "Select a program"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">
                  {defaultProgram
                    ? `Project default - ${defaultProgram.name}`
                    : "Project fallback rate"}
                </SelectItem>
                {programs.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.name} - {formatProgramSummary(program)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-commission">Fallback commission rate (%)</Label>
            <Input
              id="partner-commission"
              type="number"
              min="1"
              max="100"
              step="1"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              disabled={commissionProgramId !== "__default__"}
            />
            <p className="text-xs text-muted-foreground">
              Used only when no explicit or project-default commission program applies.
            </p>
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Inviting..." : "Invite Partner"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default InvitePartnerDialog;
