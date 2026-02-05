import * as React from "react";
import { Home, Users, HandHeart, CreditCard, BarChart3, ShieldAlert } from "lucide-react";

import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";

const navMain = [
  {
    title: "Home",
    url: "/app",
    icon: Home,
    isActive: true,
  },
  {
    title: "Analytics",
    url: "/app/analytics",
    icon: BarChart3,
  },
  {
    title: "Partners",
    url: "/app/partners",
    icon: HandHeart,
  },
  {
    title: "Customers",
    url: "/app/customers",
    icon: Users,
  },
  {
    title: "Payouts",
    url: "/app/payouts",
    icon: CreditCard,
  },
  {
    title: "Fraud Detection",
    url: "/app/fraud-flags",
    icon: ShieldAlert,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();

  const user = {
    name: session?.user?.name ?? "User",
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader />
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
