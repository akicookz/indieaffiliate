import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings,
  Copy,
  Check,
  Trash2,
  Code,
  Key,
  Plus,
  Eye,
  EyeOff,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  createdAt: string;
}

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface StripeConnection {
  connected: boolean;
  lastSyncAt?: string | null;
  syncStatus?: string;
  syncError?: string | null;
  createdAt?: string;
}

function ProjectSettings() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Project detail edit states
  const [projectName, setProjectName] = useState("");
  const [projectDomain, setProjectDomain] = useState("");

  // API Key states
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  // Stripe states
  const [stripeApiKey, setStripeApiKey] = useState("");
  const [showStripeKey, setShowStripeKey] = useState(false);

  const { data: projectsData, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);

  useEffect(() => {
    if (!project) return;
    setProjectName(project.name);
    setProjectDomain(project.domain ?? "");
  }, [project?.id]);

  const isProjectDirty = useMemo(() => {
    if (!project) return false;
    const desiredName = projectName.trim();
    const desiredDomain = projectDomain.trim();
    const currentDomain = project.domain ?? "";
    return desiredName !== project.name || desiredDomain !== currentDomain;
  }, [project, projectName, projectDomain]);

  const updateProjectMutation = useMutation({
    mutationFn: async (updates: { name?: string; domain?: string | null }) => {
      const response = await fetch(`/api/projects/${project!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to update project");
      }
      return response.json() as Promise<{ project: Project }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Keep local state in sync immediately
      setProjectName(data.project.name);
      setProjectDomain(data.project.domain ?? "");
    },
  });

  function handleSaveProjectDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;

    const desiredName = projectName.trim();
    const desiredDomain = projectDomain.trim();

    const updates: { name?: string; domain?: string | null } = {};
    if (desiredName && desiredName !== project.name) {
      updates.name = desiredName;
    }

    const currentDomain = project.domain ?? "";
    if (desiredDomain !== currentDomain) {
      updates.domain = desiredDomain ? desiredDomain : null;
    }

    if (Object.keys(updates).length === 0) return;
    updateProjectMutation.mutate(updates);
  }

  function handleResetProjectDetails() {
    if (!project) return;
    setProjectName(project.name);
    setProjectDomain(project.domain ?? "");
  }

  // API Keys query
  const { data: apiKeysData } = useQuery({
    queryKey: ["api-keys", project?.id],
    queryFn: async (): Promise<{ keys: ApiKey[] }> => {
      const response = await fetch(`/api/api-keys?project=${project!.id}`);
      if (!response.ok) throw new Error("Failed to fetch API keys");
      return response.json();
    },
    enabled: !!project?.id,
  });

  // Stripe connection query
  const { data: stripeData } = useQuery({
    queryKey: ["stripe-connection", project?.id],
    queryFn: async (): Promise<StripeConnection> => {
      const response = await fetch(`/api/projects/${project!.id}/stripe`);
      if (!response.ok) throw new Error("Failed to fetch Stripe status");
      return response.json();
    },
    enabled: !!project?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete project");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/app");
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async ({ projectId, name }: { projectId: string; name: string }) => {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to create API key");
      }
      return response.json() as Promise<{ key: string; id: string; prefix: string; name: string; createdAt: string }>;
    },
    onSuccess: (data) => {
      setGeneratedKey(data.key);
      setNewKeyName("");
      setShowNewKeyForm(false);
      queryClient.invalidateQueries({ queryKey: ["api-keys", project?.id] });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to revoke API key");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys", project?.id] });
    },
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
        throw new Error(data.error ?? "Failed to connect Stripe");
      }
      return response.json();
    },
    onSuccess: () => {
      setStripeApiKey("");
      queryClient.invalidateQueries({ queryKey: ["stripe-connection", project?.id] });
    },
  });

  const disconnectStripeMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`/api/projects/${projectId}/stripe`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to disconnect Stripe");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stripe-connection", project?.id] });
    },
  });

  const syncStripeMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`/api/projects/${projectId}/stripe/sync`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to sync");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stripe-connection", project?.id] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-foreground/70">Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Project not found</div>
      </div>
    );
  }

  const trackingSnippet = `<script>
(function() {
  var ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) {
    document.cookie = '__ia_ref=' + ref + ';path=/;max-age=' + (30*24*60*60) + ';SameSite=Lax;Secure';
    fetch('${window.location.origin}/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode: ref,
        landingPage: window.location.href
      })
    });
  }
})();
</script>`;

  function handleCopySnippet() {
    navigator.clipboard.writeText(trackingSnippet).then(() => {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    });
  }

  function handleCopyKey() {
    navigator.clipboard.writeText(generatedKey).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  }

  function handleDelete() {
    if (!project) return;
    if (
      confirm(
        `Are you sure you want to delete "${project.name}"? This will delete all partners, customers, and data associated with this project.`,
      )
    ) {
      deleteMutation.mutate(project.id);
    }
  }

  function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !newKeyName.trim()) return;
    setGeneratedKey("");
    createKeyMutation.mutate({ projectId: project.id, name: newKeyName.trim() });
  }

  function handleRevokeKey(keyId: string) {
    if (confirm("Are you sure you want to revoke this API key? Any integrations using it will stop working.")) {
      revokeKeyMutation.mutate(keyId);
    }
  }

  function handleConnectStripe(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !stripeApiKey.trim()) return;
    connectStripeMutation.mutate({ projectId: project.id, apiKey: stripeApiKey.trim() });
  }

  function handleDisconnectStripe() {
    if (!project) return;
    if (confirm("Are you sure you want to disconnect Stripe? Automatic sync will stop.")) {
      disconnectStripeMutation.mutate(project.id);
    }
  }

  function handleSyncStripe() {
    if (!project) return;
    syncStripeMutation.mutate(project.id);
  }

  return (
    <div className="space-y-6 bg-background max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted rounded-2xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {projectName || project.name}
          </h1>
          <p className="text-muted-foreground">Project settings</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 w-full">
        <div className="space-y-6">
          {/* Project Info */}
          <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Project Details</h3>
              {isProjectDirty && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetProjectDetails}
                  disabled={updateProjectMutation.isPending}
                >
                  Reset
                </Button>
              )}
            </div>

            <form onSubmit={handleSaveProjectDetails} className="grid gap-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={updateProjectMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={project.slug} readOnly className="bg-muted/50" />
              </div>
              <div className="space-y-2">
                <Label>Domain</Label>
                <Input
                  value={projectDomain}
                  onChange={(e) => setProjectDomain(e.target.value)}
                  placeholder="example.com"
                  disabled={updateProjectMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Leave blank to clear.
                </p>
              </div>

              {updateProjectMutation.error && (
                <p className="text-sm text-destructive">
                  {updateProjectMutation.error.message}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!isProjectDirty || updateProjectMutation.isPending}
                >
                  {updateProjectMutation.isPending ? "Saving..." : "Save"}
                </Button>
                {isProjectDirty && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetProjectDetails}
                    disabled={updateProjectMutation.isPending}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </div>

          {/* API Keys */}
          <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">API Keys</h3>
              </div>
              {!showNewKeyForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNewKeyForm(true);
                    setGeneratedKey("");
                  }}
                >
                  <Plus className="w-3 h-3 mr-1.5" />
                  New Key
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Use API keys to authenticate conversion tracking from your server.
              Keys are shown only once when created.
            </p>

            {/* Generated key banner */}
            {generatedKey && (
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Save this key now — it won't be shown again:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted/50 px-3 py-2 rounded-lg font-mono break-all">
                    {generatedKey}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleCopyKey}>
                    {copiedKey ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* New key form */}
            {showNewKeyForm && (
              <form onSubmit={handleCreateKey} className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label>Key Name</Label>
                  <Input
                    placeholder="e.g. Production Server"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createKeyMutation.isPending}
                >
                  {createKeyMutation.isPending ? "Creating..." : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewKeyForm(false);
                    setNewKeyName("");
                  }}
                >
                  Cancel
                </Button>
              </form>
            )}

            {createKeyMutation.error && (
              <p className="text-sm text-destructive">
                {createKeyMutation.error.message}
              </p>
            )}

            {/* Keys list */}
            {apiKeysData?.keys && apiKeysData.keys.length > 0 ? (
              <div className="space-y-2">
                {apiKeysData.keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{key.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {key.prefix}...
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {key.lastUsedAt && (
                        <span className="text-xs text-muted-foreground">
                          Last used{" "}
                          {new Date(key.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRevokeKey(key.id)}
                        disabled={revokeKeyMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !showNewKeyForm && (
                <p className="text-sm text-muted-foreground/70 italic">
                  No API keys yet. Create one to start tracking conversions.
                </p>
              )
            )}
          </div>

          {/* Stripe Integration */}
          <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
                </svg>
                <h3 className="text-sm font-medium text-foreground">
                  Stripe Integration
                </h3>
              </div>
              {stripeData?.connected && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  Connected
                </span>
              )}
            </div>

            {stripeData?.connected ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Stripe is connected. Charges with referral metadata are
                  automatically synced as commissions daily at 6 AM UTC.
                </p>

                {/* Sync status */}
                <div className="bg-muted/30 rounded-xl px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Sync Status
                    </span>
                    <span className="text-xs font-medium capitalize">
                      {stripeData.syncStatus ?? "idle"}
                    </span>
                  </div>
                  {stripeData.lastSyncAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Last Synced
                      </span>
                      <span className="text-xs font-medium">
                        {new Date(stripeData.lastSyncAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {stripeData.syncError && (
                    <p className="text-xs text-destructive mt-1">
                      {stripeData.syncError}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncStripe}
                    disabled={syncStripeMutation.isPending}
                  >
                    <RefreshCw
                      className={`w-3 h-3 mr-1.5 ${syncStripeMutation.isPending ? "animate-spin" : ""}`}
                    />
                    {syncStripeMutation.isPending ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={handleDisconnectStripe}
                    disabled={disconnectStripeMutation.isPending}
                  >
                    <Unplug className="w-3 h-3 mr-1.5" />
                    Disconnect
                  </Button>
                </div>

                {syncStripeMutation.error && (
                  <p className="text-sm text-destructive">
                    {syncStripeMutation.error.message}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connect your Stripe account to automatically track payments and
                  create commissions for referred customers. Use a restricted API key
                  with read access to charges.
                </p>

                <form onSubmit={handleConnectStripe} className="space-y-3">
                  <div className="space-y-2">
                    <Label>Stripe Secret Key</Label>
                    <div className="relative">
                      <Input
                        type={showStripeKey ? "text" : "password"}
                        placeholder="sk_live_..."
                        value={stripeApiKey}
                        onChange={(e) => setStripeApiKey(e.target.value)}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowStripeKey(!showStripeKey)}
                        aria-label={showStripeKey ? "Hide key" : "Show key"}
                      >
                        {showStripeKey ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={connectStripeMutation.isPending}
                  >
                    {connectStripeMutation.isPending
                      ? "Connecting..."
                      : "Connect Stripe"}
                  </Button>
                </form>

                {connectStripeMutation.error && (
                  <p className="text-sm text-destructive">
                    {connectStripeMutation.error.message}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="shadow-xs bg-card/50 rounded-2xl  p-6 space-y-4 border border-destructive/20">
            <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
            <p className="text-sm text-muted-foreground">
              Deleting this project will permanently remove all associated partners,
              customers, clicks, and commissions. This action cannot be undone.
            </p>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleteMutation.isPending ? "Deleting..." : "Delete Project"}
            </Button>
            {deleteMutation.error && (
              <p className="text-sm text-destructive">
                {deleteMutation.error.message}
              </p>
            )}
          </div>
        </div>

        {/* Tracking Snippet */}
        <div className="space-y-6 lg:sticky lg:top-6 self-start">
          <div className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">
                  Tracking Snippet
                </h3>
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
              Add this snippet to your website&apos;s &lt;head&gt; tag to enable
              automatic referral tracking via{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                ?ref=CODE
              </code>{" "}
              query parameters.
            </p>
            <pre className="bg-muted/50 border border-border rounded-xl p-4 text-xs overflow-x-auto font-mono">
              {trackingSnippet}
            </pre>
          </div>
        </div>
      </div>

    </div>
  );
}

export default ProjectSettings;
