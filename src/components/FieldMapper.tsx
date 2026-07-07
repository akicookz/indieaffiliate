
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface FieldMapping {
  csvHeader: string;
  targetField: string | null;
}

interface FieldMapperProps {
  mappings: FieldMapping[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
  importType: "partners" | "customers" | "commissions";
}

const PARTNER_FIELDS = [
  { value: "name", label: "Partner Name", required: false },
  { value: "email", label: "Partner Email", required: true },
  { value: "referralCode", label: "Referral Code", required: false },
  { value: "commissionRate", label: "Commission Rate", required: false },
  { value: "payoutLink", label: "Payout Method", required: false },
  { value: "status", label: "Status", required: false },
];

const CUSTOMER_FIELDS = [
  { value: "email", label: "Customer Email", required: true },
  { value: "name", label: "Customer Name", required: false },
  { value: "partnerEmail", label: "Partner Email (link)", required: true },
  { value: "revenue", label: "Revenue", required: false },
  { value: "status", label: "Status", required: false },
];

const COMMISSION_FIELDS = [
  { value: "partnerEmail", label: "Partner Email", required: true },
  { value: "customerEmail", label: "Customer Email", required: true },
  { value: "amount", label: "Commission Amount", required: true },
  { value: "status", label: "Status", required: false },
];

const AUTO_MAP_HINTS: Record<string, string[]> = {
  name: ["name", "partner_name", "affiliate_name", "full_name", "fullname", "display_name"],
  email: ["email", "partner_email", "affiliate_email", "email_address", "mail"],
  referralCode: ["referral_code", "referrer_code", "ref_code", "code", "affiliate_code", "referral", "ref", "coupon_code", "coupon"],
  commissionRate: ["commission_rate", "rate", "commission", "percentage", "pct", "commission_pct"],
  payoutLink: ["payout_method", "payout_link", "payout", "payout_url", "paypal", "venmo", "wise", "payment_link", "payment_url"],
  status: ["status", "state", "partner_status"],
  partnerEmail: ["partner_email", "affiliate_email", "referrer_email", "referrer"],
  customerEmail: ["customer_email", "email", "buyer_email"],
  revenue: ["revenue", "amount", "total", "mrr", "value", "sale_amount"],
  amount: ["commission", "commission_amount", "payout", "earnings"],
};

function autoMap(csvHeaders: string[], targetFields: Array<{ value: string }>): FieldMapping[] {
  const usedTargets = new Set<string>();

  return csvHeaders.map((header) => {
    const normalized = header.toLowerCase().trim().replace(/\s+/g, "_");

    for (const field of targetFields) {
      if (usedTargets.has(field.value)) continue;
      const hints = AUTO_MAP_HINTS[field.value] ?? [];
      if (
        hints.includes(normalized) ||
        normalized === field.value.toLowerCase()
      ) {
        usedTargets.add(field.value);
        return { csvHeader: header, targetField: field.value };
      }
    }

    return { csvHeader: header, targetField: null };
  });
}

function getFieldsForType(type: "partners" | "customers" | "commissions") {
  switch (type) {
    case "partners":
      return PARTNER_FIELDS;
    case "customers":
      return CUSTOMER_FIELDS;
    case "commissions":
      return COMMISSION_FIELDS;
  }
}

function FieldMapper({ mappings, onMappingsChange, importType }: FieldMapperProps) {
  const fields = getFieldsForType(importType);
  const assignedTargets = new Set(
    mappings.filter((m) => m.targetField).map((m) => m.targetField!),
  );

  function handleFieldChange(csvHeader: string, targetField: string | null) {
    const updated = mappings.map((m) =>
      m.csvHeader === csvHeader ? { ...m, targetField } : m,
    );
    onMappingsChange(updated);
  }

  function handleClear(csvHeader: string) {
    handleFieldChange(csvHeader, null);
  }

  const missingRequired = fields
    .filter((f) => f.required)
    .filter((f) => !assignedTargets.has(f.value));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {mappings.map((mapping) => (
          <div
            key={mapping.csvHeader}
            className="flex items-center gap-3 bg-muted/30 rounded-md px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                {mapping.csvHeader}
              </code>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">maps to</div>
            <div className="w-52">
              {mapping.targetField ? (
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {fields.find((f) => f.value === mapping.targetField)?.label ?? mapping.targetField}
                  </Badge>
                  <button
                    onClick={() => handleClear(mapping.csvHeader)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Clear mapping"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <Select
                  value=""
                  onValueChange={(val) => handleFieldChange(mapping.csvHeader, val)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <span className="text-muted-foreground">Select field...</span>
                  </SelectTrigger>
                  <SelectContent>
                    {fields
                      .filter((f) => !assignedTargets.has(f.value))
                      .map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                          {f.required && " *"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        ))}
      </div>

      {missingRequired.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
          <p className="text-xs text-destructive font-medium">
            Missing required mappings:
          </p>
          <ul className="text-xs text-destructive/80 mt-1 space-y-0.5">
            {missingRequired.map((f) => (
              <li key={f.value}>- {f.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { autoMap, getFieldsForType };
export type { FieldMapping };
export default FieldMapper;
