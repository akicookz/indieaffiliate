import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  Code,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  UserPlus,
} from "lucide-react";
import Papa from "papaparse";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { generateTrackingSnippet } from "@/lib/utils";
import StripeCustomerTable from "@/components/StripeCustomerTable";

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
}

interface StripeConnection {
  connected: boolean;
  lastSyncAt?: string | null;
  syncStatus?: string;
  syncError?: string | null;
  createdAt?: string;
}

interface PartnerForAssign {
  id: string;
  name: string;
  email: string;
  referralCode: string;
}

type OnboardingStep = "create" | "configure" | "partners" | "sync";

const STEP_LABELS: Record<OnboardingStep, string> = {
  create: "Create Project",
  configure: "Configure",
  partners: "Add Partners",
  sync: "Sync Purchases",
};

const STEP_ORDER: OnboardingStep[] = ["create", "configure", "partners", "sync"];

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<OnboardingStep>("create");
  const [projectName, setProjectName] = useState("");
  const [projectDomain, setProjectDomain] = useState("");

  const [project, setProject] = useState<Project | null>(null);

  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Stripe states
  const [stripeApiKey, setStripeApiKey] = useState("");
  const [showStripeKey, setShowStripeKey] = useState(false);

  // Partners step
  const [addedPartners, setAddedPartners] = useState<PartnerForAssign[]>([]);
  const [partnerName, setPartnerName] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerCommission, setPartnerCommission] = useState("20");
  const [csvUploading, setCsvUploading] = useState(false);

  const stepIndex = STEP_ORDER.indexOf(step);

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  useEffect(() => {
    if (projectsLoading) return;
    if (step !== "create") return;
    const projects = projectsData?.projects ?? [];
    if (projects.length > 0) {
      navigate("/app", { replace: true });
    }
  }, [projectsLoading, projectsData, navigate, step]);

  const createProjectMutation = useMutation({
    mutationFn: async (data: { name: string; domain?: string }) => {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? "Failed to create project");
      }
      return response.json() as Promise<{ project: Project }>;
    },
    onSuccess: (data) => {
      setProject(data.project);
      setStep("configure");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const { data: stripeData } = useQuery({
    queryKey: ["stripe-connection", project?.id],
    queryFn: async (): Promise<StripeConnection> => {
      const response = await fetch(`/api/projects/${project!.id}/stripe`);
      if (!response.ok) throw new Error("Failed to fetch Stripe status");
      return response.json();
    },
    enabled: !!project?.id && (step === "configure" || step === "sync"),
  });

  const connectStripeMutation = useMutation({
    mutationFn: async ({ projectId, apiKey }: { projectId: string; apiKey: string }) => {
      const response = await fetch(`/api/projects/${projectId}/stripe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to connect Stripe");
      }
      return response.json();
    },
    onSuccess: () => {
      setStripeApiKey("");
      queryClient.invalidateQueries({ queryKey: ["stripe-connection", project?.id] });
    },
  });

  // Add partner mutation
  const addPartnerMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; commissionRate: number }) => {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project!.id,
          name: data.name,
          email: data.email,
          commissionRate: data.commissionRate,
          sendInvite: false,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error((body as { error?: string }).error ?? "Failed to add partner");
      }
      return response.json() as Promise<{ partner: PartnerForAssign }>;
    },
    onSuccess: (data) => {
      setAddedPartners((prev) => [...prev, data.partner]);
      setPartnerName("");
      setPartnerEmail("");
      setPartnerCommission("20");
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partners-for-assign"] });
    },
  });

  // Fetch partners (for the sync step)
  const { data: partnersData } = useQuery({
    queryKey: ["partners-for-assign", project?.id],
    queryFn: async (): Promise<{ partners: PartnerForAssign[] }> => {
      const response = await fetch(`/api/partners?project=${project!.id}`);
      if (!response.ok) throw new Error("Failed to fetch partners");
      return response.json();
    },
    enabled: !!project?.id && (step === "partners" || step === "sync"),
  });

  const allPartners = partnersData?.partners ?? [];

  const baseUrl = useMemo(() => {
    const envUrl = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "";
    return envUrl || window.location.origin;
  }, []);

  const trackingSnippet = useMemo(() => generateTrackingSnippet(baseUrl), [baseUrl]);

  function handleCopySnippet() {
    navigator.clipboard.writeText(trackingSnippet).then(() => {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    });
  }

  function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const name = projectName.trim();
    const domain = projectDomain.trim();
    if (!name) return;
    createProjectMutation.mutate({
      name,
      ...(domain ? { domain } : {}),
    });
  }

  function handleConnectStripe(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    if (!stripeApiKey.trim()) return;
    connectStripeMutation.mutate({ projectId: project.id, apiKey: stripeApiKey.trim() });
  }

  function handleAddPartner(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerName.trim() || !partnerEmail.trim()) return;
    addPartnerMutation.mutate({
      name: partnerName.trim(),
      email: partnerEmail.trim().toLowerCase(),
      commissionRate: parseFloat(partnerCommission) / 100,
    });
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    setCsvUploading(true);

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        const rows = results.data as Record<string, string>[];
        let created = 0;

        for (const row of rows) {
          const name = (row.name ?? row.Name ?? "").trim();
          const email = (row.email ?? row.Email ?? "").trim().toLowerCase();
          if (!name || !email) continue;

          const rate = parseFloat(row.commissionRate ?? row.commission_rate ?? row.rate ?? "20");
          const commissionRate = rate > 1 ? rate / 100 : rate;

          try {
            const response = await fetch("/api/partners", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: project.id,
                name,
                email,
                commissionRate: commissionRate || 0.2,
                sendInvite: false,
              }),
            });
            if (response.ok) {
              const data = await response.json() as { partner: PartnerForAssign };
              setAddedPartners((prev) => [...prev, data.partner]);
              created++;
            }
          } catch {
            // Skip failed rows
          }
        }

        setCsvUploading(false);
        queryClient.invalidateQueries({ queryKey: ["partners"] });
        queryClient.invalidateQueries({ queryKey: ["partners-for-assign"] });

        // Reset file input
        e.target.value = "";

        if (created > 0) {
          // Provide feedback implicitly — newly added partners appear in the list
        }
      },
      error: () => {
        setCsvUploading(false);
      },
    });
  }

  function handleFinish() {
    navigate("/app", { replace: true });
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 1) {
      setStep(STEP_ORDER[idx - 1]);
    }
  }

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      setStep(STEP_ORDER[idx + 1]);
    } else {
      handleFinish();
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl space-y-6">
        {/* Header with step indicator */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Get set up
            </h1>
            <p className="text-sm text-muted-foreground">
              Step {stepIndex + 1} of {STEP_ORDER.length} &mdash; {STEP_LABELS[step]}
            </p>
          </div>
        </div>

        {/* Step progress bar */}
        <div className="flex items-center gap-2">
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* ─── Step 1: Create Project ───────────────────────────────────── */}
        {step === "create" && (
          <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-medium text-foreground">Create your first project</h2>
            <p className="text-sm text-muted-foreground">
              You can change these later in project settings.
            </p>

            <form onSubmit={handleCreateProject} className="grid gap-4">
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. My SaaS"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Domain (optional)</Label>
                <Input
                  value={projectDomain}
                  onChange={(e) => setProjectDomain(e.target.value)}
                  placeholder="example.com"
                />
              </div>

              {createProjectMutation.error && (
                <p className="text-sm text-destructive">
                  {createProjectMutation.error.message}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={createProjectMutation.isPending}>
                  {createProjectMutation.isPending ? "Creating..." : "Create project"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* ─── Step 2: Configure ────────────────────────────────────────── */}
        {step === "configure" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium text-foreground">
                    Install the tracking snippet
                  </h2>
                </div>
                <Button variant="outline" size="sm" onClick={handleCopySnippet}>
                  {copiedSnippet ? (
                    <>
                      <Check className="w-3 h-3 mr-1.5 text-green-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-1.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Paste this into your website&apos;s &lt;head&gt;. It tracks referrals via{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">?ref=CODE</code>.
              </p>
              <pre className="bg-muted/50 border border-border rounded-xl p-4 text-xs overflow-x-auto font-mono">
                {trackingSnippet}
              </pre>
            </div>

            <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">
                  Connect Stripe (optional)
                </h2>
                {stripeData?.connected && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Used to auto-sync charges with referral metadata into commissions.
              </p>

              <div className="bg-muted/30 rounded-xl px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Required restricted key permissions:
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-600 shrink-0" />
                    Charges — Read
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-600 shrink-0" />
                    Customers — Read
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-600 shrink-0" />
                    Subscriptions — Read
                  </li>
                </ul>
                <a
                  href="https://dashboard.stripe.com/apikeys/create?name=UnlockAffiliate&permissions[]=rak_charge_read&permissions[]=rak_invoice_read&permissions[]=rak_customer_read&permissions[]=rak_subscription_read"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline mt-1"
                >
                  Create restricted key in Stripe Dashboard
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              </div>

              <form onSubmit={handleConnectStripe} className="space-y-3">
                <div className="space-y-2">
                  <Label>Stripe restricted key</Label>
                  <div className="relative">
                    <Input
                      type={showStripeKey ? "text" : "password"}
                      placeholder="rk_live_..."
                      value={stripeApiKey}
                      onChange={(e) => setStripeApiKey(e.target.value)}
                      className="pr-10"
                      disabled={!!stripeData?.connected}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowStripeKey(!showStripeKey)}
                      aria-label={showStripeKey ? "Hide key" : "Show key"}
                      disabled={!!stripeData?.connected}
                    >
                      {showStripeKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {connectStripeMutation.error && (
                  <p className="text-sm text-destructive">
                    {connectStripeMutation.error.message}
                  </p>
                )}

                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={
                    connectStripeMutation.isPending ||
                    !!stripeData?.connected ||
                    !stripeApiKey.trim()
                  }
                >
                  {connectStripeMutation.isPending ? "Connecting..." : "Connect Stripe"}
                </Button>
              </form>

              <div className="pt-2 space-y-2">
                <Button onClick={goNext} className="w-full">
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {project && (
                  <Button asChild variant="ghost" className="w-full">
                    <Link to={`/app/projects/${project.slug}/settings`}>
                      Advanced project settings
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 3: Add Partners ─────────────────────────────────────── */}
        {step === "partners" && (
          <div className="space-y-6">
            <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-medium text-foreground">Add Partners</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Add your affiliates or referral partners. You can also do this later.
              </p>

              {/* Inline add partner form */}
              <form onSubmit={handleAddPartner} className="grid gap-3 sm:grid-cols-4 sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    placeholder="Partner name"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    placeholder="partner@example.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Commission (%)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={partnerCommission}
                    onChange={(e) => setPartnerCommission(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={addPartnerMutation.isPending}>
                  {addPartnerMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-1.5" />
                      Add
                    </>
                  )}
                </Button>
              </form>

              {addPartnerMutation.error && (
                <p className="text-sm text-destructive">
                  {addPartnerMutation.error.message}
                </p>
              )}

              {/* CSV upload */}
              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Or upload a CSV:</span>
                <div className="relative">
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    className="max-w-48 text-xs"
                    disabled={csvUploading}
                  />
                </div>
                {csvUploading && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Importing...
                  </div>
                )}
              </div>

              {/* Added partners list */}
              {addedPartners.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground">
                    {addedPartners.length} partner{addedPartners.length !== 1 ? "s" : ""} added:
                  </p>
                  <div className="space-y-1.5">
                    {addedPartners.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{p.name}</span>
                          <span className="text-xs text-muted-foreground truncate">{p.email}</span>
                          <Badge variant="secondary" className="text-xs font-mono shrink-0">
                            {p.referralCode}
                          </Badge>
                        </div>
                        <button
                          onClick={() => setAddedPartners((prev) => prev.filter((x) => x.id !== p.id))}
                          className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                          aria-label="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={goNext}>
                  Skip
                </Button>
                <Button onClick={goNext}>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 4: Sync Stripe Purchases ────────────────────────────── */}
        {step === "sync" && (
          <div className="space-y-6">
            {stripeData?.connected && project ? (
              <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <StripeIcon />
                  <h2 className="text-sm font-medium text-foreground">
                    Sync Stripe Purchases
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Browse your Stripe customers, select them, and assign a partner to sync their full purchase history as commissions.
                </p>

                <StripeCustomerTable
                  projectId={project.id}
                  partners={allPartners}
                  onPartnerCreated={() => {
                    queryClient.invalidateQueries({ queryKey: ["partners-for-assign", project.id] });
                  }}
                />
              </div>
            ) : (
              <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <StripeIcon />
                  <h2 className="text-sm font-medium text-foreground">
                    Sync Stripe Purchases
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Stripe is not connected. You can connect Stripe later in{" "}
                  <span className="font-medium text-foreground">Project Settings</span>{" "}
                  and sync purchases from the{" "}
                  <span className="font-medium text-foreground">Import</span> page.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleFinish}>
                  Skip
                </Button>
                <Button onClick={handleFinish}>
                  Continue to dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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

export default Onboarding;
