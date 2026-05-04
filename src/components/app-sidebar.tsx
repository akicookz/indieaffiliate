import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutGrid,
  Users,
  HandHeart,
  CreditCard,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

interface NavCounts {
  partners?: number;
  payouts?: number;
}

function useNavCounts(): NavCounts {
  const { data } = useQuery({
    queryKey: ["nav-counts"],
    queryFn: async (): Promise<NavCounts> => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) return {};
        const json = await res.json();
        return {
          partners: json?.activePartners,
          payouts: json?.pendingCommissionsCount,
        };
      } catch {
        return {};
      }
    },
    staleTime: 60_000,
  });
  return data ?? {};
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const { toggleSidebar } = useSidebar();
  const counts = useNavCounts();

  const user = {
    name: session?.user?.name ?? "User",
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  };

  const workspaceNav = [
    { title: "Overview", url: "/app", icon: LayoutGrid },
    {
      title: "Partners",
      url: "/app/partners",
      icon: HandHeart,
      count: counts.partners,
    },
    { title: "Payments", url: "/app/payments", icon: Users },
    {
      title: "Payouts",
      url: "/app/payouts",
      icon: CreditCard,
      count: counts.payouts,
    },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 h-8 group-data-[collapsible=icon]:hidden">
          <span className="text-eyebrow-muted">Workspace</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={toggleSidebar}
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center py-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={toggleSidebar}
            aria-label="Open sidebar"
          >
            <PanelLeft className="size-4" />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={workspaceNav} />
        <NavProjects />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
