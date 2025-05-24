import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

function Navigation() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Dashboard", description: "Overview & metrics" },
    {
      path: "/analytics",
      label: "Analytics",
      description: "Detailed insights",
    },
  ];

  return (
    <nav className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6 mb-8">
      <div className="flex flex-col sm:flex-row gap-4">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex-1 p-4 rounded-xl border transition-all duration-200 hover:bg-accent/50",
              location.pathname === item.path
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-background/30 border-border/30 text-foreground hover:border-border/50"
            )}
          >
            <div className="text-center sm:text-left">
              <div className="font-semibold">{item.label}</div>
              <div className="text-sm opacity-70">{item.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export default Navigation;
