import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowRight,
    BarChart3,
    Check,
    Code,
    Copy,
    Eye,
    EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateTrackingSnippet } from "@/lib/utils";

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

type OnboardingStep = "create" | "configure";

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
        enabled: !!project?.id && step === "configure",
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

    function handleContinue() {
        navigate("/app", { replace: true });
    }

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-4xl space-y-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center">
                        <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold text-foreground">
                            Get set up
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Step {step === "create" ? "1" : "2"} of 2
                        </p>
                    </div>
                </div>

                {step === "create" ? (
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
                ) : (
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

                            <div className="pt-2">
                                <Button onClick={handleContinue} className="w-full">
                                    Continue to dashboard
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                                {project && (
                                    <Button asChild variant="ghost" className="w-full mt-2">
                                        <Link to={`/app/projects/${project.slug}/settings`}>
                                            Advanced project settings
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Onboarding;

