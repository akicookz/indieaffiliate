import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SubscriptionData {
  subscription: {
    plan: "starter" | "growth" | "scale" | null;
    status: string;
  };
  mrr: number;
  shouldShowUpgrade: boolean;
}

export function UpgradePrompt() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    // Check localStorage on mount
    return localStorage.getItem("upgradePromptDismissed") === "true";
  });

  // Fetch subscription and MRR data
  const { data } = useQuery<SubscriptionData>({
    queryKey: ["subscription"],
    queryFn: async () => {
      const response = await fetch("/api/subscription");
      if (!response.ok) throw new Error("Failed to fetch subscription");
      return response.json();
    },
    refetchInterval: 30000, // Check every 30 seconds
  });

  // Check if we should show the prompt
  useEffect(() => {
    if (data?.shouldShowUpgrade && !dismissed) {
      setOpen(true);
    }
  }, [data?.shouldShowUpgrade, dismissed]);

  // Create checkout session mutation
  const checkoutMutation = useMutation({
    mutationFn: async (interval: "month" | "year") => {
      const successUrl = `${window.location.origin}/app?checkout=success`;
      const cancelUrl = `${window.location.origin}/app?checkout=cancelled`;

      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "growth",
          successUrl,
          cancelUrl,
          interval,
        }),
      });

      if (!response.ok) throw new Error("Failed to create checkout session");
      const data = (await response.json()) as { url: string };
      window.location.href = data.url;
    },
  });

  if (!data?.shouldShowUpgrade || dismissed) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <DialogTitle>Congratulations! 🎉</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            You've reached <strong>$1,000 MRR</strong>! Upgrade to a paid plan to continue
            growing your affiliate program with advanced features.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-sm text-muted-foreground mb-1">Current MRR</div>
            <div className="text-2xl font-bold">${data.mrr.toLocaleString()}</div>
          </div>

          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={() => checkoutMutation.mutate("month")}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? "Loading..." : "Upgrade to Growth Plan (Monthly)"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => checkoutMutation.mutate("year")}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? "Loading..." : "Upgrade to Growth Plan (Annual) - Save 20%"}
            </Button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDismissed(true);
                setOpen(false);
              }}
            >
              Maybe later
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDismissed(true);
                setOpen(false);
                // Store dismissal in localStorage to persist across sessions
                localStorage.setItem("upgradePromptDismissed", "true");
              }}
            >
              Don't show again
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
