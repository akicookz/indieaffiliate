import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

function PartnerAuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["partner-me"],
    queryFn: async () => {
      const res = await fetch("/api/partner/me", { credentials: "include" });
      if (!res.ok) throw new Error("Unauthorized");
      return res.json() as Promise<{ partner: unknown; programs: unknown[] }>;
    },
    retry: false,
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isError || !data) {
    return <Navigate to="/partner-login" replace />;
  }

  return <>{children}</>;
}

export default PartnerAuthGuard;
