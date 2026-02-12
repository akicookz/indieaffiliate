import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";

function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  function handleGoBack() {
    if (isPending) {
      return;
    }
    if (session) {
      navigate("/app", { replace: true });
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-lg rounded-3xl bg-card/40 backdrop-blur-xl border-border/40 shadow-xs">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Page not found</CardTitle>
          <p className="text-sm text-muted-foreground">
            Nothing exists at{" "}
            <span className="font-mono text-foreground/80">
              {location.pathname}
            </span>
            .
          </p>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            variant="ghost"
            className="sm:flex-none"
            onClick={handleGoBack}
            disabled={isPending}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFound;
