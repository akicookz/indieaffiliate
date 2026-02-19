import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook,
  Plus,
  Trash2,
  Edit,
  Send,
  Check,
  X,
  Copy,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

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
  endpointId: string;
  event: string;
  payload: string;
  statusCode: number | null;
  responseBody: string | null;
  attempt: number;
  createdAt: string;
}

const WEBHOOK_EVENTS = [
  { id: "partner.created", label: "Partner Created" },
  { id: "partner.approved", label: "Partner Approved" },
  { id: "customer.created", label: "Customer Created" },
  { id: "commission.created", label: "Commission Created" },
  { id: "commission.approved", label: "Commission Approved" },
  { id: "payout.created", label: "Payout Created" },
  { id: "click.recorded", label: "Click Recorded" },
] as const;

function Webhooks() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<WebhookEndpoint | null>(null);
  const [viewingLogs, setViewingLogs] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

  // Form state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);

  // Get project
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);

  // Get webhooks
  const { data: webhooksData, isLoading } = useQuery({
    queryKey: ["webhooks", project?.id],
    queryFn: async (): Promise<{ endpoints: WebhookEndpoint[] }> => {
      if (!project) throw new Error("Project not found");
      const response = await fetch(`/api/webhooks?projectId=${project.id}`);
      if (!response.ok) throw new Error("Failed to fetch webhooks");
      return response.json();
    },
    enabled: !!project,
  });

  // Get logs for viewing endpoint
  const { data: logsData } = useQuery({
    queryKey: ["webhook-logs", viewingLogs],
    queryFn: async (): Promise<{ logs: WebhookLog[] }> => {
      if (!viewingLogs) throw new Error("No endpoint ID");
      const response = await fetch(`/api/webhooks/${viewingLogs}/logs?limit=50`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
    enabled: !!viewingLogs,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { url: string; events: string[]; isActive: boolean }) => {
      if (!project) throw new Error("Project not found");
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          url: data.url,
          events: data.events,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create webhook");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      setShowCreateDialog(false);
      setWebhookUrl("");
      setSelectedEvents([]);
      setIsActive(true);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      url?: string;
      events?: string[];
      isActive?: boolean;
    }) => {
      const response = await fetch(`/api/webhooks/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: data.url,
          events: data.events,
          isActive: data.isActive,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update webhook");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      setEditingEndpoint(null);
      setWebhookUrl("");
      setSelectedEvents([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete webhook");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}/test`, {
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to send test webhook");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhook-logs"] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["webhook-logs", viewingLogs] });
      }, 1000);
    },
  });

  function handleCreate() {
    if (!webhookUrl || selectedEvents.length === 0) return;
    createMutation.mutate({
      url: webhookUrl,
      events: selectedEvents,
      isActive,
    });
  }

  function handleEdit(endpoint: WebhookEndpoint) {
    setEditingEndpoint(endpoint);
    setWebhookUrl(endpoint.url);
    setSelectedEvents(JSON.parse(endpoint.events));
    setIsActive(endpoint.isActive);
  }

  function handleUpdate() {
    if (!editingEndpoint) return;
    updateMutation.mutate({
      id: editingEndpoint.id,
      url: webhookUrl,
      events: selectedEvents,
      isActive,
    });
  }

  function handleToggleEvent(eventId: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId],
    );
  }

  function handleCopySecret(secret: string) {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(secret);
    setTimeout(() => setCopiedSecret(null), 2000);
  }

  function toggleLogExpansion(logId: string) {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  }

  function getStatusBadge(statusCode: number | null) {
    if (statusCode === null) {
      return <Badge variant="destructive">Error</Badge>;
    }
    if (statusCode >= 200 && statusCode < 300) {
      return <Badge className="bg-green-600">Success</Badge>;
    }
    return <Badge variant="destructive">{statusCode}</Badge>;
  }

  if (!project) {
    return <div>Project not found</div>;
  }

  return (
    <div className="space-y-6 bg-background max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-muted rounded-2xl flex items-center justify-center">
            <Webhook className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {project.name}
            </h1>
            <p className="text-muted-foreground">Webhook endpoints</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Endpoint
        </Button>
      </div>

      {/* Endpoints List */}
      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : webhooksData?.endpoints.length === 0 ? (
        <div className="shadow-xs bg-card/50 rounded-2xl p-12 text-center">
          <Webhook className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No webhook endpoints</h3>
          <p className="text-muted-foreground mb-4">
            Create your first webhook endpoint to receive real-time events
          </p>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Endpoint
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooksData?.endpoints.map((endpoint) => {
            const events = JSON.parse(endpoint.events) as string[];
            return (
              <div
                key={endpoint.id}
                className="shadow-xs bg-card/50 rounded-2xl p-6 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">{endpoint.url}</h3>
                      {endpoint.isActive ? (
                        <Badge className="bg-green-600">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {events.map((event) => (
                        <Badge key={event} variant="outline" className="text-xs">
                          {WEBHOOK_EVENTS.find((e) => e.id === event)?.label || event}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Secret: {endpoint.secret.slice(0, 8)}...</span>
                      {showSecret === endpoint.id ? (
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted/50 px-2 py-1 rounded">
                            {endpoint.secret}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopySecret(endpoint.secret)}
                          >
                            {copiedSecret === endpoint.secret ? (
                              <Check className="w-3 h-3 text-green-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSecret(null)}
                          >
                            <EyeOff className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowSecret(endpoint.id)}
                        >
                          <Eye className="w-3 h-3" />
                          Show secret
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setViewingLogs(endpoint.id);
                      }}
                    >
                      <ExternalLink className="w-3 h-3 mr-1.5" />
                      Logs
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testMutation.mutate(endpoint.id)}
                      disabled={testMutation.isPending}
                    >
                      <Send className="w-3 h-3 mr-1.5" />
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(endpoint)}
                    >
                      <Edit className="w-3 h-3 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Delete this webhook endpoint?")) {
                          deleteMutation.mutate(endpoint.id);
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={showCreateDialog || editingEndpoint !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingEndpoint(null);
            setWebhookUrl("");
            setSelectedEvents([]);
            setIsActive(true);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEndpoint ? "Edit Webhook Endpoint" : "Create Webhook Endpoint"}
            </DialogTitle>
            <DialogDescription>
              Configure a webhook endpoint to receive real-time events from your
              affiliate program.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhooks"
                type="url"
              />
            </div>
            <div className="space-y-2">
              <Label>Events</Label>
              <div className="space-y-2 border rounded-lg p-4">
                {WEBHOOK_EVENTS.map((event) => (
                  <div key={event.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={event.id}
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => handleToggleEvent(event.id)}
                    />
                    <Label
                      htmlFor={event.id}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {event.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="isActive" className="cursor-pointer">
                Active
              </Label>
            </div>
            {editingEndpoint && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <Label className="text-xs font-medium">Webhook Secret</Label>
                <p className="text-xs text-muted-foreground">
                  Use this secret to verify webhook signatures using HMAC-SHA256.
                  The signature is sent in the <code>X-Webhook-Signature</code> header.
                </p>
                {showSecret === editingEndpoint.id ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-3 py-2 rounded font-mono break-all">
                      {editingEndpoint.secret}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopySecret(editingEndpoint.secret)}
                    >
                      {copiedSecret === editingEndpoint.secret ? (
                        <Check className="w-3 h-3 text-green-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSecret(editingEndpoint.id)}
                  >
                    <Eye className="w-3 h-3 mr-1.5" />
                    Show secret
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                setEditingEndpoint(null);
                setWebhookUrl("");
                setSelectedEvents([]);
                setIsActive(true);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editingEndpoint ? handleUpdate : handleCreate}
              disabled={
                !webhookUrl ||
                selectedEvents.length === 0 ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {editingEndpoint
                ? updateMutation.isPending
                  ? "Saving..."
                  : "Save"
                : createMutation.isPending
                  ? "Creating..."
                  : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={viewingLogs !== null} onOpenChange={(open) => !open && setViewingLogs(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Webhook Delivery Logs</DialogTitle>
            <DialogDescription>
              View delivery history and responses for this webhook endpoint.
            </DialogDescription>
          </DialogHeader>
          {logsData?.logs && logsData.logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No delivery logs yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData?.logs.map((log) => (
                  <>
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">{log.event}</TableCell>
                      <TableCell>{getStatusBadge(log.statusCode)}</TableCell>
                      <TableCell>{log.attempt}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleLogExpansion(log.id)}
                        >
                          {expandedLogs.has(log.id) ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedLogs.has(log.id) && (
                      <TableRow key={`${log.id}-expanded`}>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <div className="space-y-3 p-4">
                            <div>
                              <Label className="text-xs">Payload</Label>
                              <pre className="text-xs bg-background p-3 rounded overflow-auto max-h-40">
                                {JSON.stringify(JSON.parse(log.payload), null, 2)}
                              </pre>
                            </div>
                            {log.responseBody && (
                              <div>
                                <Label className="text-xs">Response</Label>
                                <pre className="text-xs bg-background p-3 rounded overflow-auto max-h-40">
                                  {log.responseBody}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Webhooks;
