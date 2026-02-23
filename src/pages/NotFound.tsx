import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";

function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession();

  function handleGoBack() {
    if (session) {
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate("/app", { replace: true });
      }
    } else {
      navigate("/", { replace: true });
    }
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
        <CardContent>
          <Button variant="outline" onClick={handleGoBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Go back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFound;
