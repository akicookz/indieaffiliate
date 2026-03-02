import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, Mail, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const OTP_LENGTH = 6;

function PartnerLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  async function sendOtp() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/partner/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
        return;
      }
      setStep("otp");
      setOtp("");
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) clearInterval(interval);
          return Math.max(0, prev - 1);
        });
      }, 1000);
    } catch {
      setError("Could not send code. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    sendOtp();
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/partner/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: otp.trim().toUpperCase(),
        }),
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid code");
        setLoading(false);
        return;
      }
      navigate("/portal", { replace: true });
      return;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleBackToEmail() {
    setStep("email");
    setOtp("");
    setError("");
  }

  if (step === "otp") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-2xl mx-auto mb-6">
              <KeyRound className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold">Enter your code</h1>
            <p className="text-sm text-muted-foreground mt-2">
              We sent a 6-character code to{" "}
              <strong className="text-foreground">{email}</strong>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Code expires in 10 minutes. Letters are uppercase.
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="otp"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Verification code
              </label>
              <Input
                id="otp"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="e.g. AB3X9K"
                value={otp}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
                  setOtp(v.slice(0, OTP_LENGTH));
                }}
                className="w-full text-center text-lg tracking-[0.4em] font-mono uppercase"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading || otp.length < OTP_LENGTH}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Sign in to dashboard"
              )}
            </Button>
          </form>

          <div className="flex flex-col items-center gap-2 text-sm">
            {resendCooldown > 0 ? (
              <span className="text-muted-foreground">
                Resend code in {resendCooldown}s
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setResendCooldown(60);
                  sendOtp();
                }}
                className="text-primary font-medium hover:underline"
              >
                Resend code
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handleBackToEmail}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Use a different email
            </Button>
          </div>
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
            Enter your email to receive a one-time login code
          </p>
        </div>

        <form onSubmit={handleSendOtp} className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
              {error}
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
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending code…
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Send login code
              </>
            )}
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
