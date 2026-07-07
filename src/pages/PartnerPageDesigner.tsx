import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Loader2,
  Monitor,
  Smartphone,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/PageHeader";
import PartnerJoinView, {
  type PartnerJoinForm,
} from "@/components/PartnerJoinView";

// Starter templates for the partner agreement. Selecting one fills the editor;
// the owner can edit freely or write their own from scratch.
const AGREEMENT_TEMPLATES: { label: string; text: string }[] = [
  {
    label: "Standard",
    text: `Partner Agreement

1. Commission. You earn the commission rate shown on the program page for qualifying sales attributed to your referral link. Commissions are calculated on net revenue after refunds, chargebacks, and cancellations.

2. Payouts. Approved commissions are paid monthly. A commission is approved once the referred payment has cleared and any refund window has passed.

3. Attribution. A sale is attributed to you when a customer you referred completes a purchase. The program owner determines attribution in good faith.

4. Acceptable use. No spam, misleading claims, trademark bidding, self-referrals, or incentivized traffic. Violations may result in withheld commissions and removal from the program.

5. Term. Either party may end this arrangement at any time. Commissions already approved will still be paid.`,
  },
  {
    label: "Simple",
    text: `Partner Agreement

By joining, you agree to promote us honestly and follow our brand guidelines. You'll earn the commission shown on this page on qualifying sales, paid monthly after refund windows close. No spam or self-referrals. Either side can end the partnership anytime; approved commissions are still paid.`,
  },
  { label: "Clear", text: "" },
];

// The preview is non-interactive — it shows the form's initial state only.
const INERT_FORM: PartnerJoinForm = {
  step: "form",
  name: "",
  email: "",
  promo: "",
  otp: "",
  onName: () => {},
  onEmail: () => {},
  onPromo: () => {},
  onOtp: () => {},
  onSubmit: () => {},
  onVerify: () => {},
  onResend: () => {},
  submitting: false,
  verifying: false,
  error: null,
  notice: null,
  resendCooldown: 0,
  interactive: false,
};

interface CommissionProgram {
  id: string;
  name: string;
  type: "recurring" | "lifetime" | "one-time";
  rate: number;
  flatAmount: number | null;
  durationMonths?: number | null;
  minPayout?: number | null;
  payoutCadence?: string | null;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
}

interface AvatarSlot {
  imageKey: string | null;
  imageUrl: string | null;
  initials: string | null;
}

interface FaqItem {
  q: string;
  a: string;
}

interface BrandingData {
  id: string;
  projectId: string;
  logo: string | null;
  brandColor: string;
  headline: string;
  description: string | null;
  backgroundImage: string | null;
  ctaText: string;
  fontFamily: string;
  borderRadius: string;
  autoApprove: boolean;
  defaultCommissionRate: number;
  defaultCommissionProgramId: string | null;
  portalName: string | null;
  wordmark: string | null;
  backgroundMode: BackgroundMode;
  layout: Layout;
  theme?: string;
  partnerAgreement?: string | null;
  showSocialProof: boolean;
  showFaq: boolean;
  showEarningsCalculator: boolean;
  showTermsAcceptance: boolean;
  socialProofText: string | null;
  socialProofAvatars: { image: string | null; initials: string | null }[] | null;
  faqs: FaqItem[] | null;
  samplePlanName: string | null;
  samplePlanPrice: number | null;
}

interface BrandingResponse {
  branding: BrandingData | null;
  joinUrl: string;
}

const ACCENTS = [
  { value: "#c2410c", label: "Orange" },
  { value: "#2563eb", label: "Blue" },
  { value: "#15803d", label: "Green" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#1c1917", label: "Black" },
  { value: "#db2777", label: "Pink" },
] as const;

type BackgroundMode = "cream" | "white" | "dark";
type Layout = "split" | "stacked" | "cover";
type DeviceMode = "desktop" | "mobile";

const AVATAR_PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

function emptyAvatarSlots(): AvatarSlot[] {
  return Array.from({ length: 5 }, () => ({
    imageKey: null,
    imageUrl: null,
    initials: null,
  }));
}

function formatProgramAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  });
}

const DEFAULTS = {
  brandColor: "#c2410c",
  // Keep defaults free of specific rates/durations — those come from the real
  // commission program (shown in the benefits card + calculator), so hardcoding
  // numbers here would contradict it.
  headline: "Earn recurring commission on every referral",
  description:
    "Join the partner program and get paid for every customer you bring along.",
  ctaText: "Apply to join",
  borderRadius: "soft",
  autoApprove: false,
};

function PartnerPageDesigner() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  const [brandColor, setBrandColor] = useState(DEFAULTS.brandColor);
  const [headline, setHeadline] = useState(DEFAULTS.headline);
  const [description, setDescription] = useState(DEFAULTS.description);
  const [ctaText, setCtaText] = useState(DEFAULTS.ctaText);
  const [autoApprove, setAutoApprove] = useState(DEFAULTS.autoApprove);
  const [defaultCommissionProgramId, setDefaultCommissionProgramId] = useState<
    string | null
  >(null);
  const [portalName, setPortalName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [wordmark, setWordmark] = useState("");
  const [background, setBackground] = useState<BackgroundMode>("cream");
  const [partnerAgreement, setPartnerAgreement] = useState("");
  const [device, setDevice] = useState<DeviceMode>("desktop");
  // The join page uses one fixed layout and a fixed set of sections (no picker,
  // no per-section toggles, no earnings calculator).
  const layout: Layout = "split";
  const sections = {
    socialProof: true,
    faq: true,
    earningsCalculator: false,
    termsAcceptance: true,
  };
  const [socialProofText, setSocialProofText] = useState("");
  const [avatarSlots, setAvatarSlots] = useState<AvatarSlot[]>(
    emptyAvatarSlots(),
  );
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [activeTab, setActiveTab] = useState<"general" | "content">("general");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);

  const { data: brandingData, isLoading } = useQuery({
    queryKey: ["branding", project?.id],
    queryFn: async (): Promise<BrandingResponse> => {
      const response = await fetch(`/api/projects/${project!.id}/branding`);
      if (!response.ok) throw new Error("Failed to fetch branding");
      return response.json();
    },
    enabled: !!project?.id,
  });

  const { data: programsData } = useQuery({
    queryKey: ["commission-programs", project?.id],
    queryFn: async (): Promise<{ programs: CommissionProgram[] }> => {
      const response = await fetch(
        `/api/projects/${project!.id}/commission-programs`,
      );
      if (!response.ok) throw new Error("Failed to fetch programs");
      return response.json();
    },
    enabled: !!project?.id,
  });
  const programs = programsData?.programs ?? [];

  useEffect(() => {
    if (!brandingData?.branding) return;
    const b = brandingData.branding;
    setBrandColor(b.brandColor);
    setHeadline(b.headline);
    setDescription(b.description ?? "");
    setCtaText(b.ctaText);
    setAutoApprove(b.autoApprove);
    setDefaultCommissionProgramId(b.defaultCommissionProgramId ?? null);
    setPortalName(b.portalName ?? "");
    setLogoUrl(b.logo);
    if (b.logo) {
      const parts = b.logo.split("/api/uploads/");
      setLogoKey(parts.length > 1 ? parts[1] : null);
    } else {
      setLogoKey(null);
    }
    setWordmark(b.wordmark ?? "");
    setBackground(b.backgroundMode ?? "cream");
    setPartnerAgreement(b.partnerAgreement ?? "");
    setSocialProofText(b.socialProofText ?? "");
    setFaqs(b.faqs ?? []);
    if (b.socialProofAvatars && b.socialProofAvatars.length > 0) {
      const hydrated = emptyAvatarSlots();
      b.socialProofAvatars.slice(0, 5).forEach((a, i) => {
        const url = a.image;
        const key = url
          ? url.split("/api/uploads/").length > 1
            ? url.split("/api/uploads/")[1]
            : url
          : null;
        hydrated[i] = {
          imageKey: key,
          imageUrl: url,
          initials: a.initials,
        };
      });
      setAvatarSlots(hydrated);
    } else {
      setAvatarSlots(emptyAvatarSlots());
    }
  }, [brandingData]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File): Promise<{ key: string; url: string }> => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error((err as { error: string }).error ?? "Upload failed");
      }
      return response.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanedAvatars = avatarSlots
        .map((s) => ({
          image: s.imageKey,
          initials: s.initials?.trim().slice(0, 2) || null,
        }))
        .filter((s) => s.image || s.initials);

      const response = await fetch(`/api/projects/${project!.id}/branding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandColor,
          headline,
          description: description || null,
          ctaText,
          fontFamily: "Inter",
          borderRadius: DEFAULTS.borderRadius,
          autoApprove,
          defaultCommissionProgramId,
          logo: logoKey,
          backgroundImage: null,
          portalName: portalName.trim() || null,
          wordmark: wordmark.trim() || null,
          backgroundMode: background,
          partnerAgreement: partnerAgreement.trim() || null,
          layout,
          showSocialProof: sections.socialProof,
          showFaq: sections.faq,
          showEarningsCalculator: sections.earningsCalculator,
          showTermsAcceptance: sections.termsAcceptance,
          socialProofText: socialProofText.trim() || null,
          socialProofAvatars: cleanedAvatars.length > 0 ? cleanedAvatars : null,
          faqs:
            faqs.filter((f) => f.q.trim() && f.a.trim()).length > 0
              ? faqs
                  .filter((f) => f.q.trim() && f.a.trim())
                  .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
              : null,
          samplePlanName: null,
          samplePlanPrice: null,
        }),
      });
      if (!response.ok) throw new Error("Failed to save branding");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding", project?.id] });
    },
  });

  const handleLogoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await uploadMutation.mutateAsync(file);
      setLogoUrl(result.url);
      setLogoKey(result.key);
    },
    [uploadMutation]
  );


  const handleAvatarUpload = useCallback(
    async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await uploadMutation.mutateAsync(file);
      setAvatarSlots((prev) => {
        const next = [...prev];
        next[idx] = {
          imageKey: result.key,
          imageUrl: result.url,
          initials: null,
        };
        return next;
      });
    },
    [uploadMutation],
  );

  function clearAvatar(idx: number) {
    setAvatarSlots((prev) => {
      const next = [...prev];
      next[idx] = { imageKey: null, imageUrl: null, initials: null };
      // Compact: shift remaining filled slots left so empties stay at the end
      const filled = next.filter((s) => s.imageUrl || s.initials);
      const empties = emptyAvatarSlots().slice(0, 5 - filled.length);
      return [...filled, ...empties];
    });
  }

  function setAvatarInitialsAt(idx: number, value: string) {
    const v = value.toUpperCase().slice(0, 2);
    if (!v) return;
    setAvatarSlots((prev) => {
      const next = [...prev];
      next[idx] = { imageKey: null, imageUrl: null, initials: v };
      return next;
    });
  }

  function handleReset() {
    setBrandColor(DEFAULTS.brandColor);
    setHeadline(DEFAULTS.headline);
    setDescription(DEFAULTS.description);
    setCtaText(DEFAULTS.ctaText);
    setBackground("cream");
    setSocialProofText("");
    setAvatarSlots(emptyAvatarSlots());
  }

  if (isLoading || !project) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      </div>
    );
  }

  const joinUrl = brandingData?.joinUrl ?? `${window.location.origin}/join/${slug}`;
  const previewUrl = joinUrl.replace(/^https?:\/\//, "");
  const selectedProgram =
    programs.find((p) => p.id === defaultCommissionProgramId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner page"
        subtitle="Customize the public join page partners use to sign up."
      />
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      {/* ─── Left: Design panel ─────────────────────────────────────────── */}
      <div className="bg-card shadow-card rounded-lg p-5 space-y-6 self-start lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <h2 className="text-card-title text-foreground">Design</h2>
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={(v) => setActiveTab(v as "general" | "content")}
          options={[
            { value: "general", label: "General" },
            { value: "content", label: "FAQ + Social Proof" },
          ]}
        />

        {activeTab === "general" && (
          <>
        {/* BRANDING */}
        <section className="space-y-3">
          <p className="text-eyebrow-muted">Branding</p>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Logo / Wordmark</p>
            <div className="flex gap-2">
              <Input
                value={wordmark}
                onChange={(e) => setWordmark(e.target.value.toUpperCase())}
                className="font-mono"
                maxLength={20}
              />
              <Button
                variant="secondary"
                size="icon"
                onClick={() => logoInputRef.current?.click()}
                aria-label="Upload logo"
              >
                <Upload className="size-4" />
              </Button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Accent Color</p>
            <div className="flex gap-1.5">
              {ACCENTS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setBrandColor(c.value)}
                  className={cn(
                    "size-8 rounded-md transition-all",
                    brandColor === c.value
                      ? "ring-2 ring-offset-2 ring-foreground ring-offset-card"
                      : "hover:scale-105"
                  )}
                  style={{ backgroundColor: c.value }}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>

        </section>

        {/* COPY */}
        <section className="space-y-3">
          <p className="text-eyebrow-muted">Copy</p>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Headline</p>
            <Textarea
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Subheadline</p>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={500}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">CTA Button</p>
            <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} maxLength={50} />
          </div>
        </section>

          </>
        )}

        {activeTab === "content" && (
          <>
        {/* SOCIAL PROOF */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-eyebrow-muted">Social proof</p>
            {!sections.socialProof && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Hidden on page
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Avatars (up to 5)</p>
            <AvatarStack
              slots={avatarSlots}
              onClearAt={clearAvatar}
              onSetInitialsAt={setAvatarInitialsAt}
              onPickImageAt={(idx) =>
                avatarInputRefs.current[idx]?.click()
              }
              registerInputRef={(idx, el) => {
                avatarInputRefs.current[idx] = el;
              }}
              onFileChange={handleAvatarUpload}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Caption</p>
            <Input
              value={socialProofText}
              onChange={(e) => setSocialProofText(e.target.value)}
              placeholder="Joined by 142 creators · $1.2M paid out"
              maxLength={200}
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-eyebrow-muted">FAQ</p>
            {!sections.faq && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Hidden on page
              </span>
            )}
          </div>
          <div className="space-y-3">
            {faqs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No FAQ items yet. Add a few common questions below — they'll
                show up under the hero.
              </p>
            )}
            {faqs.map((item, idx) => (
              <div
                key={idx}
                className="space-y-1.5 p-3 rounded-md border border-border bg-muted/20"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-eyebrow-muted">#{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFaqs((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Remove"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <Input
                  value={item.q}
                  onChange={(e) =>
                    setFaqs((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], q: e.target.value };
                      return next;
                    })
                  }
                  placeholder="Question"
                  maxLength={200}
                  className="h-8"
                />
                <Textarea
                  value={item.a}
                  onChange={(e) =>
                    setFaqs((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], a: e.target.value };
                      return next;
                    })
                  }
                  placeholder="Answer"
                  rows={2}
                  maxLength={1000}
                />
              </div>
            ))}
            {faqs.length < 8 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() =>
                  setFaqs((prev) => [...prev, { q: "", a: "" }])
                }
              >
                <Plus className="size-3.5" /> Add FAQ
              </Button>
            )}
          </div>
        </section>

        {/* PARTNER AGREEMENT */}
        <section className="space-y-3 pt-4 border-t border-border">
          <p className="text-eyebrow-muted">Partner agreement</p>
          <p className="text-xs text-muted-foreground">
            Opens when a partner clicks “Partner Agreement.” Start from a
            template and edit it, or write your own. Leave blank to use a
            standard default.
          </p>
          <div className="flex flex-wrap gap-2">
            {AGREEMENT_TEMPLATES.map((t) => (
              <Button
                key={t.label}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPartnerAgreement(t.text)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <Textarea
            value={partnerAgreement}
            onChange={(e) => setPartnerAgreement(e.target.value)}
            placeholder="Write your partner agreement, or pick a template above…"
            rows={8}
          />
        </section>

          </>
        )}

        {activeTab === "general" && (
          <>
        {/* Hidden controls retained */}
        <section className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">Auto-approve partners</span>
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          </div>

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Default commission program</p>
            {programs.length === 0 ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-dashed border-border text-sm text-muted-foreground">
                <span>No programs yet</span>
                <Link
                  to={`/app/projects/${slug}/commissions`}
                  className="text-accent hover:underline"
                >
                  Create one →
                </Link>
              </div>
            ) : (
              <Select
                value={defaultCommissionProgramId ?? "__none__"}
                onValueChange={(v) =>
                  setDefaultCommissionProgramId(v === "__none__" ? null : v)
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder="Select a program">
                    <span className="truncate block min-w-0">
                      {defaultCommissionProgramId
                        ? (programs.find(
                            (p) => p.id === defaultCommissionProgramId,
                          )?.name ?? "Select a program")
                        : "— None —"}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {programs.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      textValue={p.name}
                    >
                      <span className="flex flex-col leading-tight">
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.type === "one-time" && p.flatAmount != null
                            ? `${formatProgramAmount(p.flatAmount)} flat`
                            : `${p.rate}%`}{" "}
                          · {p.type}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Applied to new partners who sign up via this page.
            </p>
          </div>

          <Input
            value={portalName}
            onChange={(e) => setPortalName(e.target.value)}
            placeholder="Partner portal title"
            maxLength={80}
          />
        </section>
          </>
        )}

        <div className="pt-2 space-y-2">
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {saveMutation.isPending ? "Saving" : "Save changes"}
          </Button>
          {saveMutation.isSuccess && (
            <p className="text-xs text-positive">Changes saved.</p>
          )}
          {saveMutation.isError && (
            <p className="text-xs text-destructive">Failed to save.</p>
          )}
          {uploadMutation.isPending && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" /> Uploading…
            </p>
          )}
        </div>
      </div>

      {/* ─── Right: Preview ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Preview toolbar */}
        <div className="flex items-center justify-between">
          <SegmentedControl
            value={device}
            onChange={(v) => setDevice(v as DeviceMode)}
            options={[
              { value: "desktop", label: "Desktop", icon: Monitor },
              { value: "mobile", label: "Mobile", icon: Smartphone },
            ]}
            className="w-auto"
          />
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{previewUrl}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="size-1.5 rounded-full bg-positive" />
            Live preview
          </div>
        </div>

        {/* Preview frame */}
        <div className="bg-muted/40 shadow-ring rounded-lg p-4">
          <div
            className={cn(
              "mx-auto bg-background shadow-ring rounded-lg overflow-hidden transition-all duration-200",
              device === "mobile" ? "max-w-sm" : "w-full"
            )}
          >
            <PartnerJoinView
              accent={brandColor}
              data={{
                wordmark: wordmark || project.name,
                projectName: project.name,
                partnerAgreement: partnerAgreement.trim() || null,
                logo: logoUrl,
                headline,
                description,
                ctaText,
                program: selectedProgram
                  ? {
                      rate: selectedProgram.rate,
                      type: selectedProgram.type,
                      durationMonths: selectedProgram.durationMonths ?? null,
                      flatAmount: selectedProgram.flatAmount,
                      minPayout: selectedProgram.minPayout ?? null,
                      payoutCadence: selectedProgram.payoutCadence ?? null,
                    }
                  : null,
                socialProofText: socialProofText.trim() || null,
                avatars: avatarSlots.map((s) => ({
                  image: s.imageUrl,
                  initials: s.initials,
                })),
                faqs: faqs
                  .filter((f) => f.q.trim() && f.a.trim())
                  .map((f) => ({ q: f.q.trim(), a: f.a.trim() })),
              }}
              form={INERT_FORM}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Segmented Control ─────────────────────────────────────────────────────
function SegmentedControl({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ElementType }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex w-full p-1 bg-muted rounded-md gap-1",
        className
      )}
    >
      {options.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              isActive
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.icon && <o.icon className="size-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


// ─── Avatar Stack (compact inline editor) ──────────────────────────────────
function AvatarStack({
  slots,
  onClearAt,
  onSetInitialsAt,
  onPickImageAt,
  registerInputRef,
  onFileChange,
}: {
  slots: AvatarSlot[];
  onClearAt: (idx: number) => void;
  onSetInitialsAt: (idx: number, value: string) => void;
  onPickImageAt: (idx: number) => void;
  registerInputRef: (idx: number, el: HTMLInputElement | null) => void;
  onFileChange: (
    idx: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void;
}) {
  const filled = slots.filter((s) => s.imageUrl || s.initials);
  const filledCount = filled.length;
  const showAdd = filledCount < 5;
  const addIdx = filledCount; // next empty slot
  const [draftInitials, setDraftInitials] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  function commitInitials() {
    const v = draftInitials.trim().toUpperCase().slice(0, 2);
    if (!v) return;
    onSetInitialsAt(addIdx, v);
    setDraftInitials("");
    setPopoverOpen(false);
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {filled.map((slot, idx) => {
        const color = AVATAR_PALETTE[idx % AVATAR_PALETTE.length];
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onClearAt(idx)}
            title="Click to remove"
            className="size-8 rounded-full border-2 border-card flex items-center justify-center text-[11px] font-semibold text-white overflow-hidden hover:ring-2 hover:ring-destructive/40 transition"
            style={{
              backgroundColor: slot.imageUrl ? "transparent" : color,
            }}
          >
            {slot.imageUrl ? (
              <img
                src={slot.imageUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              slot.initials
            )}
          </button>
        );
      })}

      {/* Hidden file inputs for every possible slot index */}
      {Array.from({ length: 5 }).map((_, idx) => (
        <input
          key={`input-${idx}`}
          ref={(el) => registerInputRef(idx, el)}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => onFileChange(idx, e)}
        />
      ))}

      {showAdd && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add avatar"
              className="size-8 rounded-full border-2 border-dashed border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center justify-center transition"
            >
              <Plus className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-3 space-y-3">
            <div className="space-y-1.5">
              <p className="text-eyebrow-muted">Initials</p>
              <div className="flex gap-1.5">
                <Input
                  value={draftInitials}
                  onChange={(e) =>
                    setDraftInitials(e.target.value.toUpperCase().slice(0, 2))
                  }
                  placeholder="AB"
                  maxLength={2}
                  className="h-8 font-mono text-center uppercase"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitInitials();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={commitInitials}
                  disabled={!draftInitials.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setPopoverOpen(false);
                  onPickImageAt(addIdx);
                }}
              >
                <Upload className="size-3.5" />
                Upload image
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default PartnerPageDesigner;
