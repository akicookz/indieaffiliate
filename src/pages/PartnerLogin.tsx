import { useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function PartnerLogin() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error: authError } = await authClient.signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: "/portal",
      });

      if (authError) {
        const msg = authError.message ?? "Failed to send login link";
        setError(msg);
        setLoading(false);
        return;
      }

      setSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-2xl mx-auto">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Check your email</h1>
            <p className="text-muted-foreground mt-2">
              We sent a sign-in link to{" "}
              <strong className="text-foreground">{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Click the link in the email to access your partner dashboard.
              The link expires in 5 minutes.
            </p>
          </div>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center space-x-2 mb-6">
            <div className="w-8 h-8 bg-primary rounded-xl flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-primary">
              UnlockAffiliate
            </span>
          </Link>
          <h1 className="text-2xl font-semibold">Partner Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your email to receive a sign-in link
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="space-y-1">
              <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
                {error}
              </div>
              <p className="text-xs text-muted-foreground">
                If this keeps happening, the sign-in email may be misconfigured. Try again in a few minutes or contact the project owner.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send sign-in link"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Are you a project owner?{" "}
          <Link
            to="/login"
            className="text-primary font-medium hover:underline"
          >
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}

export default PartnerLogin;
