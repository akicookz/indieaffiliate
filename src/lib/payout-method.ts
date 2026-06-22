export type PayoutMethodKind = "email" | "handle" | "link";

export interface PayoutMethodInfo {
  kind: PayoutMethodKind;
  label: string;
  displayValue: string;
  href: string | null;
}

export function parsePayoutMethod(
  value: string | null | undefined,
): PayoutMethodInfo | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      kind: "email",
      label: "Email payout method",
      displayValue: trimmed,
      href: `mailto:${trimmed}`,
    };
  }
  if (trimmed.startsWith("@")) {
    return {
      kind: "handle",
      label: "Payment handle",
      displayValue: trimmed,
      href: null,
    };
  }
  return {
    kind: "link",
    label: "Payment link",
    displayValue: trimmed,
    href: trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
  };
}
