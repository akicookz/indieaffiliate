import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Users,
} from "lucide-react";
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
import StripeCustomerTable from "@/components/StripeCustomerTable";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface PartnerForAssign {
  id: string;
  name: string;
  email: string;
  referralCode: string;
}

interface StripeConnection {
  connected: boolean;
}

interface ImportResult {
  created: { partners: number; customers: number; commissions: number };
  skipped: Array<{ row: number; reason: string; type: string }>;
  errors: Array<{ row: number; error: string; type: string }>;
}

type CsvImportType = "partners" | "customers" | "commissions";
type CsvStep = "upload" | "map" | "confirm" | "result";

// ─── CSV Import Section ───────────────────────────────────────────────────────

function CsvImportSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<CsvStep>("upload");
  const [csvImportType, setCsvImportType] = useState<CsvImportType>("partners");
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [commissionMode, setCommissionMode] = useState<"csv" | "recalculate">("csv");
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);

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

        const fields = getFieldsForType(csvImportType);
        const mapped = autoMap(headers, fields);
        setFieldMappings(mapped);

        setStep("map");
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
        if (["commissionRate", "revenue", "amount"].includes(field)) {
          const num = parseFloat(value);
          if (!isNaN(num)) {
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

    return {
      projectId: project.id,
      partners: csvImportType === "partners" ? rows : [],
      customers: csvImportType === "customers" ? rows : [],
      commissions: csvImportType === "commissions" ? rows : [],
      options: { commissionMode },
    };
  }

  function handleCsvConfirm() {
    csvImportMutation.mutate(buildCsvPayload());
  }

  function handleReset() {
    setStep("upload");
    setCsvData([]);
    setCsvHeaders([]);
    setFieldMappings([]);
    setCsvResult(null);
    csvImportMutation.reset();
  }

  const csvMappingsValid = (() => {
    const fields = getFieldsForType(csvImportType);
    const required = fields.filter((f) => f.required).map((f) => f.value);
    const assigned = new Set(fieldMappings.filter((m) => m.targetField).map((m) => m.targetField!));
    return required.every((r) => assigned.has(r));
  })();

  return (
    <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">CSV Import</h3>
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload a CSV file to import partners, customers, or commissions.
          </p>

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
        </div>
      )}

      {/* Step: Map Fields */}
      {step === "map" && (
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
            <Button variant="outline" onClick={handleReset}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={() => setStep("confirm")}
              disabled={!csvMappingsValid}
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Confirm */}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="bg-muted/30 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium">Import Summary</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                Project: <span className="font-medium text-foreground">{project.name}</span>
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
                    {m.csvHeader} &rarr; {m.targetField}
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
            <Button variant="outline" onClick={() => setStep("map")}>
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

      {/* Step: Result */}
      {step === "result" && csvResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-600">
            <Check className="w-5 h-5" />
            <p className="text-sm font-medium">Import completed</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-semibold text-green-600">{csvResult.created.partners}</p>
              <p className="text-xs text-muted-foreground">Partners Created</p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-semibold text-green-600">{csvResult.created.customers}</p>
              <p className="text-xs text-muted-foreground">Customers Created</p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-semibold text-green-600">{csvResult.created.commissions}</p>
              <p className="text-xs text-muted-foreground">Commissions Created</p>
            </div>
          </div>

          {csvResult.skipped.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-600">
                {csvResult.skipped.length} row{csvResult.skipped.length !== 1 ? "s" : ""} skipped:
              </p>
              <div className="max-h-32 overflow-y-auto bg-muted/30 rounded-xl p-3 space-y-1">
                {csvResult.skipped.slice(0, 20).map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    Row {s.row + 1} ({s.type}): {s.reason}
                  </p>
                ))}
                {csvResult.skipped.length > 20 && (
                  <p className="text-xs text-muted-foreground italic">
                    ...and {csvResult.skipped.length - 20} more
                  </p>
                )}
              </div>
            </div>
          )}

          {csvResult.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-destructive">
                {csvResult.errors.length} error{csvResult.errors.length !== 1 ? "s" : ""}:
              </p>
              <div className="max-h-32 overflow-y-auto bg-destructive/5 rounded-xl p-3 space-y-1">
                {csvResult.errors.slice(0, 20).map((e, i) => (
                  <p key={i} className="text-xs text-destructive/80">
                    Row {e.row + 1} ({e.type}): {e.error}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={handleReset}>
              Import More
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StripeIcon() {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
    </svg>
  );
}

// ─── Stripe Customer Browse ────────────────────────────────────────────────────

function StripeCustomerBrowseSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();

  const { data: stripeData } = useQuery({
    queryKey: ["stripe-connection-import", project.id],
    queryFn: async (): Promise<StripeConnection> => {
      const response = await fetch(`/api/projects/${project.id}/stripe`);
      if (!response.ok) throw new Error("Failed to fetch Stripe status");
      return response.json();
    },
  });

  const { data: partnersData } = useQuery({
    queryKey: ["partners-for-assign", project.id],
    queryFn: async (): Promise<{ partners: PartnerForAssign[] }> => {
      const response = await fetch(`/api/partners?project=${project.id}`);
      if (!response.ok) throw new Error("Failed to fetch partners");
      return response.json();
    },
  });

  const projectPartners = partnersData?.partners ?? [];

  if (!stripeData?.connected) {
    return (
      <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <StripeIcon />
          <h3 className="text-sm font-medium text-foreground">Stripe Customers</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Stripe is not connected for this project. Connect Stripe in{" "}
          <a
            href={`/app/projects/${project.slug}/settings`}
            className="text-primary hover:underline"
          >
            Project Settings
          </a>{" "}
          to browse customers and sync purchases.
        </p>
      </div>
    );
  }

  return (
    <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Stripe Customers</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          Connected
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Browse your Stripe customers, select them, and assign a partner to sync their full purchase history as commissions.
      </p>

      <StripeCustomerTable
        projectId={project.id}
        partners={projectPartners}
        onPartnerCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["partners-for-assign", project.id] });
        }}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function Import() {
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const { data: projectsData, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const projects = projectsData?.projects ?? [];
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-background">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Import</h1>
        <p className="text-muted-foreground">
          Sync from Stripe or import data via CSV
        </p>
      </div>

      {/* Project Selector */}
      <div className="w-64">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Project</Label>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="bg-card">
            <span>
              {selectedProject?.name ?? "Select project"}
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

      {selectedProject && (
        <div className="space-y-6">
          <StripeCustomerBrowseSection project={selectedProject} />
          <CsvImportSection project={selectedProject} />
        </div>
      )}
    </div>
  );
}

export default Import;
