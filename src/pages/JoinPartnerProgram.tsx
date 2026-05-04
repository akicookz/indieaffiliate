import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type BackgroundMode = "cream" | "white" | "dark";
type Layout = "split" | "stacked" | "cover";

interface AvatarSlot {
  image: string | null;
  initials: string | null;
}

interface FaqItem {
  q: string;
  a: string;
}

interface CommissionProgramPublic {
  name: string;
  rate: number;
  type: "recurring" | "lifetime" | "one-time";
  durationMonths: number | null;
}

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
  wordmark: string | null;
  backgroundMode: BackgroundMode;
  layout: Layout;
  showSocialProof: boolean;
  showFaq: boolean;
  showEarningsCalculator: boolean;
  showTermsAcceptance: boolean;
  socialProofText: string | null;
  socialProofAvatars: AvatarSlot[];
  faqs: FaqItem[] | null;
  samplePlanName: string | null;
  samplePlanPrice: number | null;
  commissionProgram: CommissionProgramPublic | null;
}

const BACKGROUNDS: Record<
  BackgroundMode,
  { bg: string; card: string; fg: string; muted: string; border: string }
> = {
  cream: {
    bg: "#f7f5f0",
    card: "#fdfcf9",
    fg: "#1c1917",
    muted: "#78716c",
    border: "#e7e5e4",
  },
  white: {
    bg: "#ffffff",
    card: "#fafafa",
    fg: "#1c1917",
    muted: "#78716c",
    border: "#e7e5e4",
  },
  dark: {
    bg: "#0a0a0a",
    card: "#171717",
    fg: "#ededed",
    muted: "#a3a3a3",
    border: "#262626",
  },
};

const FAQ_ITEMS = [
  { q: "When do I get paid?", a: "Payouts run on the 12th of each month for the prior month." },
  { q: "What about refunds?", a: "A 30-day clawback window applies to fresh referrals." },
  { q: "Can I use paid ads?", a: "Branded paid ads are not allowed." },
  { q: "Is there a minimum payout?", a: "Yes — $50, accumulated until met." },
];

const FEATURES = [
  { t: "Recurring 30%", d: "For the first 3 months" },
  { t: "Net-15 payouts", d: "Wise, PayPal, or ACH" },
  { t: "Live attribution", d: "See clicks & conversions live" },
  { t: "Fair fraud rules", d: "No surprises, no clawbacks" },
];

const AVATAR_PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

function deriveWordmark(wordmark: string | null, projectName: string): string {
  const explicit = wordmark?.trim();
  if (explicit) return explicit.toUpperCase();
  return projectName.trim().slice(0, 20).toUpperCase() || "PARTNERS";
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
  const [applyOpen, setApplyOpen] = useState(false);

  const {
    data: pageData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["join", slug],
    queryFn: async (): Promise<JoinPageData> => {
      const response = await fetch(`/api/join/${slug}`, { credentials: "include" });
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
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!response.ok) {
        let message = "Something went wrong";
        try {
          const err = await response.json();
          message = (err as { error?: string }).error ?? message;
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
        credentials: "include",
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

  const brandColor = pageData?.brandColor || "#c2410c";
  const fontFamily = pageData?.fontFamily || "Inter";
  const backgroundMode: BackgroundMode =
    pageData?.backgroundMode && BACKGROUNDS[pageData.backgroundMode]
      ? pageData.backgroundMode
      : "cream";
  const layout: Layout = pageData?.layout ?? "split";
  const palette = BACKGROUNDS[backgroundMode];
  const tinted =
    backgroundMode === "dark" ? `${brandColor}33` : `${brandColor}22`;

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

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#f7f5f0" }}
      >
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#a8a29e" }} />
      </div>
    );
  }

  // ─── 404 ──────────────────────────────────────────────────────────────────
  if (error || !pageData) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: "#f7f5f0", fontFamily: `"Inter", sans-serif` }}
      >
        <div className="text-center space-y-3 max-w-md">
          <h1
            className="text-3xl tracking-tight"
            style={{
              fontFamily: `"Source Serif 4", Georgia, serif`,
              color: "#1c1917",
            }}
          >
            Program not found
          </h1>
          <p style={{ color: "#78716c" }}>
            This affiliate program doesn't exist or is no longer accepting
            applications.
          </p>
        </div>
      </div>
    );
  }

  const wordmark = deriveWordmark(pageData.wordmark, pageData.projectName);
  const visibleAvatars = (pageData.socialProofAvatars ?? []).filter(
    (a) => a.image || a.initials,
  );
  const hasSocialProof =
    pageData.showSocialProof &&
    (visibleAvatars.length > 0 ||
      (pageData.socialProofText ?? "").trim().length > 0);
  const isSplit = layout === "split";
  const isCover = layout === "cover";

  return (
    <PageShell
      brandColor={brandColor}
      wordmark={wordmark}
      logo={pageData.logo}
      fontFamily={fontFamily}
      palette={palette}
      coverMode={isCover}
    >
      {/* Hero */}
      {isCover ? (
        <section
          className="relative min-h-[600px] flex items-center justify-center px-6 md:px-10 lg:px-16 py-32 text-center overflow-hidden"
          style={{
            backgroundColor: brandColor,
            backgroundImage: pageData.backgroundImage
              ? `url(${pageData.backgroundImage})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {pageData.backgroundImage && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
            />
          )}
          <div className="relative z-[1] max-w-3xl space-y-6">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide"
              style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#ffffff",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: "#ffffff" }}
              />
              NOW ACCEPTING
            </span>

            <h1
              className="text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                color: "#ffffff",
                fontWeight: 500,
              }}
            >
              {pageData.headline}
            </h1>

            {pageData.description && (
              <p
                className="text-base md:text-lg leading-relaxed mx-auto max-w-xl"
                style={{ color: "rgba(255,255,255,0.85)" }}
              >
                {pageData.description}
              </p>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                className="px-5 py-2.5 rounded-md text-sm font-medium inline-flex items-center gap-2 transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#ffffff", color: brandColor }}
              >
                {pageData.ctaText || "Apply to join"}{" "}
                <span aria-hidden>→</span>
              </button>
              <a
                href="#how-it-works"
                className="px-5 py-2.5 rounded-md text-sm font-medium border inline-flex items-center transition-colors"
                style={{
                  borderColor: "rgba(255,255,255,0.4)",
                  color: "#ffffff",
                }}
              >
                How it works
              </a>
            </div>

            {hasSocialProof && (
              <div className="flex items-center justify-center gap-3 pt-3">
                {visibleAvatars.length > 0 && (
                  <div className="flex -space-x-1.5">
                    {visibleAvatars.map((slot, idx) => (
                      <div
                        key={idx}
                        className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-white overflow-hidden"
                        style={{
                          backgroundColor: slot.image
                            ? "transparent"
                            : AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                          borderColor: "#ffffff",
                        }}
                      >
                        {slot.image ? (
                          <img
                            src={slot.image}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          slot.initials
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {pageData.socialProofText?.trim() && (
                  <span
                    className="text-sm"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                  >
                    {pageData.socialProofText}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="px-6 md:px-10 lg:px-16 pt-12 pb-16">
          <div
            className={
              isSplit
                ? "max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 lg:gap-16 items-start"
                : "max-w-3xl mx-auto"
            }
          >
            <div className="space-y-6">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide"
                style={{ backgroundColor: tinted, color: brandColor }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: brandColor }}
                />
                NOW ACCEPTING
              </span>

              <h1
                className="text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight"
                style={{
                  fontFamily: `"Source Serif 4", Georgia, serif`,
                  color: palette.fg,
                  fontWeight: 500,
                }}
              >
                {pageData.headline}
              </h1>

              {pageData.description && (
                <p
                  className="text-base md:text-lg max-w-xl leading-relaxed"
                  style={{ color: palette.muted }}
                >
                  {pageData.description}
                </p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setApplyOpen(true)}
                  className="px-5 py-2.5 rounded-md text-sm font-medium text-white inline-flex items-center gap-2 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: brandColor }}
                >
                  {pageData.ctaText || "Apply to join"}{" "}
                  <span aria-hidden>→</span>
                </button>
                <a
                  href="#how-it-works"
                  className="px-5 py-2.5 rounded-md text-sm font-medium border inline-flex items-center transition-colors"
                  style={{
                    borderColor: palette.muted + "55",
                    color: palette.fg,
                  }}
                >
                  How it works
                </a>
              </div>

              {hasSocialProof && (
                <div className="flex items-center gap-3 pt-3">
                  {visibleAvatars.length > 0 && (
                    <div className="flex -space-x-1.5">
                      {visibleAvatars.map((slot, idx) => (
                        <div
                          key={idx}
                          className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-white overflow-hidden"
                          style={{
                            backgroundColor: slot.image
                              ? "transparent"
                              : AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                            borderColor: palette.bg,
                          }}
                        >
                          {slot.image ? (
                            <img
                              src={slot.image}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            slot.initials
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {pageData.socialProofText?.trim() && (
                    <span
                      className="text-sm"
                      style={{ color: palette.muted }}
                    >
                      {pageData.socialProofText}
                    </span>
                  )}
                </div>
              )}
            </div>

            {isSplit && (
              <aside
                className="rounded-md border p-6 space-y-4"
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                }}
              >
                <p
                  className="text-xs font-semibold tracking-[0.12em] uppercase"
                  style={{ color: palette.muted }}
                >
                  Earn alongside
                </p>
                <ul className="space-y-3">
                  {FEATURES.map((item) => (
                    <li key={item.t} className="flex items-start gap-2.5">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5"
                        style={{ backgroundColor: tinted }}
                      >
                        <Check
                          className="w-3 h-3"
                          style={{ color: brandColor }}
                        />
                      </span>
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: palette.fg }}
                        >
                          {item.t}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: palette.muted }}
                        >
                          {item.d}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        </section>
      )}

      {/* Earnings Calculator */}
      {pageData.showEarningsCalculator &&
        pageData.commissionProgram &&
        pageData.samplePlanPrice != null &&
        pageData.samplePlanPrice > 0 && (
          <section
            className="px-6 md:px-10 lg:px-16 py-14 border-t"
            style={{ borderColor: palette.border }}
          >
            <div className="max-w-3xl mx-auto">
              <EarningsCalculator
                brandColor={brandColor}
                tinted={tinted}
                palette={palette}
                planName={pageData.samplePlanName || "Pro plan"}
                planPrice={pageData.samplePlanPrice}
                program={pageData.commissionProgram}
              />
            </div>
          </section>
        )}

      {/* FAQ */}
      {pageData.showFaq && (
        <section
          id="how-it-works"
          className="px-6 md:px-10 lg:px-16 py-14 border-t"
          style={{ borderColor: palette.border }}
        >
          <div className="max-w-6xl mx-auto">
            <h2
              className="text-3xl md:text-4xl tracking-tight mb-8"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                color: palette.fg,
                fontWeight: 500,
              }}
            >
              Frequently asked
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
              {(pageData.faqs && pageData.faqs.length > 0
                ? pageData.faqs
                : FAQ_ITEMS
              ).map((item, idx) => (
                <div key={`${item.q}-${idx}`} className="space-y-1.5">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: palette.fg }}
                  >
                    {item.q}
                  </p>
                  <p className="text-sm" style={{ color: palette.muted }}>
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Apply Dialog */}
      <ApplyDialog
        open={applyOpen}
        onOpenChange={(o) => {
          setApplyOpen(o);
          if (!o) setOtp("");
        }}
        brandColor={brandColor}
        tinted={tinted}
        projectName={pageData.projectName}
        ctaText={pageData.ctaText}
        showTermsAcceptance={pageData.showTermsAcceptance}
        name={name}
        email={email}
        otp={otp}
        setName={setName}
        setEmail={setEmail}
        setOtp={setOtp}
        joinMutation={joinMutation}
        otpMutation={otpMutation}
        resendMutation={resendMutation}
        resendCooldown={resendCooldown}
        onSubmit={handleSubmit}
        onVerify={handleVerifyOtp}
      />
    </PageShell>
  );
}

// ─── Apply Dialog ──────────────────────────────────────────────────────────
type Mut<T> = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: { message: string } | null;
  data?: T;
  mutate: () => void;
};

function ApplyDialog({
  open,
  onOpenChange,
  brandColor,
  tinted,
  projectName,
  ctaText,
  showTermsAcceptance,
  name,
  email,
  otp,
  setName,
  setEmail,
  setOtp,
  joinMutation,
  otpMutation,
  resendMutation,
  resendCooldown,
  onSubmit,
  onVerify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandColor: string;
  tinted: string;
  projectName: string;
  ctaText: string;
  showTermsAcceptance: boolean;
  name: string;
  email: string;
  otp: string;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setOtp: (v: string) => void;
  joinMutation: Mut<{ status: string; message: string }>;
  otpMutation: Mut<{ status: string; message?: string; redirect?: string }>;
  resendMutation: Mut<{ status: string; message: string }>;
  resendCooldown: number;
  onSubmit: (e: React.FormEvent) => void;
  onVerify: (e: React.FormEvent) => void;
}) {
  const otpRequired =
    joinMutation.isSuccess && joinMutation.data?.status === "otp_required";
  const joinFinished =
    joinMutation.isSuccess && joinMutation.data?.status !== "otp_required";

  if (otpMutation.isSuccess && otpMutation.data?.redirect) {
    if (typeof window !== "undefined") {
      window.location.href = otpMutation.data.redirect;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md p-0 overflow-hidden border"
        style={{ borderColor: "#e7e5e4" }}
      >
        <div className="p-6 space-y-5" style={{ backgroundColor: "#fdfcf9" }}>
          <div>
            <p
              className="text-xs font-semibold tracking-[0.12em] uppercase"
              style={{ color: brandColor }}
            >
              {projectName}
            </p>
            <DialogTitle
              className="text-2xl tracking-tight mt-1"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                color: "#1c1917",
                fontWeight: 500,
              }}
            >
              {otpMutation.isSuccess
                ? "Check your email"
                : joinFinished
                  ? joinMutation.data?.status === "active"
                    ? "You're in!"
                    : "Application submitted"
                  : otpRequired
                    ? "Enter your code"
                    : "Apply to join"}
            </DialogTitle>
          </div>

          {otpMutation.isSuccess ? (
            <div className="text-center space-y-4 py-4">
              <span
                className="inline-flex items-center justify-center w-12 h-12 rounded-full"
                style={{ backgroundColor: tinted }}
              >
                <CheckCircle2 className="w-6 h-6" style={{ color: brandColor }} />
              </span>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "#57534e" }}
              >
                We verified your code and emailed a sign-in link to{" "}
                <strong style={{ color: "#1c1917" }}>{email}</strong>. Click the
                link in that email to access your partner dashboard.
              </p>
            </div>
          ) : joinFinished ? (
            <div className="text-center space-y-4 py-4">
              <span
                className="inline-flex items-center justify-center w-12 h-12 rounded-full"
                style={{ backgroundColor: tinted }}
              >
                <CheckCircle2 className="w-6 h-6" style={{ color: brandColor }} />
              </span>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "#57534e" }}
              >
                {joinMutation.data?.message}
              </p>
            </div>
          ) : otpRequired ? (
            <form onSubmit={onVerify} className="space-y-4">
              <FieldLabel htmlFor="otp">One-time code</FieldLabel>
              <input
                id="otp"
                type="text"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="ABC123"
                className="w-full h-10 border bg-white px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:border-transparent transition-shadow tracking-[0.25em] text-center uppercase"
                style={
                  {
                    "--tw-ring-color": brandColor,
                    borderColor: "#e7e5e4",
                    color: "#1c1917",
                  } as React.CSSProperties
                }
              />
              <p className="text-xs" style={{ color: "#78716c" }}>
                We found an existing partner account. Enter the code we sent to{" "}
                <strong style={{ color: "#1c1917" }}>{email}</strong>.
              </p>

              {otpMutation.isError && otpMutation.error && (
                <p className="text-sm" style={{ color: "#dc2626" }}>
                  {otpMutation.error.message}
                </p>
              )}

              <PrimaryButton
                brandColor={brandColor}
                pending={otpMutation.isPending}
                disabled={otpMutation.isPending || !otp.trim()}
                pendingLabel="Verifying"
              >
                Verify code
              </PrimaryButton>

              <div className="text-center pt-1">
                {resendMutation.isError && resendMutation.error && (
                  <p className="text-xs mb-2" style={{ color: "#dc2626" }}>
                    {resendMutation.error.message}
                  </p>
                )}
                {resendMutation.isSuccess && resendCooldown > 0 && (
                  <p className="text-xs mb-2" style={{ color: "#15803d" }}>
                    New code sent.
                  </p>
                )}
                <button
                  type="button"
                  disabled={
                    resendMutation.isPending ||
                    resendCooldown > 0 ||
                    !email
                  }
                  onClick={() => resendMutation.mutate()}
                  className="text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:underline"
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
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="name">Full name</FieldLabel>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full h-10 border bg-white px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                  style={
                    {
                      "--tw-ring-color": brandColor,
                      borderColor: "#e7e5e4",
                      color: "#1c1917",
                    } as React.CSSProperties
                  }
                />
              </div>

              <div className="space-y-1.5">
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full h-10 border bg-white px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                  style={
                    {
                      "--tw-ring-color": brandColor,
                      borderColor: "#e7e5e4",
                      color: "#1c1917",
                    } as React.CSSProperties
                  }
                />
              </div>

              {joinMutation.isError && joinMutation.error && (
                <p className="text-sm" style={{ color: "#dc2626" }}>
                  {joinMutation.error.message}
                </p>
              )}

              <PrimaryButton
                brandColor={brandColor}
                pending={joinMutation.isPending}
                disabled={
                  joinMutation.isPending || !name.trim() || !email.trim()
                }
                pendingLabel="Submitting"
              >
                {ctaText || "Apply to join"}
              </PrimaryButton>

              {showTermsAcceptance && (
                <p
                  className="text-xs text-center"
                  style={{ color: "#a8a29e" }}
                >
                  By applying you agree to the program terms.
                </p>
              )}
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────────────
function PageShell({
  brandColor,
  wordmark,
  logo,
  fontFamily,
  palette,
  coverMode,
  children,
}: {
  brandColor: string;
  wordmark: string;
  logo: string | null;
  fontFamily: string;
  palette: { bg: string; fg: string; muted: string; border: string };
  coverMode: boolean;
  children: React.ReactNode;
}) {
  const headerFg = coverMode ? "#ffffff" : palette.fg;
  const headerMuted = coverMode ? "rgba(255,255,255,0.7)" : palette.muted;
  return (
    <div
      className="min-h-screen flex flex-col relative"
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        fontFamily: `"${fontFamily}", "Inter", system-ui, sans-serif`,
      }}
    >
      <header
        className={
          coverMode
            ? "absolute top-0 left-0 right-0 z-10 px-6 md:px-10 lg:px-16 py-5"
            : "px-6 md:px-10 lg:px-16 py-5"
        }
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {logo ? (
              <img src={logo} alt="" className="h-7 object-contain" />
            ) : (
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center text-sm text-white"
                style={{
                  backgroundColor: brandColor,
                  fontFamily: `"Source Serif 4", Georgia, serif`,
                  fontWeight: 600,
                }}
              >
                {wordmark.charAt(0).toLowerCase()}
              </div>
            )}
            <span
              className="text-base tracking-wide"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                fontWeight: 600,
                color: headerFg,
              }}
            >
              {wordmark}
            </span>
          </div>
          <nav
            className="hidden sm:flex items-center gap-7 text-sm"
            style={{ color: headerMuted }}
          >
            <a href="#how-it-works" className="transition-colors">
              How it works
            </a>
            <a href="#terms" className="transition-colors">
              Terms
            </a>
            <a href="/login" style={{ color: headerFg }}>
              Sign in
            </a>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold tracking-[0.08em] uppercase"
      style={{ color: "#57534e" }}
    >
      {children}
    </label>
  );
}

function PrimaryButton({
  brandColor,
  pending,
  disabled,
  pendingLabel,
  children,
}: {
  brandColor: string;
  pending: boolean;
  disabled: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full h-10 text-white text-sm font-medium rounded-md transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
      style={{ backgroundColor: brandColor }}
    >
      {pending && <Loader2 className="w-4 h-4 animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

// ─── Earnings Calculator ───────────────────────────────────────────────────
function EarningsCalculator({
  brandColor,
  tinted,
  palette,
  planName,
  planPrice,
  program,
}: {
  brandColor: string;
  tinted: string;
  palette: { fg: string; muted: string; card: string; border: string };
  planName: string;
  planPrice: number;
  program: CommissionProgramPublic;
}) {
  const [referrals, setReferrals] = useState(10);
  const rateFrac = program.rate / 100;
  const isOneTime = program.type === "one-time";
  const monthlyPerReferral = planPrice * rateFrac;
  const monthlyEarnings = isOneTime ? 0 : referrals * monthlyPerReferral;
  const oneTimeEarnings = isOneTime ? referrals * monthlyPerReferral : 0;
  const totalProjection =
    program.type === "recurring" && program.durationMonths
      ? referrals * monthlyPerReferral * program.durationMonths
      : isOneTime
        ? oneTimeEarnings
        : referrals * monthlyPerReferral * 12;

  return (
    <div className="space-y-5">
      <div>
        <p
          className="text-xs font-semibold tracking-[0.12em] uppercase"
          style={{ color: palette.muted }}
        >
          Earnings calculator
        </p>
        <h2
          className="text-3xl md:text-4xl tracking-tight mt-1"
          style={{
            fontFamily: `"Source Serif 4", Georgia, serif`,
            color: palette.fg,
            fontWeight: 500,
          }}
        >
          See what you'd earn
        </h2>
      </div>

      <div
        className="rounded-md border p-6 space-y-6"
        style={{ backgroundColor: palette.card, borderColor: palette.border }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: palette.muted }}>{planName}</span>
          <span className="font-mono" style={{ color: palette.fg }}>
            ${planPrice}/mo
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: palette.muted }}>Referrals you bring</span>
            <span className="font-mono" style={{ color: palette.fg }}>
              {referrals}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            value={referrals}
            onChange={(e) => setReferrals(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: brandColor }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-md p-4"
            style={{ backgroundColor: tinted }}
          >
            <p
              className="text-[10px] font-semibold tracking-[0.12em] uppercase"
              style={{ color: brandColor }}
            >
              {isOneTime ? "One-time" : "Per month"}
            </p>
            <p
              className="text-3xl mt-1"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                color: palette.fg,
                fontWeight: 500,
              }}
            >
              ${(isOneTime ? oneTimeEarnings : monthlyEarnings).toFixed(0)}
            </p>
          </div>
          <div
            className="rounded-md p-4 border"
            style={{ borderColor: palette.border }}
          >
            <p
              className="text-[10px] font-semibold tracking-[0.12em] uppercase"
              style={{ color: palette.muted }}
            >
              {program.type === "recurring" && program.durationMonths
                ? `Over ${program.durationMonths} months`
                : isOneTime
                  ? "Total"
                  : "Annual projection"}
            </p>
            <p
              className="text-3xl mt-1"
              style={{
                fontFamily: `"Source Serif 4", Georgia, serif`,
                color: palette.fg,
                fontWeight: 500,
              }}
            >
              ${totalProjection.toFixed(0)}
            </p>
          </div>
        </div>

        <p className="text-xs" style={{ color: palette.muted }}>
          Based on {program.name} ({program.rate}% {program.type}
          {program.type === "recurring" && program.durationMonths
            ? ` × ${program.durationMonths} mo`
            : ""}
          ).
        </p>
      </div>
    </div>
  );
}

export default JoinPartnerProgram;
