import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";
import FieldMapper, { autoMap, getFieldsForType, type FieldMapping } from "@/components/FieldMapper";
import PartnerAssignmentTable, {
  type ReferralCodeGroup,
  type ExistingPartner,
  type Assignment,
  type NewPartnerForm,
} from "@/components/PartnerAssignmentTable";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface StripeConnection {
  connected: boolean;
}

interface ImportResult {
  created: { partners: number; customers: number; commissions: number };
  skipped: Array<{ row: number; reason: string; type: string }>;
  errors: Array<{ row: number; error: string; type: string }>;
}

interface StripeImportPreview {
  referralCodes: Array<{
    code: string;
    matchedPartnerId: string | null;
    matchedPartnerName: string | null;
    subscriptionCount: number;
    totalRevenue: number;
    customers: Array<{
      email: string;
      name: string | null;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      revenue: number;
      status: string;
    }>;
  }>;
  totals: {
    subscriptions: number;
    uniqueCustomers: number;
    totalRevenue: number;
    matchedCodes: number;
    unmatchedCodes: number;
  };
}

type ImportSource = "csv" | "stripe";
type CsvImportType = "partners" | "customers" | "commissions";
type Step = "source" | "csv-upload" | "csv-map" | "csv-confirm" | "stripe-config" | "stripe-assign" | "stripe-confirm" | "result";

interface ImportDialogProps {
  projects: Project[];
}

// ─── Component ────────────────────────────────────────────────────────────────

function ImportDialog({ projects }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("source");
  const queryClient = useQueryClient();

  // Shared state
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [importSource, setImportSource] = useState<ImportSource>("csv");

  // CSV state
  const [csvImportType, setCsvImportType] = useState<CsvImportType>("partners");
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [commissionMode, setCommissionMode] = useState<"csv" | "recalculate">("csv");
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);

  // Stripe state
  const [stripeStatus, setStripeStatus] = useState<"active" | "canceled" | "all">("all");
  const [stripeCreatedAfter, setStripeCreatedAfter] = useState("");
  const [stripeCreatedBefore, setStripeCreatedBefore] = useState("");
  const [stripePreview, setStripePreview] = useState<StripeImportPreview | null>(null);
  const [stripeAssignments, setStripeAssignments] = useState<Assignment[]>([]);
  const [stripeResult, setStripeResult] = useState<ImportResult | null>(null);

  // Partner creation state for the assignment table
  const [creatingPartner, setCreatingPartner] = useState(false);

  // Fetch existing partners for assignment
  const { data: partnersData } = useQuery({
    queryKey: ["partners-for-import", selectedProjectId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("project", selectedProjectId);
      const response = await fetch(`/api/partners?${params}`);
      if (!response.ok) throw new Error("Failed to fetch partners");
      return response.json() as Promise<{
        partners: Array<{
          id: string;
          name: string;
          email: string;
          referralCode: string;
        }>;
      }>;
    },
    enabled: open && !!selectedProjectId,
  });

  // Check Stripe connection for the selected project
  const { data: stripeData } = useQuery({
    queryKey: ["stripe-connection-import", selectedProjectId],
    queryFn: async (): Promise<StripeConnection> => {
      const response = await fetch(`/api/projects/${selectedProjectId}/stripe`);
      if (!response.ok) throw new Error("Failed to check Stripe");
      return response.json();
    },
    enabled: open && !!selectedProjectId,
  });

  const existingPartners: ExistingPartner[] = (partnersData?.partners ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    referralCode: p.referralCode,
  }));

  // CSV import mutation
  const csvImportMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Import failed");
      }
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setCsvResult(data);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Stripe preview mutation
  const stripePreviewMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/import/stripe-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          filters: {
            status: stripeStatus,
            createdAfter: stripeCreatedAfter || undefined,
            createdBefore: stripeCreatedBefore || undefined,
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Preview failed");
      }
      return response.json() as Promise<StripeImportPreview>;
    },
    onSuccess: (data) => {
      setStripePreview(data);
      // Auto-assign matched codes
      const autoAssignments: Assignment[] = data.referralCodes
        .filter((rc) => rc.matchedPartnerId)
        .map((rc) => ({
          referralCode: rc.code,
          partnerId: rc.matchedPartnerId!,
          action: "link" as const,
        }));
      setStripeAssignments(autoAssignments);
      setStep("stripe-assign");
    },
  });

  // Stripe execute mutation
  const stripeExecuteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/import/stripe-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          assignments: stripeAssignments,
          filters: {
            status: stripeStatus,
            createdAfter: stripeCreatedAfter || undefined,
            createdBefore: stripeCreatedBefore || undefined,
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Import failed");
      }
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setStripeResult(data);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // ─── CSV Handling ───────────────────────────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as string[][];
        if (data.length < 2) return;

        const headers = data[0];
        setCsvHeaders(headers);
        setCsvData(data.slice(1).filter((row) => row.some((cell) => cell.trim())));

        // Auto-map fields
        const fields = getFieldsForType(csvImportType);
        const mapped = autoMap(headers, fields);
        setFieldMappings(mapped);

        setStep("csv-map");
      },
      error: () => {
        // handle silently
      },
    });
  }

  function handleCsvImportTypeChange(type: CsvImportType) {
    setCsvImportType(type);
    if (csvHeaders.length > 0) {
      const fields = getFieldsForType(type);
      const mapped = autoMap(csvHeaders, fields);
      setFieldMappings(mapped);
    }
  }

  function buildCsvPayload() {
    // Build the mapping: csvColumnIndex -> targetField
    const colMap = new Map<number, string>();
    for (const mapping of fieldMappings) {
      if (mapping.targetField) {
        const idx = csvHeaders.indexOf(mapping.csvHeader);
        if (idx >= 0) colMap.set(idx, mapping.targetField);
      }
    }

    const rows = csvData.map((row) => {
      const obj: Record<string, string | number> = {};
      for (const [idx, field] of colMap.entries()) {
        const value = row[idx]?.trim() ?? "";
        // Convert numeric fields
        if (["commissionRate", "revenue", "amount"].includes(field)) {
          const num = parseFloat(value);
          if (!isNaN(num)) {
            // If commissionRate looks like a percentage (e.g. 20), convert to decimal
            if (field === "commissionRate" && num > 1) {
              obj[field] = num / 100;
            } else {
              obj[field] = num;
            }
          }
        } else {
          obj[field] = value;
        }
      }
      return obj;
    }).filter((obj) => Object.keys(obj).length > 0);

    const payload: Record<string, unknown> = {
      projectId: selectedProjectId,
      partners: csvImportType === "partners" ? rows : [],
      customers: csvImportType === "customers" ? rows : [],
      commissions: csvImportType === "commissions" ? rows : [],
      options: { commissionMode },
    };

    return payload;
  }

  function handleCsvConfirm() {
    const payload = buildCsvPayload();
    csvImportMutation.mutate(payload);
  }

  // ─── Partner creation from Stripe assign table ──────────────────────────────

  async function handleCreatePartner(form: NewPartnerForm, referralCode: string): Promise<string | null> {
    setCreatingPartner(true);
    try {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          name: form.name,
          email: form.email,
          commissionRate: form.commissionRate,
          referralCode,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { partner: { id: string } };
      queryClient.invalidateQueries({ queryKey: ["partners-for-import"] });
      return data.partner.id;
    } catch {
      return null;
    } finally {
      setCreatingPartner(false);
    }
  }

  // ─── Reset ──────────────────────────────────────────────────────────────────

  function handleReset() {
    setStep("source");
    setCsvData([]);
    setCsvHeaders([]);
    setFieldMappings([]);
    setCsvResult(null);
    setStripePreview(null);
    setStripeAssignments([]);
    setStripeResult(null);
  }

  function handleClose() {
    setOpen(false);
    handleReset();
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  const csvMappingsValid = (() => {
    const fields = getFieldsForType(csvImportType);
    const required = fields.filter((f) => f.required).map((f) => f.value);
    const assigned = new Set(fieldMappings.filter((m) => m.targetField).map((m) => m.targetField!));
    return required.every((r) => assigned.has(r));
  })();

  const stripeAllAssigned = stripePreview
    ? stripePreview.referralCodes.every((rc) => {
        if (rc.matchedPartnerId) return true;
        const a = stripeAssignments.find(
          (sa) => sa.referralCode.toUpperCase() === rc.code.toUpperCase(),
        );
        return a && (a.action === "skip" || a.partnerId);
      })
    : false;

  const result = csvResult || stripeResult;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-4 h-4 mr-2" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "source" && "Import Affiliates"}
            {step === "csv-upload" && "Upload CSV File"}
            {step === "csv-map" && "Map CSV Fields"}
            {step === "csv-confirm" && "Confirm CSV Import"}
            {step === "stripe-config" && "Configure Stripe Import"}
            {step === "stripe-assign" && "Assign Partners"}
            {step === "stripe-confirm" && "Confirm Stripe Import"}
            {step === "result" && "Import Complete"}
          </DialogTitle>
        </DialogHeader>

        {/* Step: Choose Source */}
        {step === "source" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <span>
                    {projects.find((p) => p.id === selectedProjectId)?.name ?? "Select project"}
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

            <p className="text-sm text-muted-foreground">
              Choose how you want to import your existing affiliates:
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-colors ${
                  importSource === "csv"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
                onClick={() => setImportSource("csv")}
              >
                <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">CSV File</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload a CSV with partner, customer, or commission data
                  </p>
                </div>
              </button>

              <button
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-colors ${
                  importSource === "stripe"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                } ${!stripeData?.connected ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => stripeData?.connected && setImportSource("stripe")}
                disabled={!stripeData?.connected}
              >
                <svg className="w-8 h-8 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium">Stripe Subscriptions</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stripeData?.connected
                      ? "Scan subscription metadata for referral codes"
                      : "Connect Stripe first in Project Settings"}
                  </p>
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(importSource === "csv" ? "csv-upload" : "stripe-config")}
                disabled={!selectedProjectId || (importSource === "stripe" && !stripeData?.connected)}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step: CSV Upload */}
        {step === "csv-upload" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>What are you importing?</Label>
              <Select value={csvImportType} onValueChange={(v) => handleCsvImportTypeChange(v as CsvImportType)}>
                <SelectTrigger>
                  <span>
                    {csvImportType === "partners" && "Partners / Affiliates"}
                    {csvImportType === "customers" && "Customers"}
                    {csvImportType === "commissions" && "Commissions"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="partners">Partners / Affiliates</SelectItem>
                  <SelectItem value="customers">Customers</SelectItem>
                  <SelectItem value="commissions">Commissions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                Drop your CSV file here or click to browse
              </p>
              <Input
                type="file"
                accept=".csv,.tsv"
                onChange={handleFileUpload}
                className="max-w-xs mx-auto"
              />
            </div>

            {csvImportType === "commissions" && (
              <div className="space-y-2">
                <Label>Commission Mode</Label>
                <Select value={commissionMode} onValueChange={(v) => setCommissionMode(v as "csv" | "recalculate")}>
                  <SelectTrigger>
                    <span>
                      {commissionMode === "csv" ? "Use CSV amounts as-is" : "Recalculate from partner rate"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">Use CSV amounts as-is</SelectItem>
                    <SelectItem value="recalculate">Recalculate from partner commission rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("source")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Step: CSV Map Fields */}
        {step === "csv-map" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {csvData.length} row{csvData.length !== 1 ? "s" : ""} detected.
                Map your CSV columns to the correct fields.
              </p>
              <Badge variant="secondary" className="text-xs">
                {csvImportType}
              </Badge>
            </div>

            <FieldMapper
              mappings={fieldMappings}
              onMappingsChange={setFieldMappings}
              importType={csvImportType}
            />

            {/* Preview first rows */}
            {csvData.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview (first 3 rows):
                </p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        {csvHeaders.map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-t border-border">
                          {row.map((cell, j) => (
                            <td key={j} className="px-3 py-2 text-muted-foreground">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("csv-upload")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => setStep("csv-confirm")}
                disabled={!csvMappingsValid}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step: CSV Confirm */}
        {step === "csv-confirm" && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-xl p-4 space-y-2">
              <p className="text-sm font-medium">Import Summary</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  Project: <span className="font-medium text-foreground">{projects.find((p) => p.id === selectedProjectId)?.name}</span>
                </li>
                <li>
                  Type: <span className="font-medium text-foreground capitalize">{csvImportType}</span>
                </li>
                <li>
                  Rows: <span className="font-medium text-foreground">{csvData.length}</span>
                </li>
                {csvImportType === "commissions" && (
                  <li>
                    Mode: <span className="font-medium text-foreground">
                      {commissionMode === "csv" ? "Use CSV amounts" : "Recalculate from rate"}
                    </span>
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Field Mappings:</p>
              <div className="flex flex-wrap gap-1.5">
                {fieldMappings
                  .filter((m) => m.targetField)
                  .map((m) => (
                    <Badge key={m.csvHeader} variant="secondary" className="text-xs">
                      {m.csvHeader} → {m.targetField}
                    </Badge>
                  ))}
              </div>
            </div>

            {csvImportMutation.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{csvImportMutation.error.message}</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("csv-map")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleCsvConfirm}
                disabled={csvImportMutation.isPending}
              >
                {csvImportMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import {csvData.length} rows
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Stripe Config */}
        {step === "stripe-config" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan your Stripe subscriptions for referral metadata.
              Configure filters to narrow down the subscriptions to scan.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Subscription Status</Label>
                <Select value={stripeStatus} onValueChange={(v) => setStripeStatus(v as "active" | "canceled" | "all")}>
                  <SelectTrigger className="h-9">
                    <span className="capitalize">{stripeStatus}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Created After</Label>
                <Input
                  type="date"
                  value={stripeCreatedAfter}
                  onChange={(e) => setStripeCreatedAfter(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Created Before</Label>
                <Input
                  type="date"
                  value={stripeCreatedBefore}
                  onChange={(e) => setStripeCreatedBefore(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {stripePreviewMutation.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{stripePreviewMutation.error.message}</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("source")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => stripePreviewMutation.mutate()}
                disabled={stripePreviewMutation.isPending}
              >
                {stripePreviewMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    Scan Subscriptions
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Stripe Assign Partners */}
        {step === "stripe-assign" && stripePreview && (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-muted/30 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-semibold">{stripePreview.totals.subscriptions}</p>
                <p className="text-xs text-muted-foreground">Subscriptions</p>
              </div>
              <div className="bg-muted/30 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-semibold">{stripePreview.totals.uniqueCustomers}</p>
                <p className="text-xs text-muted-foreground">Customers</p>
              </div>
              <div className="bg-muted/30 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-semibold">${stripePreview.totals.totalRevenue.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Revenue</p>
              </div>
              <div className="bg-muted/30 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-semibold">
                  {stripePreview.totals.matchedCodes}/{stripePreview.referralCodes.length}
                </p>
                <p className="text-xs text-muted-foreground">Matched</p>
              </div>
            </div>

            {stripePreview.referralCodes.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  No subscriptions with referral metadata found. Check your metadata key
                  configuration in Project Settings.
                </p>
              </div>
            ) : (
              <PartnerAssignmentTable
                referralCodes={stripePreview.referralCodes as ReferralCodeGroup[]}
                existingPartners={existingPartners}
                assignments={stripeAssignments}
                onAssignmentsChange={setStripeAssignments}
                onCreatePartner={handleCreatePartner}
                creatingPartner={creatingPartner}
              />
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("stripe-config")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => setStep("stripe-confirm")}
                disabled={!stripeAllAssigned || stripePreview.referralCodes.length === 0}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step: Stripe Confirm */}
        {step === "stripe-confirm" && stripePreview && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-xl p-4 space-y-2">
              <p className="text-sm font-medium">Import Summary</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  Project: <span className="font-medium text-foreground">{projects.find((p) => p.id === selectedProjectId)?.name}</span>
                </li>
                <li>
                  Subscriptions to import: <span className="font-medium text-foreground">{stripePreview.totals.subscriptions}</span>
                </li>
                <li>
                  Unique customers: <span className="font-medium text-foreground">{stripePreview.totals.uniqueCustomers}</span>
                </li>
                <li>
                  Partners assigned: <span className="font-medium text-foreground">
                    {stripeAssignments.filter((a) => a.action === "link").length}
                  </span>
                </li>
                <li>
                  Codes skipped: <span className="font-medium text-foreground">
                    {stripeAssignments.filter((a) => a.action === "skip").length}
                  </span>
                </li>
              </ul>
            </div>

            {stripeExecuteMutation.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{stripeExecuteMutation.error.message}</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("stripe-assign")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => stripeExecuteMutation.mutate()}
                disabled={stripeExecuteMutation.isPending}
              >
                {stripeExecuteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === "result" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <Check className="w-5 h-5" />
              <p className="text-sm font-medium">Import completed</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-semibold text-green-600">{result.created.partners}</p>
                <p className="text-xs text-muted-foreground">Partners Created</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-semibold text-green-600">{result.created.customers}</p>
                <p className="text-xs text-muted-foreground">Customers Created</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-semibold text-green-600">{result.created.commissions}</p>
                <p className="text-xs text-muted-foreground">Commissions Created</p>
              </div>
            </div>

            {result.skipped.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-600">
                  {result.skipped.length} row{result.skipped.length !== 1 ? "s" : ""} skipped:
                </p>
                <div className="max-h-32 overflow-y-auto bg-muted/30 rounded-xl p-3 space-y-1">
                  {result.skipped.slice(0, 20).map((s, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      Row {s.row + 1} ({s.type}): {s.reason}
                    </p>
                  ))}
                  {result.skipped.length > 20 && (
                    <p className="text-xs text-muted-foreground italic">
                      ...and {result.skipped.length - 20} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-destructive">
                  {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}:
                </p>
                <div className="max-h-32 overflow-y-auto bg-destructive/5 rounded-xl p-3 space-y-1">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <p key={i} className="text-xs text-destructive/80">
                      Row {e.row + 1} ({e.type}): {e.error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleReset}>
                Import More
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ImportDialog;
