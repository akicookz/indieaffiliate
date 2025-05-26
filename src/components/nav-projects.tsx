import { Palette, Layout, Settings, Plus } from "lucide-react";

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
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";

const projects = [
  {
    name: "LinkyCal.com",
    url: "/projects/linkycal",
    projectId: "linkycal",
  },
  {
    name: "ImageAnimateAI.com",
    url: "/projects/imageanimateai",
    projectId: "imageanimateai",
  },
  {
    name: "LaunchFast.shop",
    url: "/projects/launchfast",
    projectId: "launchfast",
  },
];

const subMenuItems = [
  {
    name: "Brand assets",
    url: "/brand-assets",
    icon: <Palette />,
  },
  {
    name: "Branded affiliate page",
    url: "/affiliate-page",
    icon: <Layout />,
  },
  {
    name: "Settings",
    url: "/settings",
    icon: <Settings />,
  },
];

export function NavProjects() {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>

      <SidebarMenu className="gap-3">
        {projects.map((item) => (
          <Collapsible key={item.name} asChild className="group/collapsible">
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
                        <a href={`/projects/${item.projectId}/${subItem.url}`}>
                          {subItem.icon}
                          <span>{subItem.name}</span>
                        </a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
        <Button variant="default" size="sm" className="mt-4">
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </SidebarMenu>
    </SidebarGroup>
  );
}
