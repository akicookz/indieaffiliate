import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

import StripeCustomerTable from "@/components/StripeCustomerTable";
import CsvImportPanel from "@/components/CsvImportPanel";

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
      <div className="bg-card border rounded-md p-6 space-y-3">
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
    <div className="bg-card border rounded-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Stripe Customers</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-positive bg-positive/10 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 bg-positive rounded-full" />
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
          <CsvImportPanel project={selectedProject} />
        </div>
      )}
    </div>
  );
}

export default Import;
