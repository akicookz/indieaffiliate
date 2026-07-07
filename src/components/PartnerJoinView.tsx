// Shared renderer for the public partner join page — Stripe-style split:
// accent-colored brand panel (logo, pitch, program facts) on the left,
// the application form on white on the right. Used by both the live page
// (JoinPartnerProgram) and the designer preview (PartnerPageDesigner).
import { useState } from "react";

export interface PartnerJoinProgram {
  rate: number;
  type: "recurring" | "lifetime" | "one-time";
  durationMonths: number | null;
  flatAmount: number | null;
  minPayout?: number | null;
  payoutCadence?: string | null;
}

export interface PartnerJoinAvatar {
  image: string | null;
  initials: string | null;
}

export interface PartnerJoinFaq {
  q: string;
  a: string;
}

export interface PartnerJoinData {
  wordmark: string;
  projectName: string;
  logo: string | null;
  headline: string;
  description: string | null;
  ctaText: string;
  program: PartnerJoinProgram | null;
  socialProofText: string | null;
  avatars: PartnerJoinAvatar[];
  faqs: PartnerJoinFaq[];
  partnerAgreement: string | null;
}

// Apply flow state, lifted so the live page can drive it and the preview can
// render an inert snapshot (interactive: false).
export interface PartnerJoinForm {
  step: "form" | "otp" | "done";
  name: string;
  email: string;
  promo: string;
  otp: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  onPromo: (v: string) => void;
  onOtp: (v: string) => void;
  onSubmit: () => void;
  onVerify: () => void;
  onResend: () => void;
  submitting: boolean;
  verifying: boolean;
  error: string | null;
  notice: string | null;
  resendCooldown: number;
  interactive: boolean;
}

export interface PartnerJoinViewProps {
  accent: string;
  data: PartnerJoinData;
  form: PartnerJoinForm;
}

// ─── Color helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(s || "000000", 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readableOn(hex: string) {
  return luminance(hex) > 0.6 ? "#141414" : "#ffffff";
}
function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function mix(hex: string, target: [number, number, number], amt: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (target[0] - r) * amt,
    g + (target[1] - g) * amt,
    b + (target[2] - b) * amt,
  );
}
// Subtle Stripe-like depth on the brand panel: light source top-left,
// deepening toward the bottom-right.
function panelGradient(accent: string) {
  return `linear-gradient(150deg, ${mix(accent, [255, 255, 255], 0.1)} 0%, ${accent} 42%, ${mix(accent, [0, 0, 0], 0.24)} 100%)`;
}

// ─── Program facts ──────────────────────────────────────────────────────────

// Referral cookies are set with a 30-day Max-Age by the tracking endpoints
// (worker/index.ts) — keep this in sync if that ever changes.
const ATTRIBUTION_WINDOW = "30-day cookie";

function cadenceLabel(cadence: string | null | undefined): string {
  if (!cadence) return "Monthly";
  const map: Record<string, string> = {
    monthly: "Monthly",
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
  };
  return map[cadence] ?? cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

function programFacts(
  program: PartnerJoinProgram | null,
): { label: string; value: string }[] {
  if (!program) {
    return [
      { label: "Commission", value: "Generous" },
      { label: "Earning window", value: "Recurring" },
      { label: "Attribution", value: ATTRIBUTION_WINDOW },
      { label: "Payouts", value: "Monthly" },
    ];
  }
  const commission =
    program.type === "one-time" && program.flatAmount != null
      ? `$${program.flatAmount.toLocaleString("en-US")} one-time`
      : `${program.rate}% ${program.type === "recurring" ? "recurring" : program.type}`;
  const window =
    program.type === "one-time"
      ? "Per referral"
      : program.durationMonths
        ? `First ${program.durationMonths} month${program.durationMonths === 1 ? "" : "s"}`
        : program.type === "lifetime"
          ? "Lifetime"
          : "Every renewal";
  const facts = [
    { label: "Commission", value: commission },
    { label: "Earning window", value: window },
    { label: "Attribution", value: ATTRIBUTION_WINDOW },
    { label: "Payouts", value: cadenceLabel(program.payoutCadence) },
  ];
  if (program.minPayout != null && program.minPayout > 0) {
    facts.push({
      label: "Minimum payout",
      value: `$${program.minPayout.toLocaleString("en-US")}`,
    });
  }
  return facts;
}

// ─── View ───────────────────────────────────────────────────────────────────

const SANS = '"Inter", system-ui, -apple-system, sans-serif';

export default function PartnerJoinView({
  accent,
  data,
  form,
}: PartnerJoinViewProps) {
  const [agreementOpen, setAgreementOpen] = useState(false);
  const onOpenAgreement = () => setAgreementOpen(true);

  const fg = readableOn(accent); // text color on the accent panel
  const muted = withAlpha(fg, 0.72);
  const hairline = withAlpha(fg, 0.2);
  const facts = programFacts(data.program);
  const avatars = data.avatars.filter((a) => a.image || a.initials);

  return (
    <div
      style={
        {
          containerType: "inline-size",
          width: "100%",
          fontFamily: SANS,
          // Drive :focus styles in the injected stylesheet from the accent.
          "--pjv-accent": accent,
          "--pjv-accent-ring": `${accent}2e`,
        } as React.CSSProperties
      }
    >
      <div
        className="pjv-split"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          minHeight: "100vh",
        }}
      >
        {/* ─── Left: accent brand panel ──────────────────────────────────── */}
        <div
          style={{
            background: panelGradient(accent),
            color: fg,
            display: "flex",
            flexDirection: "column",
            padding: "clamp(28px, 4cqw, 56px)",
          }}
        >
          {/* centered content column, mirroring the form side */}
          <div
            style={{
              width: "min(520px, 100%)",
              margin: "0 auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
          {/* brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {data.logo ? (
              <img
                src={data.logo}
                alt={data.wordmark}
                style={{ height: 30, objectFit: "contain" }}
              />
            ) : (
              <>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background: fg,
                    color: accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 15,
                  }}
                >
                  {(data.wordmark.trim()[0] ?? "P").toUpperCase()}
                </div>
                <span style={{ fontWeight: 700, fontSize: 17 }}>
                  {data.wordmark}
                </span>
              </>
            )}
          </div>

          {/* pitch — vertically centered between the brand row and footer */}
          <div style={{ margin: "auto 0", padding: "clamp(36px, 6cqh, 64px) 0" }}>
            <h1
              style={{
                fontSize: "clamp(32px, 3.8cqw, 50px)",
                lineHeight: 1.06,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: 0,
                maxWidth: 520,
              }}
            >
              {data.headline}
            </h1>
            {data.description && (
              <p
                style={{
                  fontSize: 17,
                  lineHeight: 1.55,
                  color: muted,
                  maxWidth: 460,
                  margin: "18px 0 0",
                }}
              >
                {data.description}
              </p>
            )}

            {/* program facts */}
            <div style={{ marginTop: 36, maxWidth: 460 }}>
              {facts.map((f) => (
                <div
                  key={f.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 16,
                    padding: "14px 0",
                    borderBottom: `1px solid ${hairline}`,
                  }}
                >
                  <span style={{ fontSize: 14, color: muted }}>{f.label}</span>
                  <span style={{ fontSize: 17, fontWeight: 700 }}>
                    {f.value}
                  </span>
                </div>
              ))}
            </div>

            {/* social proof */}
            {data.socialProofText && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginTop: 32,
                }}
              >
                {avatars.length > 0 && (
                  <div style={{ display: "flex" }}>
                    {avatars.slice(0, 5).map((a, i) => (
                      <div
                        key={i}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          marginLeft: i === 0 ? 0 : -10,
                          background: a.image ? undefined : fg,
                          backgroundImage: a.image
                            ? `url(${a.image})`
                            : undefined,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          color: accent,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: 12,
                          boxShadow: `0 0 0 2px ${accent}`,
                        }}
                      >
                        {!a.image && a.initials}
                      </div>
                    ))}
                  </div>
                )}
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    margin: 0,
                    maxWidth: 380,
                  }}
                >
                  {data.socialProofText}
                </p>
              </div>
            )}
          </div>

          {/* panel footer — pitch's auto margins push this to the bottom */}
          <div
            style={{
              paddingTop: 24,
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 13,
              color: muted,
            }}
          >
            <a
              className="pjv-link"
              href={form.interactive ? "https://unlockaffiliate.com" : undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: muted,
                textDecoration: "none",
                cursor: form.interactive ? "pointer" : "default",
              }}
            >
              Powered by <span style={{ fontWeight: 600 }}>UnlockAffiliate</span>
            </a>
            <AgreementLink onOpen={onOpenAgreement} color={muted} />
          </div>
          </div>
        </div>

        {/* ─── Right: form panel ─────────────────────────────────────────── */}
        <div
          style={{
            background: "#ffffff",
            color: "#1a1a1e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(28px, 4cqw, 56px)",
          }}
        >
          <div style={{ width: "min(400px, 100%)" }}>
            <h2
              style={{
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                margin: "0 0 24px",
              }}
            >
              Become a partner
            </h2>

            <ApplyFields
              form={form}
              accent={accent}
              ctaLabel={data.ctaText || "Apply to join"}
              onOpenAgreement={onOpenAgreement}
            />

            <div
              style={{
                margin: "26px 0 0",
                paddingTop: 20,
                borderTop: "1px solid #ebebee",
                fontSize: 14,
                color: "#6d6d76",
                textAlign: "center",
              }}
            >
              Already a partner?{" "}
              <a
                className="pjv-link"
                href={form.interactive ? "/partner-login" : undefined}
                style={{
                  color: "#1a1a1e",
                  fontWeight: 600,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  cursor: form.interactive ? "pointer" : "default",
                }}
              >
                Sign in →
              </a>
            </div>

            {/* FAQs — owner-written only */}
            {data.faqs.length > 0 && (
              <div style={{ marginTop: 34 }}>
                {data.faqs.map((f) => (
                  <div key={f.q} style={{ marginBottom: 18 }}>
                    <p
                      style={{
                        fontSize: 14.5,
                        fontWeight: 600,
                        margin: "0 0 4px",
                      }}
                    >
                      {f.q}
                    </p>
                    <p
                      style={{
                        fontSize: 14,
                        lineHeight: 1.5,
                        color: "#6d6d76",
                        margin: 0,
                      }}
                    >
                      {f.a}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {agreementOpen && (
        <AgreementModal
          accent={accent}
          data={data}
          onClose={() => setAgreementOpen(false)}
        />
      )}

      <style>{`
        .pjv-input {
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .pjv-input:hover:not(:focus):not(:disabled) {
          border-color: #b9b9c2 !important;
        }
        .pjv-input:focus {
          outline: none;
          border-color: var(--pjv-accent) !important;
          box-shadow: 0 0 0 3px var(--pjv-accent-ring);
        }
        .pjv-btn {
          transition: filter 0.15s ease, transform 0.05s ease;
        }
        .pjv-btn:hover:not(:disabled) { filter: brightness(1.08); }
        .pjv-btn:active:not(:disabled) { transform: translateY(1px); }
        .pjv-link { transition: opacity 0.15s ease; }
        .pjv-link:hover { opacity: 0.75; }
        @container (max-width: 820px) {
          .pjv-split { grid-template-columns: 1fr !important; min-height: 0 !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Apply form ─────────────────────────────────────────────────────────────

const FIELD_STYLE: React.CSSProperties = {
  border: "1px solid #d9d9de",
  borderRadius: 8,
  background: "#ffffff",
  padding: "9px 12px",
  fontSize: 14.5,
  color: "#1a1a1e",
  width: "100%",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#3a3a41",
  marginBottom: 6,
};

function ApplyFields({
  form,
  accent,
  ctaLabel,
  onOpenAgreement,
}: {
  form: PartnerJoinForm;
  accent: string;
  ctaLabel: string;
  onOpenAgreement: () => void;
}) {
  const disabled = !form.interactive || form.submitting;

  const buttonStyle: React.CSSProperties = {
    background: accent,
    color: readableOn(accent),
    borderRadius: 8,
    padding: "10px",
    fontWeight: 600,
    fontSize: 14.5,
    width: "100%",
    border: "none",
    opacity: disabled ? 0.65 : 1,
    cursor: form.interactive ? "pointer" : "default",
  };

  if (form.step === "done") {
    return (
      <div style={{ fontSize: 15, lineHeight: 1.5 }}>
        <p style={{ fontWeight: 700, margin: "0 0 6px" }}>You're in 🎉</p>
        <p style={{ color: "#6d6d76", margin: 0 }}>
          {form.notice || "Check your email for next steps."}
        </p>
      </div>
    );
  }

  if (form.step === "otp") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ fontSize: 14, color: "#6d6d76", margin: 0, lineHeight: 1.5 }}>
          {form.notice || `We emailed a code to ${form.email}. Enter it below.`}
        </p>
        <input
          className="pjv-input"
          value={form.otp}
          onChange={(e) => form.onOtp(e.target.value)}
          placeholder="ABC123"
          disabled={disabled}
          style={{ ...FIELD_STYLE, letterSpacing: "0.3em", textAlign: "center" }}
        />
        {form.error && <FieldError>{form.error}</FieldError>}
        <button
          type="button"
          onClick={form.onVerify}
          disabled={disabled || form.verifying}
          className="pjv-btn"
          style={buttonStyle}
        >
          {form.verifying ? "Verifying…" : "Verify & join"}
        </button>
        <button
          type="button"
          onClick={form.onResend}
          disabled={disabled || form.resendCooldown > 0}
          style={{
            background: "none",
            border: "none",
            color: "#6d6d76",
            fontSize: 13,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {form.resendCooldown > 0
            ? `Resend in ${form.resendCooldown}s`
            : "Resend code"}
        </button>
      </div>
    );
  }

  const field = (
    label: string,
    placeholder: string,
    value: string,
    onChange: (v: string) => void,
    type = "text",
  ) => (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        className="pjv-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={FIELD_STYLE}
      />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {field("Full name", "Jane Doe", form.name, form.onName)}
      {field("Email", "you@company.com", form.email, form.onEmail, "email")}
      {field(
        "Where will you promote us?",
        "yoursite.com, newsletter…",
        form.promo,
        form.onPromo,
      )}
      {form.error && <FieldError>{form.error}</FieldError>}
      <button
        type="button"
        onClick={form.onSubmit}
        disabled={disabled}
        className="pjv-btn"
        style={buttonStyle}
      >
        {form.submitting ? "Sending…" : `${ctaLabel} →`}
      </button>
      <p
        style={{
          fontSize: 12.5,
          color: "#8a8a92",
          margin: 0,
          textAlign: "center",
        }}
      >
        By continuing you agree to the{" "}
        <AgreementLink onOpen={onOpenAgreement} color="#8a8a92" />.
      </p>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, color: "#b3261e", margin: 0 }}>{children}</p>
  );
}

// ─── Partner agreement ──────────────────────────────────────────────────────

const DEFAULT_AGREEMENT = `This Partner Agreement governs your participation in this partner program.

1. Commission. You earn the commission shown on this page for qualifying sales attributed to your referral link. Commissions are calculated on net revenue after refunds, chargebacks, and cancellations.

2. Payouts. Approved commissions are paid on a monthly basis. A commission is approved once the referred payment has cleared and any refund window has passed.

3. Attribution. A sale is attributed to you when a customer you referred completes a purchase. The program owner determines attribution in good faith and their records are final.

4. Acceptable use. You may not use spam, misleading claims, trademark bidding, self-referrals, or incentivized traffic. Violations may result in withheld commissions and removal from the program.

5. Term. Either party may end this arrangement at any time. Commissions already approved will still be paid.`;

function AgreementLink({
  onOpen,
  color,
}: {
  onOpen: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      className="pjv-link"
      onClick={onOpen}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        color,
        fontFamily: "inherit",
        fontSize: "inherit",
        letterSpacing: "inherit",
        whiteSpace: "nowrap",
        textDecoration: "underline",
        textUnderlineOffset: 3,
      }}
    >
      Partner Agreement
    </button>
  );
}

function AgreementModal({
  accent,
  data,
  onClose,
}: {
  accent: string;
  data: PartnerJoinData;
  onClose: () => void;
}) {
  const text = (data.partnerAgreement ?? "").trim() || DEFAULT_AGREEMENT;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15,15,17,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: SANS,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          color: "#1c1c1c",
          borderRadius: 14,
          maxWidth: 680,
          width: "100%",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: "1px solid #eceae6",
          }}
        >
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
            Partner Agreement
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
              color: "#8a877f",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: "22px 24px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "#3f3d38",
          }}
        >
          {text}
        </div>
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #eceae6",
            textAlign: "right",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: accent,
              color: readableOn(accent),
              border: "none",
              borderRadius: 9,
              padding: "10px 20px",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
