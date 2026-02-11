import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Home, LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function NotFound() {
  const location = useLocation();

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
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Button asChild variant="outline" className="flex-1">
            <Link to="/">
              <Home className="w-4 h-4 mr-2" />
              Back to home
            </Link>
          </Button>
          <Button asChild className="flex-1">
            <Link to="/app">
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Go to dashboard
            </Link>
          </Button>
          <Button asChild variant="ghost" className="sm:flex-none">
            <Link to="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go back
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFound;
