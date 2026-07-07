import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import PartnerJoinView, {
  type PartnerJoinForm,
} from "@/components/PartnerJoinView";

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
  flatAmount: number | null;
  minPayout: number | null;
  payoutCadence: string | null;
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
  theme: string;
  showSocialProof: boolean;
  showFaq: boolean;
  showEarningsCalculator: boolean;
  showTermsAcceptance: boolean;
  socialProofText: string | null;
  socialProofAvatars: AvatarSlot[];
  faqs: FaqItem[] | null;
  partnerAgreement: string | null;
  samplePlanName: string | null;
  samplePlanPrice: number | null;
  commissionProgram: CommissionProgramPublic | null;
}



function getGoogleFontUrl(font: string): string {
  const family = font.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

function JoinPartnerProgram() {
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [promo, setPromo] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

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

  // Redirect to the partner portal once the OTP is verified.
  useEffect(() => {
    if (otpMutation.isSuccess && otpMutation.data?.redirect) {
      window.location.href = otpMutation.data.redirect;
    }
  }, [otpMutation.isSuccess, otpMutation.data]);

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

  const step: PartnerJoinForm["step"] = otpMutation.isSuccess
    ? "done"
    : joinMutation.isSuccess
      ? joinMutation.data?.status === "otp_required"
        ? "otp"
        : "done"
      : "form";

  const form: PartnerJoinForm = {
    step,
    name,
    email,
    promo,
    otp,
    onName: setName,
    onEmail: setEmail,
    onPromo: setPromo,
    onOtp: setOtp,
    onSubmit: () => {
      if (name.trim() && email.trim()) joinMutation.mutate();
    },
    onVerify: () => {
      if (otp.trim() && email.trim() && slug) otpMutation.mutate();
    },
    onResend: () => resendMutation.mutate(),
    submitting: joinMutation.isPending,
    verifying: otpMutation.isPending,
    error:
      (joinMutation.error as Error | null)?.message ??
      (otpMutation.error as Error | null)?.message ??
      null,
    notice: joinMutation.data?.message ?? null,
    resendCooldown,
    interactive: true,
  };

  return (
    <PartnerJoinView
      accent={brandColor}
      data={{
        wordmark: pageData.wordmark || pageData.projectName,
        projectName: pageData.projectName,
        logo: pageData.logo,
        headline: pageData.headline,
        description: pageData.description,
        ctaText: pageData.ctaText,
        program: pageData.commissionProgram
          ? {
              rate: pageData.commissionProgram.rate,
              type: pageData.commissionProgram.type,
              durationMonths: pageData.commissionProgram.durationMonths,
              flatAmount: pageData.commissionProgram.flatAmount,
              minPayout: pageData.commissionProgram.minPayout,
              payoutCadence: pageData.commissionProgram.payoutCadence,
            }
          : null,
        socialProofText: pageData.showSocialProof
          ? pageData.socialProofText
          : null,
        avatars: pageData.socialProofAvatars ?? [],
        faqs:
          pageData.showFaq && pageData.faqs
            ? pageData.faqs.map((f) => ({ q: f.q, a: f.a }))
            : [],
        partnerAgreement: pageData.partnerAgreement ?? null,
      }}
      form={form}
    />
  );
}

export default JoinPartnerProgram;
