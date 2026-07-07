import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import {
  Settings,
  Plus,
  ChevronRight,
  Palette,
  Webhook,
  Sliders,
} from "lucide-react";

import {
  SidebarMenu,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
}

const subMenuItems = [
  { name: "Commissions", url: "commissions", icon: Sliders },
  { name: "Partner page", url: "partner-page", icon: Palette },
  { name: "Webhooks", url: "webhooks", icon: Webhook },
  { name: "Settings", url: "settings", icon: Settings },
];

export function NavProjects() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Failed to create project",
        );
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewProjectName("");
      setShowNewForm(false);
    },
  });

  function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (newProjectName.trim()) {
      createMutation.mutate(newProjectName.trim());
    }
  }

  const projectsList = data?.projects ?? [];

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {projectsList.map((project) => {
          const isOpen = location.pathname.includes(`/projects/${project.slug}`);
          return (
            <Collapsible
              key={project.id}
              asChild
              defaultOpen={isOpen}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={project.name}>
                    <div className="size-5 rounded bg-muted text-foreground flex items-center justify-center font-mono text-[10px] font-medium shrink-0">
                      {project.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium">{project.name}</span>
                    <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform duration-150 ease-out group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {subMenuItems.map((subItem) => {
                      const href = `/app/projects/${project.slug}/${subItem.url}`;
                      const isActive = location.pathname === href;
                      return (
                        <SidebarMenuSubItem key={subItem.name}>
                          <SidebarMenuSubButton asChild isActive={isActive}>
                            <Link to={href}>
                              <subItem.icon />
                              <span>{subItem.name}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}

        {showNewForm ? (
          <div className="mt-2">
            <form onSubmit={handleCreateProject} className="flex gap-2 px-2">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="h-8 text-sm"
                autoFocus
              />
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "..." : "Add"}
              </Button>
            </form>
            {createMutation.error && (
              <p className="px-2 mt-1 text-xs text-destructive">
                {(createMutation.error as Error).message}
              </p>
            )}
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 justify-start text-muted-foreground hover:text-foreground"
            onClick={() => setShowNewForm(true)}
          >
            <Plus className="w-4 h-4" />
            New project
          </Button>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
