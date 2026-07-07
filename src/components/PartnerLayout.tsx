import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  LayoutDashboard,
  DollarSign,
  Users,
  Wallet,
  LogOut,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/portal" },
  { label: "Referrals", icon: Users, path: "/portal/referrals" },
  { label: "Commissions", icon: DollarSign, path: "/portal/commissions" },
  { label: "Payouts", icon: Wallet, path: "/portal/payouts" },
];

interface PortalBranding {
  portalName: string | null;
  logo: string | null;
  brandColor: string;
}

function PartnerLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const { data: branding } = useQuery({
    queryKey: ["partner-portal-branding"],
    queryFn: async (): Promise<PortalBranding> => {
      const response = await fetch("/api/partner/portal-branding", {
        credentials: "include",
      });
      if (!response.ok) return { portalName: null, logo: null, brandColor: "#7c3aed" };
      return response.json();
    },
  });

  const portalTitle = branding?.portalName?.trim() || "Partner Portal";
  const brandColor = branding?.brandColor ?? "#7c3aed";

  async function handleSignOut() {
    await signOut();
    navigate("/partner-login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <header className="border-b border-border bg-background sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/portal" className="flex items-center space-x-2">
              {branding?.logo ? (
                <img
                  src={branding.logo}
                  alt=""
                  className="w-7 h-7 rounded-md object-contain bg-card shadow-ring"
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ backgroundColor: brandColor }}
                >
                  <BarChart3 className="w-4 h-4 text-white" />
                </div>
              )}
              {/* Neutral title — the accent belongs to the logo chip, not text */}
              <span className="text-sm font-semibold text-foreground">
                {portalTitle}
              </span>
            </Link>

            <nav className="hidden sm:flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive =
                  item.path === "/portal"
                    ? location.pathname === "/portal"
                    : location.pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>

          {/* Mobile nav */}
          <nav className="sm:hidden flex items-center space-x-1 pb-3 overflow-x-auto">
            {navItems.map((item) => {
              const isActive =
                item.path === "/portal"
                  ? location.pathname === "/portal"
                  : location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <Outlet />
      </main>
    </div>
  );
}

export default PartnerLayout;
