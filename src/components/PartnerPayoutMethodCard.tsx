import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type LucideIcon,
  AlertTriangle,
  AtSign,
  ExternalLink,
  Link2,
  Mail,
  Pencil,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  parsePayoutMethod,
  type PayoutMethodKind,
} from "@/lib/payout-method";

interface PartnerPayoutMethodCardProps {
  currentLink: string | null;
}

const METHOD_ICONS: Record<PayoutMethodKind, LucideIcon> = {
  email: Mail,
  handle: AtSign,
  link: Link2,
};

export default function PartnerPayoutMethodCard({
  currentLink,
}: PartnerPayoutMethodCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLink ?? "");
  const method = parsePayoutMethod(currentLink);
  const MethodIcon = method ? METHOD_ICONS[method.kind] : null;
  const isReady = !!method;

  const mutation = useMutation({
    mutationFn: async (payoutLink: string | null) => {
      const response = await fetch("/api/partner/payout-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ payoutLink }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? "Failed to update");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["partner-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["partner-payouts-full"] });
      setEditing(false);
    },
  });

  function saveMethod() {
    mutation.mutate(value.trim() || null);
  }

  return (
    <div className="bg-card border border-border rounded-md p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">
              Payout method
            </h3>
          </div>
          <div
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              isReady
                ? "border-positive/20 bg-positive/10 text-positive"
                : "border-warning/20 bg-warning/10 text-warning"
            }`}
          >
            {isReady ? (
              <ShieldCheck className="w-3 h-3" />
            ) : (
              <AlertTriangle className="w-3 h-3" />
            )}
            {isReady ? "Ready for payouts" : "Needed before payout"}
          </div>
        </div>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setValue(currentLink ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="w-3 h-3 mr-1" />
            {currentLink ? "Edit" : "Add method"}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="paypal.me/yourname, partner@example.com, or @handle"
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveMethod();
                if (e.key === "Escape") {
                  setEditing(false);
                  setValue(currentLink ?? "");
                }
              }}
              autoFocus
            />
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={saveMethod}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setValue(currentLink ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Use a payment link, payout email, or payment handle. Do not enter bank account or routing numbers.
          </p>
        </div>
      ) : method ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {MethodIcon && (
              <MethodIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{method.label}</p>
              <p className="text-sm text-foreground truncate">
                {method.displayValue}
              </p>
            </div>
          </div>
          {method.href && (
            <a
              href={method.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Open payout method"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add a payout method so approved commissions can be released.
        </p>
      )}
      {mutation.error && (
        <p className="text-sm text-destructive mt-2">{mutation.error.message}</p>
      )}
    </div>
  );
}
