import * as React from "react";
import {
  Home,
  TrendingUp,
  Users,
  Zap,
  HandHeart,
  CreditCard,
  Palette,
} from "lucide-react";

import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
// import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";

// IndieAffiliate data
const data = {
  user: {
    name: "Affiliate Marketer",
    email: "marketer@indieaffiliate.com",
    avatar: "/avatars/user.jpg",
  },
  teams: [
    {
      name: "IndieAffiliate",
      logo: Zap,
      plan: "Pro",
    },
  ],
  navMain: [
    {
      title: "Home",
      url: "/",
      icon: Home,
      isActive: true,
    },
    {
      title: "Partners",
      url: "/partners",
      icon: HandHeart,
    },
    {
      title: "Customers",
      url: "/customers",
      icon: Users,
    },
    {
      title: "Payouts",
      url: "/payouts",
      icon: CreditCard,
    },
    {
      title: "Brand Assets",
      url: "/brand-assets",
      icon: Palette,
    },
  ],
  projects: [
    {
      name: "Amazon Associates",
      url: "/projects/amazon",
      icon: TrendingUp,
    },
    {
      name: "Digital Products",
      url: "/projects/digital",
      icon: Users,
    },
    {
      name: "SaaS Referrals",
      url: "/projects/saas",
      icon: Zap,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>{/* <TeamSwitcher teams={data.teams} /> */}</SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
