import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Settings, Plus, ChevronRight } from "lucide-react";

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
  {
    name: "Settings",
    url: "settings",
    icon: <Settings className="w-4 h-4" />,
  },
];

export function NavProjects() {
  const queryClient = useQueryClient();
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
      if (!response.ok) throw new Error("Failed to create project");
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

      <SidebarMenu className="gap-3">
        {projectsList.map((item) => (
          <Collapsible key={item.id} asChild className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.name}>
                  <div className="flex items-center gap-2">
                    <div className="flex px-1 py-0.5 bg-card border border-border text-sm font-mono items-center justify-center rounded-full font-medium">
                      {item.name.slice(0, 2)}
                    </div>
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub className="gap-2">
                  {subMenuItems.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.name}>
                      <SidebarMenuSubButton asChild>
                        <Link to={`/app/projects/${item.slug}/${subItem.url}`}>
                          {subItem.icon}
                          <span>{subItem.name}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}

        {showNewForm ? (
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
        ) : (
          <Button
            variant="default"
            size="sm"
            className="mt-2"
            onClick={() => setShowNewForm(true)}
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
