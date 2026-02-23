import { useState, Fragment } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook,
  Plus,
  Pencil,
  Trash2,
  Send,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const WEBHOOK_EVENT_OPTIONS = [
  "partner.created",
  "partner.approved",
  "customer.created",
  "commission.created",
  "commission.approved",
  "payout.created",
  "click.recorded",
] as const;

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface WebhookEndpoint {
  id: string;
  projectId: string;
  url: string;
  secret: string;
  events: string;
  isActive: boolean;
  createdAt: string;
}

interface WebhookLog {
  id: string;
  event: string;
  statusCode: number | null;
  attempt: number;
  createdAt: string;
  payload: string;
  responseBody: string | null;
}

function parseEvents(eventsJson: string): string[] {
  try {
    const arr = JSON.parse(eventsJson) as unknown;
    return Array.isArray(arr) ? arr.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

function Webhooks() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState<WebhookEndpoint | null>(null);
  const [logsEndpointId, setLogsEndpointId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ["webhooks", project?.id],
    queryFn: async (): Promise<{ endpoints: WebhookEndpoint[] }> => {
      const response = await fetch(`/api/webhooks?projectId=${project!.id}`);
      if (!response.ok) throw new Error("Failed to fetch webhooks");
      return response.json();
    },
    enabled: !!project?.id,
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["webhook-logs", logsEndpointId],
    queryFn: async (): Promise<{ logs: WebhookLog[] }> => {
      const response = await fetch(`/api/webhooks/${logsEndpointId}/logs`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
    enabled: !!logsEndpointId,
  });

  const createMutation = useMutation({
    mutationFn: async (body: { projectId: string; url: string; events: string[] }) => {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to create endpoint");
      }
      return response.json() as Promise<{ endpoint: WebhookEndpoint }>;
    },
    onSuccess: (data) => {
      setCreatedSecret(data.endpoint.secret);
      queryClient.invalidateQueries({ queryKey: ["webhooks", project?.id] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      url,
      events,
      isActive,
    }: {
      id: string;
      url?: string;
      events?: string[];
      isActive?: boolean;
    }) => {
      const response = await fetch(`/api/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events, isActive }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to update endpoint");
      }
      return response.json();
    },
    onSuccess: () => {
      setEditEndpoint(null);
      queryClient.invalidateQueries({ queryKey: ["webhooks", project?.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to delete endpoint");
      }
      return response.json();
    },
    onSuccess: () => {
      if (logsEndpointId) setLogsEndpointId(null);
      queryClient.invalidateQueries({ queryKey: ["webhooks", project?.id] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error ?? "Failed to send test");
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["webhook-logs", id] });
      if (logsEndpointId === id) {
        queryClient.invalidateQueries({ queryKey: ["webhook-logs", id] });
      }
    },
  });

  if (projectsLoading || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">
          {projectsLoading ? "Loading..." : "Project not found"}
        </div>
      </div>
    );
  }

  const endpoints = endpointsData?.endpoints ?? [];
  const logs = logsData?.logs ?? [];
  const logsEndpoint = endpoints.find((e) => e.id === logsEndpointId);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
          <p className="text-muted-foreground text-sm">
            Receive events for {project.name} at your endpoints.
          </p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setCreatedSecret(""); }} className="gap-2">
          <Plus className="h-4 w-4" />
          Add endpoint
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Endpoints</CardTitle>
          <CardDescription>URLs that receive webhook payloads. Verify using the signing secret.</CardDescription>
        </CardHeader>
        <CardContent>
          {endpointsLoading ? (
            <div className="text-muted-foreground text-sm py-4">Loading endpoints...</div>
          ) : endpoints.length === 0 ? (
            <div className="text-muted-foreground text-sm py-4 rounded-lg border border-dashed bg-muted/30 p-6 text-center">
              No webhook endpoints yet. Add one to receive partner, commission, payout, and click events.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((ep) => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate" title={ep.url}>
                      {ep.url}
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-xs">
                        {parseEvents(ep.events).length} event(s)
                      </span>
                    </TableCell>
                    <TableCell>
                      {ep.isActive ? (
                        <Badge variant="default" className="bg-green-600/90">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => testMutation.mutate(ep.id)}
                          disabled={testMutation.isPending}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Test
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => setLogsEndpointId(logsEndpointId === ep.id ? null : ep.id)}
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          Logs
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => setEditEndpoint(ep)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this webhook endpoint? Delivery history will be removed.")) {
                              deleteMutation.mutate(ep.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {logsEndpoint && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Delivery log</CardTitle>
              <CardDescription className="font-mono text-xs truncate max-w-full" title={logsEndpoint.url}>
                {logsEndpoint.url}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setLogsEndpointId(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="text-muted-foreground text-sm py-4">Loading logs...</div>
            ) : logs.length === 0 ? (
              <div className="text-muted-foreground text-sm py-4">No deliveries yet. Use “Test” to send a test payload.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                      >
                        <TableCell className="w-8 p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedLogId(expandedLogId === log.id ? null : log.id);
                            }}
                          >
                            {expandedLogId === log.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.event}</TableCell>
                        <TableCell>
                          {log.statusCode != null ? (
                            <Badge variant={log.statusCode >= 200 && log.statusCode < 300 ? "default" : "destructive"}>
                              {log.statusCode}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>{log.attempt}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {expandedLogId === log.id && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={5} className="p-4">
                            <div className="grid gap-3 text-xs">
                              <div>
                                <div className="font-medium text-foreground mb-1">Payload</div>
                                <pre className="rounded bg-background border p-3 overflow-auto max-h-40 font-mono whitespace-pre-wrap break-all">
                                  {log.payload}
                                </pre>
                              </div>
                              {log.responseBody != null && (
                                <div>
                                  <div className="font-medium text-foreground mb-1">Response body</div>
                                  <pre className="rounded bg-background border p-3 overflow-auto max-h-40 font-mono whitespace-pre-wrap break-all">
                                    {log.responseBody}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreatedSecret(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
            <DialogDescription>Enter the URL that will receive POST requests with event payloads.</DialogDescription>
          </DialogHeader>
          <CreateEditForm
            key={createOpen && !createdSecret ? "create-new" : "create-done"}
            projectId={project.id}
            onSubmit={(url, events) => {
              createMutation.mutate({ projectId: project.id, url, events });
            }}
            isSubmitting={createMutation.isPending}
            error={createMutation.error?.message}
            createdSecret={createdSecret}
            onSecretCopy={() => {
              if (createdSecret) {
                navigator.clipboard.writeText(createdSecret);
                setCopiedSecret(true);
                setTimeout(() => setCopiedSecret(false), 2000);
              }
            }}
            copiedSecret={copiedSecret}
            onClose={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editEndpoint} onOpenChange={(open) => { if (!open) setEditEndpoint(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit webhook endpoint</DialogTitle>
            <DialogDescription>Update URL or subscribed events. The signing secret cannot be changed here.</DialogDescription>
          </DialogHeader>
          {editEndpoint && (
            <CreateEditForm
              projectId={editEndpoint.projectId}
              initialUrl={editEndpoint.url}
              initialEvents={parseEvents(editEndpoint.events)}
              initialIsActive={editEndpoint.isActive}
              isEdit
              onSubmit={(url, events, isActive) => {
                updateMutation.mutate({
                  id: editEndpoint.id,
                  url,
                  events,
                  isActive,
                });
              }}
              isSubmitting={updateMutation.isPending}
              error={updateMutation.error?.message}
              onClose={() => setEditEndpoint(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CreateEditFormProps {
  projectId: string;
  initialUrl?: string;
  initialEvents?: string[];
  initialIsActive?: boolean;
  isEdit?: boolean;
  onSubmit: (url: string, events: string[], isActive?: boolean) => void;
  isSubmitting: boolean;
  error?: string;
  createdSecret?: string;
  onSecretCopy?: () => void;
  copiedSecret?: boolean;
  onClose: () => void;
}

function CreateEditForm({
  initialUrl = "",
  initialEvents = [],
  initialIsActive = true,
  isEdit = false,
  onSubmit,
  isSubmitting,
  error,
  createdSecret,
  onSecretCopy,
  copiedSecret,
  onClose,
}: CreateEditFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [events, setEvents] = useState<Set<string>>(new Set(initialEvents));
  const [isActive, setIsActive] = useState(initialIsActive);

  function toggleEvent(ev: string) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eventList = Array.from(events);
    if (eventList.length === 0) return;
    if (!url.trim()) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    if (isEdit) {
      onSubmit(url.trim(), eventList, isActive);
    } else {
      onSubmit(url.trim(), eventList);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhook-url">Endpoint URL</Label>
        <Input
          id="webhook-url"
          type="url"
          placeholder="https://api.example.com/webhooks"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label>Events</Label>
        <div className="grid grid-cols-1 gap-2 rounded-md border p-3 max-h-48 overflow-y-auto">
          {WEBHOOK_EVENT_OPTIONS.map((ev) => (
            <div key={ev} className="flex items-center space-x-2">
              <Checkbox
                id={`ev-${ev}`}
                checked={events.has(ev)}
                onCheckedChange={() => toggleEvent(ev)}
              />
              <label htmlFor={`ev-${ev}`} className="text-sm font-mono cursor-pointer">
                {ev}
              </label>
            </div>
          ))}
        </div>
      </div>
      {isEdit && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id="webhook-active"
            checked={isActive}
            onCheckedChange={(v) => setIsActive(v === true)}
          />
          <label htmlFor="webhook-active" className="text-sm">Endpoint active</label>
        </div>
      )}
      {createdSecret && (
        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <Label className="text-amber-700 dark:text-amber-400">Signing secret (copy now; it won’t be shown again)</Label>
          <div className="flex gap-2">
            <code className="flex-1 text-xs break-all bg-background/80 px-2 py-1.5 rounded">
              {createdSecret}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={onSecretCopy}>
              {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <DialogFooter showCloseButton={false}>
        <Button type="button" variant="outline" onClick={onClose}>
          {createdSecret ? "Done" : "Cancel"}
        </Button>
        {!createdSecret && (
          <Button type="submit" disabled={isSubmitting || events.size === 0}>
            {isEdit ? "Save" : "Create"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

export default Webhooks;
