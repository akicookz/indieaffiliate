import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

interface InvitePartnerDialogProps {
  projects: Project[];
}

function InvitePartnerDialog({ projects }: InvitePartnerDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [commissionRate, setCommissionRate] = useState("20");
  const [payoutLink, setPayoutLink] = useState("");

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
    setPayoutLink("");
    setProjectId(projects[0]?.id ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    mutation.mutate();
  }

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
            <Select value={projectId} onValueChange={setProjectId}>
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
            <Label htmlFor="partner-payout">Payout Link</Label>
            <Input
              id="partner-payout"
              value={payoutLink}
              onChange={(e) => setPayoutLink(e.target.value)}
              placeholder="paypal.me/name or wise.com/pay/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-commission">Commission Rate (%)</Label>
            <Input
              id="partner-commission"
              type="number"
              min="1"
              max="100"
              step="1"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
            />
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
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
