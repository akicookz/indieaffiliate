import * as React from "react";
import {
  Home,
  Users,
  HandHeart,
  CreditCard,
  ShieldAlert,
  LineChart,
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

const navMain = [
  {
    title: "Home",
    url: "/app",
    icon: Home,
    isActive: true,
  },
  {
    title: "Partners",
    url: "/app/partners",
    icon: HandHeart,
  },
  {
    title: "Referred Customers",
    url: "/app/customers",
    icon: Users,
  },
  {
    title: "Payouts",
    url: "/app/payouts",
    icon: CreditCard,
  },
  {
    title: "Analytics",
    url: "/app/analytics",
    icon: LineChart,
  },
  {
    title: "Fraud Detection",
    url: "/app/fraud-flags",
    icon: ShieldAlert,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const { toggleSidebar } = useSidebar();

  const user = {
    name: session?.user?.name ?? "User",
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {/* Expanded: label + close button */}
        <div className="flex items-center justify-between px-2 h-8 group-data-[collapsible=icon]:hidden">
          <span className="text-xs font-medium text-sidebar-foreground/70">Platform</span>
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
        {/* Collapsed: open button */}
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
        <NavMain items={navMain} />
        <NavProjects />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
