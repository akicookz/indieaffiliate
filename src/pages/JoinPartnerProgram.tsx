import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

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

const OTP_LENGTH = 6;

function JoinPartnerProgram() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"form" | "otp" | "success">("form");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

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
    mutationFn: async (): Promise<{
      status?: string;
      message?: string;
      alreadyApplied?: boolean;
    }> => {
      const response = await fetch(`/api/join/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!response.ok) {
        const err = (await response.json()) as {
          error?: string;
          detail?: string;
        };
        const message =
          err.detail ?? err.error ?? "Something went wrong";
        throw new Error(message);
      }
      return response.json();
    },
    onSuccess(data) {
      if (data?.alreadyApplied) setStep("otp");
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
    setOtpError("");
    joinMutation.mutate();
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError("");
    setVerifyLoading(true);
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
        setOtpError(data.error ?? "Invalid code");
        setVerifyLoading(false);
        return;
      }
      navigate("/portal", { replace: true });
    } catch {
      setOtpError("Something went wrong. Please try again.");
    } finally {
      setVerifyLoading(false);
    }
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center space-y-5 max-w-sm">
          <h1 className="text-2xl font-semibold text-gray-900">
            Program not found
          </h1>
          <p className="text-gray-500">
            This affiliate program doesn't exist or is no longer accepting
            applications.
          </p>
          <Link
            to="/"
            className="inline-block text-sm font-medium text-primary hover:underline"
          >
            ← Back to UnlockAffiliate
          </Link>
        </div>
      </div>
    );
  }

  // ─── OTP step (already applied: sent OTP, waiting for verification) ───────
  if (step === "otp") {
    return (
      <div
        className="min-h-screen grid grid-cols-1 lg:grid-cols-2"
        style={{ fontFamily: `"${fontFamily}", sans-serif` }}
      >
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

        <div className="flex items-center justify-center p-8 lg:p-16 bg-gray-50">
          <div className="w-full max-w-md space-y-6">
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
            </div>
            <div className="flex justify-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: `${brandColor}18` }}
              >
                <KeyRound className="w-7 h-7" style={{ color: brandColor }} />
              </div>
            </div>
            <div className="text-center space-y-1">
              <h2 className="text-xl font-semibold text-gray-900">
                You're already a partner
              </h2>
              <p className="text-sm text-gray-500">
                We sent a login code to <strong className="text-gray-700">{email}</strong>. Enter it below to go to your dashboard.
              </p>
            </div>
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {otpError && (
                <p className="text-sm text-red-600">{otpError}</p>
              )}
              <div>
                <label
                  htmlFor="join-otp"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Verification code
                </label>
                <input
                  id="join-otp"
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="e.g. AB3X9K"
                  value={otp}
                  onChange={(e) => {
                    const v = e.target.value
                      .replace(/[^A-Za-z0-9]/g, "")
                      .toUpperCase();
                    setOtp(v.slice(0, OTP_LENGTH));
                  }}
                  className="w-full h-11 text-center text-lg tracking-[0.35em] font-mono uppercase border border-gray-200 rounded-lg px-4 focus:outline-none focus:ring-2 focus:ring-offset-0"
                  style={{
                    borderRadius: radiusPx,
                    ["--tw-ring-color" as string]: brandColor,
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={verifyLoading || otp.length < OTP_LENGTH}
                className="w-full h-11 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: brandColor, borderRadius: radiusPx }}
              >
                {verifyLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Go to dashboard"
                )}
              </button>
            </form>
            <p className="text-center">
              <button
                type="button"
                onClick={() => setStep("form")}
                className="text-sm font-medium hover:underline"
                style={{ color: brandColor }}
              >
                Use a different email
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Success state (new application submitted) ─────────────────────────────
  if (joinMutation.isSuccess && !joinMutation.data?.alreadyApplied) {
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
                  { "--tw-ring-color": brandColor, borderRadius: radiusPx } as React.CSSProperties
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
                  { "--tw-ring-color": brandColor, borderRadius: radiusPx } as React.CSSProperties
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
