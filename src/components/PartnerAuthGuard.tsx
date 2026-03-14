import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";

function PartnerAuthGuard({ children }: { children: React.ReactNode }) {
  // Dev bypass: if we have the dev partner cookie or OTP query flag, skip Better Auth.
  let devBypass = false;
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const url = new URL(window.location.href);
    const devFlag = url.searchParams.get("dev_otp");
    const hasDevCookie = document.cookie.includes("dev-partner-user=");
    devBypass = devFlag === "1" || hasDevCookie;
  }

  const { data: session, isPending } = useSession();

  if (devBypass) {
    return <>{children}</>;
  }

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm text-muted-foreground">Checking sign-in…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/partner-login" replace />;
  }

  return <>{children}</>;
}

export default PartnerAuthGuard;
