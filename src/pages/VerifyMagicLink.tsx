import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const getBaseURL = (): string =>
  (import.meta.env.VITE_BETTER_AUTH_URL as string | undefined) ?? window.location.origin;

function VerifyMagicLink() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"verifying" | "ok" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!token?.trim()) {
      setStatus("error");
      setErrorMessage("No login token in the link. Request a new sign-in link.");
      return;
    }

    let cancelled = false;
    const baseUrl = getBaseURL();
    const verifyUrl = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/portal")}`;

    fetch(verifyUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
    })
      .then((res) => {
        if (cancelled) return;
        if (res.type === "opaqueredirect" || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
          const location = res.headers.get("Location");
          window.location.href = location && location.startsWith("/") ? location : "/portal";
          setStatus("ok");
          return;
        }
        if (res.ok) {
          window.location.href = "/portal";
          setStatus("ok");
          return;
        }
        return res.text().then((text) => {
          let msg = "Verification failed. The link may have expired or already been used.";
          try {
            const data = JSON.parse(text) as { error?: string; message?: string };
            msg = data.error ?? data.message ?? msg;
          } catch {
            if (text) msg = text.slice(0, 200);
          }
          setErrorMessage(msg);
          setStatus("error");
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg || "Network error. Please check your connection and try again.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md rounded-md border">
          <CardHeader className="space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-destructive/10 mx-auto">
              <Mail className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-xl text-center">Could not sign you in</CardTitle>
            <p className="text-sm text-muted-foreground text-center">
              {errorMessage}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild className="w-full gap-2">
              <Link to="/partner-login">
                Request a new sign-in link
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Back to home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm rounded-md border">
        <CardHeader className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-md bg-primary/10 mx-auto">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <CardTitle className="text-xl">Signing you in</CardTitle>
          <p className="text-sm text-muted-foreground">
            Verifying your link and taking you to the partner dashboard…
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}

export default VerifyMagicLink;
