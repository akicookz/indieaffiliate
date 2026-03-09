import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";

interface JoinPageData {
  projectName: string;
  brandColor: string;
  headline: string;
  description: string | null;
  ctaText: string;
  fontFamily: string;
  borderRadius: string;
  logo: string | null;
  backgroundImage: string | null;
}

const BORDER_RADIUS_MAP: Record<string, string> = {
  rectangle: "0px",
  soft: "8px",
  pill: "9999px",
};

function getBorderRadiusPx(value: string): string {
  return BORDER_RADIUS_MAP[value] ?? "8px";
}

function getGoogleFontUrl(font: string): string {
  const family = font.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

function JoinPartnerProgram() {
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const {
    data: pageData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["join", slug],
    queryFn: async (): Promise<JoinPageData> => {
      const response = await fetch(`/api/join/${slug}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error("not_found");
        throw new Error("Failed to load");
      }
      return response.json();
    },
    enabled: !!slug,
  });

  const joinMutation = useMutation({
    mutationFn: async (): Promise<{ status: string; message: string }> => {
      const response = await fetch(`/api/join/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!response.ok) {
        let message = "Something went wrong";
        try {
          const err = await response.json();
          message =
            (err as { error?: string }).error ??
            message;
        } catch {
          try {
            const text = await response.text();
            if (text) message = text.slice(0, 200);
          } catch {
            // ignore
          }
        }
        throw new Error(message);
      }
      return response.json();
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (): Promise<{ status: string; message: string }> => {
      const response = await fetch(`/api/join/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to resend code.",
        );
      }
      return response.json();
    },
    onSuccess: () => {
      setResendCooldown(60);
    },
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const otpMutation = useMutation({
    mutationFn: async (): Promise<{
      status: string;
      message?: string;
      redirect?: string;
    }> => {
      const response = await fetch(`/api/partner/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          email: email.trim(),
          code: otp.trim(),
        }),
      });
      if (!response.ok) {
        let message = "Failed to verify code. Please try again.";
        try {
          const err = (await response.json()) as {
            error?: string;
            debug?: string;
          };
          const errMsg = err.error ?? message;
          message = err.debug ? `${errMsg}: ${err.debug}` : errMsg;
        } catch {
          try {
            const text = await response.text();
            if (text) message = text.slice(0, 200);
          } catch {
            // ignore
          }
        }
        throw new Error(message);
      }
      return response.json();
    },
  });

  const brandColor = pageData?.brandColor || "#7c3aed";
  const fontFamily = pageData?.fontFamily || "Inter";
  const radiusPx = getBorderRadiusPx(pageData?.borderRadius || "soft");

  // Load Google Font dynamically — must be before any early returns
  useEffect(() => {
    const linkId = "join-page-google-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = getGoogleFontUrl(fontFamily);
  }, [fontFamily]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    joinMutation.mutate();
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim() || !email.trim() || !slug) return;
    otpMutation.mutate();
  }

  // ─── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // ─── 404 state ────────────────────────────────────────────────────────────
  if (error || !pageData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-semibold text-gray-900">
            Program not found
          </h1>
          <p className="text-gray-500">
            This affiliate program doesn't exist or is no longer accepting
            applications.
          </p>
        </div>
      </div>
    );
  }

  const otpRequired =
    joinMutation.isSuccess && joinMutation.data?.status === "otp_required";
  const joinFinished =
    joinMutation.isSuccess && joinMutation.data?.status !== "otp_required";

  // ─── After OTP: redirect to dashboard (session set via magic-link verify) ─
  if (otpMutation.isSuccess && otpMutation.data?.redirect) {
    window.location.href = otpMutation.data.redirect;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md space-y-6 text-center px-6">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-gray-500 text-sm">Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }
  if (otpMutation.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md space-y-6 text-center px-6">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center bg-primary/10">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            Check your email
          </h2>
          <p className="text-gray-500 text-sm">
            We verified your code and emailed a sign-in link to{" "}
            <strong>{email}</strong>. Click the link in that email to access
            your partner dashboard.
          </p>
        </div>
      </div>
    );
  }

  // ─── Success state (new application) ──────────────────────────────────────
  if (joinFinished) {
    return (
      <div
        className="min-h-screen grid grid-cols-1 lg:grid-cols-2"
        style={{ fontFamily: `"${fontFamily}", sans-serif` }}
      >
        {/* Left */}
        <div
          className="relative hidden lg:flex flex-col justify-end p-12"
          style={{ backgroundColor: brandColor }}
        >
          {pageData.backgroundImage && (
            <img
              src={pageData.backgroundImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, ${brandColor}ee, ${brandColor}44)`,
            }}
          />
          <div className="relative z-10 space-y-4">
            {pageData.logo && (
              <img src={pageData.logo} alt="" className="h-10 object-contain" />
            )}
            <h1 className="text-3xl font-bold text-white leading-tight">
              {pageData.headline}
            </h1>
            {pageData.description && (
              <p className="text-base text-white/80 leading-relaxed max-w-md">
                {pageData.description}
              </p>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center justify-center p-8 lg:p-16 bg-gray-50">
          <div className="w-full max-w-md text-center space-y-6">
            <div
              className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${brandColor}15` }}
            >
              <CheckCircle2
                className="w-8 h-8"
                style={{ color: brandColor }}
              />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">
              {joinMutation.data?.status === "active"
                ? "You're in!"
                : "Application submitted!"}
            </h2>
            <p className="text-gray-500">{joinMutation.data?.message}</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main join page ───────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen grid grid-cols-1 lg:grid-cols-2"
      style={{ fontFamily: `"${fontFamily}", sans-serif` }}
    >
      {/* Left side - Branding */}
      <div
        className="relative hidden lg:flex flex-col justify-end p-12"
        style={{ backgroundColor: brandColor }}
      >
        {pageData.backgroundImage && (
          <img
            src={pageData.backgroundImage}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${brandColor}ee, ${brandColor}44)`,
          }}
        />
        <div className="relative z-10 space-y-4">
          {pageData.logo && (
            <img src={pageData.logo} alt="" className="h-10 object-contain" />
          )}
          <h1 className="text-3xl font-bold text-white leading-tight">
            {pageData.headline}
          </h1>
          {pageData.description && (
            <p className="text-base text-white/80 leading-relaxed max-w-md">
              {pageData.description}
            </p>
          )}
        </div>
      </div>

      {/* Right side - Sign-up form */}
      <div className="flex items-center justify-center p-8 lg:p-16 bg-gray-50">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile-only branding */}
          <div className="lg:hidden space-y-3">
            {pageData.logo && (
              <img
                src={pageData.logo}
                alt=""
                className="h-10 object-contain"
              />
            )}
            <h1
              className="text-2xl font-bold leading-tight"
              style={{ color: brandColor }}
            >
              {pageData.headline}
            </h1>
            {pageData.description && (
              <p className="text-sm text-gray-500 leading-relaxed">
                {pageData.description}
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              {pageData.projectName}
            </p>
            <h2 className="text-2xl font-semibold text-gray-900 mt-1">
              Partner Application
            </h2>
          </div>

          {otpRequired ? (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="otp"
                  className="block text-sm font-medium text-gray-700"
                >
                  Enter the code we emailed you
                </label>
                <input
                  id="otp"
                  type="text"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="ABC123"
                  className="w-full h-11 border border-gray-200 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-shadow tracking-[0.25em] text-center uppercase"
                  style={
                    {
                      "--tw-ring-color": brandColor,
                      borderRadius: radiusPx,
                    } as React.CSSProperties
                  }
                />
                <p className="text-xs text-gray-500">
                  We found an existing partner account for this email. Enter the
                  one-time code we just sent to <strong>{email}</strong>.
                </p>
              </div>

              {otpMutation.isError && (
                <p className="text-sm text-red-600">
                  {otpMutation.error.message}
                </p>
              )}

              <button
                type="submit"
                disabled={otpMutation.isPending || !otp.trim()}
                className="w-full h-11 text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: brandColor, borderRadius: radiusPx }}
              >
                {otpMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {otpMutation.isPending ? "Verifying..." : "Verify code"}
              </button>

              <div className="text-center">
                {resendMutation.isError && (
                  <p className="text-sm text-red-600 mb-2">
                    {resendMutation.error.message}
                  </p>
                )}
                {resendMutation.isSuccess && resendCooldown > 0 && (
                  <p className="text-sm text-green-600 mb-2">
                    New code sent. Check your email.
                  </p>
                )}
                <button
                  type="button"
                  disabled={
                    resendMutation.isPending || resendCooldown > 0 || !email
                  }
                  onClick={() => resendMutation.mutate()}
                  className="text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:underline"
                  style={{ color: brandColor }}
                >
                  {resendMutation.isPending
                    ? "Sending…"
                    : resendCooldown > 0
                      ? `Resend code (${resendCooldown}s)`
                      : "Resend code"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full h-11 border border-gray-200 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                  style={
                    {
                      "--tw-ring-color": brandColor,
                      borderRadius: radiusPx,
                    } as React.CSSProperties
                  }
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full h-11 border border-gray-200 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                  style={
                    {
                      "--tw-ring-color": brandColor,
                      borderRadius: radiusPx,
                    } as React.CSSProperties
                  }
                />
              </div>

              {joinMutation.isError && (
                <p className="text-sm text-red-600">
                  {joinMutation.error.message}
                </p>
              )}

              <button
                type="submit"
                disabled={joinMutation.isPending || !name.trim() || !email.trim()}
                className="w-full h-11 text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: brandColor, borderRadius: radiusPx }}
              >
                {joinMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {joinMutation.isPending
                  ? "Submitting..."
                  : pageData.ctaText || "Become a Partner"}
              </button>
            </form>
          )}

          <p className="text-xs text-gray-400 text-center">
            Powered by{" "}
            <a
              href="/"
              className="underline hover:text-gray-600 transition-colors"
            >
              UnlockAffiliate
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default JoinPartnerProgram;
