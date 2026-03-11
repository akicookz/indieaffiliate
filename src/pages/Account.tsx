import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CreditCard, FolderKanban, Mail, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";

interface BillingData {
  subscription: {
    plan: "starter" | "growth" | "scale" | null;
    status: string;
  };
}

interface ProjectsResponse {
  projects: Array<{ id: string }>;
}

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

function Account() {
  const { data: session, isPending } = useSession();

  const { data: billing } = useQuery<BillingData>({
    queryKey: ["billing"],
    queryFn: async () => {
      const res = await fetch("/api/billing");
      if (!res.ok) throw new Error("Failed to load billing");
      return res.json();
    },
  });

  const { data: projectsData } = useQuery<ProjectsResponse>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
  });

  if (isPending) {
    return <div className="text-sm text-muted-foreground">Loading account…</div>;
  }

  const user = session?.user;
  const planLabel =
    (billing?.subscription.plan && PLAN_LABELS[billing.subscription.plan]) ||
    "Not selected";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground">
          Review your profile, current plan, and workspace summary.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5" />
              Profile
            </CardTitle>
            <CardDescription>Your Better Auth account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="font-medium">{user?.name || "No name set"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email || "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Email verified</span>
              <Badge variant={user?.emailVerified ? "default" : "secondary"}>
                {user?.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5" />
              Workspace summary
            </CardTitle>
            <CardDescription>Plan and project overview for this account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Current plan</span>
              <span className="font-medium">{planLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Billing status</span>
              <span className="font-medium capitalize">
                {billing?.subscription.status ?? "Unknown"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Projects</span>
              <span className="font-medium">{projectsData?.projects.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Primary email</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Plan</p>
              <p className="text-sm text-muted-foreground">{planLabel}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <FolderKanban className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Projects</p>
              <p className="text-sm text-muted-foreground">
                {projectsData?.projects.length ?? 0} active workspaces
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Account;
