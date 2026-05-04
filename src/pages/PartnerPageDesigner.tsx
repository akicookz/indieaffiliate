import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Check,
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

interface CommissionProgram {
  id: string;
  name: string;
  type: "recurring" | "lifetime" | "one-time";
  rate: number;
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

const BACKGROUNDS = [
  { value: "cream", label: "Cream", bg: "#f7f5f0", fg: "#1c1917", muted: "#78716c" },
  { value: "white", label: "White", bg: "#ffffff", fg: "#1c1917", muted: "#78716c" },
  { value: "dark", label: "Dark", bg: "#0a0a0a", fg: "#ededed", muted: "#a3a3a3" },
] as const;

type BackgroundMode = (typeof BACKGROUNDS)[number]["value"];
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

const DEFAULTS = {
  brandColor: "#c2410c",
  headline: "Earn 30% recurring on every referral",
  description:
    "Join the partner program. Get paid monthly for everyone you bring along — for the first 3 months of their subscription, no cap.",
  ctaText: "Apply to join",
  borderRadius: "soft",
  autoApprove: false,
};

const FAQ_ITEMS = [
  {
    q: "When do I get paid?",
    a: "Payouts run on the 12th of each month for the prior month.",
  },
  {
    q: "What about refunds?",
    a: "A 30-day clawback window applies to fresh referrals.",
  },
  {
    q: "Can I use paid ads?",
    a: "Branded paid ads are not allowed.",
  },
  {
    q: "Is there a minimum payout?",
    a: "Yes — $50, accumulated until met.",
  },
];

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
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [heroImageKey, setHeroImageKey] = useState<string | null>(null);
  const [wordmark, setWordmark] = useState("");
  const [background, setBackground] = useState<BackgroundMode>("cream");
  const [layout, setLayout] = useState<Layout>("split");
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [sections, setSections] = useState({
    socialProof: true,
    faq: true,
    earningsCalculator: false,
    termsAcceptance: true,
  });
  const [socialProofText, setSocialProofText] = useState("");
  const [avatarSlots, setAvatarSlots] = useState<AvatarSlot[]>(
    emptyAvatarSlots(),
  );
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [samplePlanName, setSamplePlanName] = useState("");
  const [samplePlanPrice, setSamplePlanPrice] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"general" | "content">("general");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const heroImageInputRef = useRef<HTMLInputElement>(null);
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
    setHeroImageUrl(b.backgroundImage);
    if (b.backgroundImage) {
      const parts = b.backgroundImage.split("/api/uploads/");
      setHeroImageKey(parts.length > 1 ? parts[1] : null);
    } else {
      setHeroImageKey(null);
    }
    setWordmark(b.wordmark ?? "");
    setBackground(b.backgroundMode ?? "cream");
    setLayout(b.layout ?? "split");
    setSections({
      socialProof: b.showSocialProof ?? true,
      faq: b.showFaq ?? true,
      earningsCalculator: b.showEarningsCalculator ?? false,
      termsAcceptance: b.showTermsAcceptance ?? true,
    });
    setSocialProofText(b.socialProofText ?? "");
    setFaqs(b.faqs ?? []);
    setSamplePlanName(b.samplePlanName ?? "");
    setSamplePlanPrice(
      b.samplePlanPrice != null ? String(b.samplePlanPrice) : "",
    );
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
          backgroundImage: heroImageKey,
          portalName: portalName.trim() || null,
          wordmark: wordmark.trim() || null,
          backgroundMode: background,
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
          samplePlanName: samplePlanName.trim() || null,
          samplePlanPrice: samplePlanPrice.trim()
            ? Number(samplePlanPrice)
            : null,
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

  const handleHeroImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await uploadMutation.mutateAsync(file);
      setHeroImageUrl(result.url);
      setHeroImageKey(result.key);
    },
    [uploadMutation],
  );

  function clearHeroImage() {
    setHeroImageUrl(null);
    setHeroImageKey(null);
  }

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

  function updateAvatarInitials(idx: number, value: string) {
    setAvatarSlots((prev) => {
      const next = [...prev];
      const v = value.toUpperCase().slice(0, 2);
      next[idx] = {
        ...next[idx],
        initials: v || null,
        // Setting initials clears any image
        imageKey: v ? null : next[idx].imageKey,
        imageUrl: v ? null : next[idx].imageUrl,
      };
      return next;
    });
  }

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
    setLayout("split");
    setSections({
      socialProof: true,
      faq: true,
      earningsCalculator: false,
      termsAcceptance: true,
    });
    setSocialProofText("");
    setAvatarSlots(emptyAvatarSlots());
  }

  if (isLoading || !project) {
    return (
      <div className="p-6 space-y-6">
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

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      {/* ─── Left: Design panel ─────────────────────────────────────────── */}
      <div className="bg-card border rounded-md p-5 space-y-6 self-start lg:sticky lg:top-6">
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

          <div className="space-y-1.5">
            <p className="text-eyebrow-muted">Background</p>
            <SegmentedControl
              value={background}
              onChange={(v) => setBackground(v as BackgroundMode)}
              options={BACKGROUNDS.map((b) => ({ value: b.value, label: b.label }))}
            />
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

        {/* LAYOUT */}
        <section className="space-y-3">
          <p className="text-eyebrow-muted">Layout</p>
          <SegmentedControl
            value={layout}
            onChange={(v) => setLayout(v as Layout)}
            options={[
              { value: "split", label: "Split" },
              { value: "stacked", label: "Stacked" },
              { value: "cover", label: "Cover" },
            ]}
          />

          {layout === "cover" && (
            <div className="space-y-1.5">
              <p className="text-eyebrow-muted">Hero image</p>
              <div className="flex gap-2 items-center">
                <div
                  className="size-12 rounded border border-border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0"
                  style={
                    heroImageUrl
                      ? {
                          backgroundImage: `url(${heroImageUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!heroImageUrl && (
                    <span className="text-xs text-muted-foreground">none</span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => heroImageInputRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="size-3.5" />
                  {heroImageUrl ? "Replace" : "Upload"}
                </Button>
                {heroImageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={clearHeroImage}
                    aria-label="Clear hero image"
                  >
                    <X className="size-4" />
                  </Button>
                )}
                <input
                  ref={heroImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleHeroImageUpload}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Falls back to brand color if no image is set.
              </p>
            </div>
          )}
        </section>

        {/* SECTIONS */}
        <section className="space-y-2">
          <p className="text-eyebrow-muted">Sections</p>
          <div className="space-y-3 pt-1">
            <SectionToggle
              label="Social proof"
              checked={sections.socialProof}
              onChange={(v) => setSections((s) => ({ ...s, socialProof: v }))}
            />
            <SectionToggle
              label="FAQ"
              checked={sections.faq}
              onChange={(v) => setSections((s) => ({ ...s, faq: v }))}
            />
            <SectionToggle
              label="Earnings calculator"
              checked={sections.earningsCalculator}
              onChange={(v) => setSections((s) => ({ ...s, earningsCalculator: v }))}
            />
            <SectionToggle
              label="Terms acceptance"
              checked={sections.termsAcceptance}
              onChange={(v) => setSections((s) => ({ ...s, termsAcceptance: v }))}
            />
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

          </>
        )}

        {activeTab === "general" && (
          <>
        {/* EARNINGS CALCULATOR */}
        {sections.earningsCalculator && (
          <section className="space-y-3">
            <p className="text-eyebrow-muted">Earnings calculator</p>
            <p className="text-xs text-muted-foreground">
              Visitors will see an interactive earnings preview using the
              default commission program.
            </p>
            <div className="space-y-1.5">
              <p className="text-eyebrow-muted">Sample plan name</p>
              <Input
                value={samplePlanName}
                onChange={(e) => setSamplePlanName(e.target.value)}
                placeholder="Pro plan"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-eyebrow-muted">Sample plan price ($/mo)</p>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={samplePlanPrice}
                onChange={(e) => setSamplePlanPrice(e.target.value)}
                placeholder="99"
              />
            </div>
            {!defaultCommissionProgramId && (
              <p className="text-xs text-warning">
                Pick a default commission program below for the calculator to
                work.
              </p>
            )}
          </section>
        )}

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
                          {p.rate}% · {p.type}
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
        <div className="bg-muted/40 border rounded-md p-4">
          <div
            className={cn(
              "mx-auto bg-background border rounded-md overflow-hidden transition-all duration-200",
              device === "mobile" ? "max-w-sm" : "w-full"
            )}
          >
            <PartnerPagePreview
              wordmark={wordmark || project.name.toUpperCase()}
              brandColor={brandColor}
              background={background}
              layout={layout}
              headline={headline}
              description={description}
              ctaText={ctaText}
              logoUrl={logoUrl}
              heroImageUrl={heroImageUrl}
              sections={sections}
              socialProofText={socialProofText}
              avatarSlots={avatarSlots}
              faqs={faqs}
              samplePlanName={samplePlanName}
              samplePlanPrice={
                samplePlanPrice.trim() ? Number(samplePlanPrice) : null
              }
              selectedProgram={
                programs.find((p) => p.id === defaultCommissionProgramId) ??
                null
              }
            />
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

// ─── Section Toggle Row ────────────────────────────────────────────────────
function SectionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
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

// ─── Earnings Calculator (shared by preview + live page) ──────────────────
function EarningsCalculatorPreview({
  brandColor,
  tinted,
  fg,
  muted,
  cardBg,
  borderColor,
  planName,
  planPrice,
  program,
}: {
  brandColor: string;
  tinted: string;
  fg: string;
  muted: string;
  cardBg: string;
  borderColor: string;
  planName: string;
  planPrice: number;
  program: CommissionProgram & { durationMonths?: number | null };
}) {
  const [referrals, setReferrals] = useState(10);
  const rateFrac = program.rate / 100;
  // For recurring with a duration cap, multiply by min(duration, 1) per
  // referral and keep monthly view; for lifetime, show monthly recurring;
  // for one-time, show one-time per referral.
  const isOneTime = program.type === "one-time";
  const monthlyPerReferral = planPrice * rateFrac;
  const monthlyEarnings = isOneTime ? 0 : referrals * monthlyPerReferral;
  const oneTimeEarnings = isOneTime ? referrals * monthlyPerReferral : 0;
  const annualOrTotal = (() => {
    if (isOneTime) return oneTimeEarnings;
    if (program.type === "recurring" && program.durationMonths) {
      return referrals * monthlyPerReferral * program.durationMonths;
    }
    // lifetime: show 12-month projection
    return referrals * monthlyPerReferral * 12;
  })();

  return (
    <div className="space-y-4">
      <div>
        <p
          className="text-xs font-semibold tracking-[0.12em] uppercase"
          style={{ color: muted }}
        >
          Earnings calculator
        </p>
        <h2
          className="font-heading text-2xl tracking-tight mt-1"
          style={{ color: fg }}
        >
          See what you'd earn
        </h2>
      </div>

      <div
        className="rounded-md border p-5 space-y-5"
        style={{ backgroundColor: cardBg, borderColor }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: muted }}>{planName}</span>
          <span className="font-mono" style={{ color: fg }}>
            ${planPrice}/mo
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: muted }}>Referrals you bring</span>
            <span className="font-mono" style={{ color: fg }}>
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

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div
            className="rounded-md p-3"
            style={{ backgroundColor: tinted }}
          >
            <p className="text-[10px] font-semibold tracking-[0.1em] uppercase" style={{ color: brandColor }}>
              {isOneTime ? "One-time" : "Per month"}
            </p>
            <p
              className="font-heading text-2xl mt-0.5"
              style={{ color: fg }}
            >
              ${(isOneTime ? oneTimeEarnings : monthlyEarnings).toFixed(0)}
            </p>
          </div>
          <div
            className="rounded-md p-3 border"
            style={{ borderColor }}
          >
            <p className="text-[10px] font-semibold tracking-[0.1em] uppercase" style={{ color: muted }}>
              {program.type === "recurring" && program.durationMonths
                ? `Over ${program.durationMonths} months`
                : isOneTime
                  ? "Total"
                  : "Annual projection"}
            </p>
            <p
              className="font-heading text-2xl mt-0.5"
              style={{ color: fg }}
            >
              ${annualOrTotal.toFixed(0)}
            </p>
          </div>
        </div>

        <p className="text-xs" style={{ color: muted }}>
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

// ─── Live Preview ──────────────────────────────────────────────────────────
function PartnerPagePreview({
  wordmark,
  brandColor,
  background,
  layout,
  headline,
  description,
  ctaText,
  logoUrl,
  heroImageUrl,
  sections,
  socialProofText,
  avatarSlots,
  faqs,
  samplePlanName,
  samplePlanPrice,
  selectedProgram,
}: {
  wordmark: string;
  brandColor: string;
  background: BackgroundMode;
  layout: Layout;
  headline: string;
  description: string;
  ctaText: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  sections: {
    socialProof: boolean;
    faq: boolean;
    earningsCalculator: boolean;
    termsAcceptance: boolean;
  };
  socialProofText: string;
  avatarSlots: AvatarSlot[];
  faqs: FaqItem[];
  samplePlanName: string;
  samplePlanPrice: number | null;
  selectedProgram: CommissionProgram | null;
}) {
  const visibleAvatars = avatarSlots.filter(
    (s) => s.imageUrl || s.initials,
  );
  const hasSocialProof =
    sections.socialProof &&
    (visibleAvatars.length > 0 || socialProofText.trim().length > 0);
  const bg = BACKGROUNDS.find((b) => b.value === background) ?? BACKGROUNDS[0];
  const tinted = background === "dark"
    ? `${brandColor}33`
    : `${brandColor}22`;
  const isCover = layout === "cover";
  const headerFg = isCover ? "#ffffff" : bg.fg;
  const headerMuted = isCover ? "rgba(255,255,255,0.7)" : bg.muted;

  return (
    <div
      style={{
        backgroundColor: bg.bg,
        color: bg.fg,
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
      className="min-h-[600px] flex flex-col relative"
    >
      {/* Header (overlay style in cover) */}
      <header
        className={cn(
          "flex items-center justify-between px-8 py-5",
          isCover && "absolute top-0 left-0 right-0 z-10",
        )}
      >
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-7 object-contain" />
          ) : (
            <div
              className="size-7 rounded-md flex items-center justify-center font-heading text-sm text-white"
              style={{ backgroundColor: brandColor }}
            >
              {wordmark.charAt(0).toLowerCase() || "t"}
            </div>
          )}
          <span
            className="font-heading text-base tracking-wide"
            style={{ color: headerFg }}
          >
            {wordmark}
          </span>
        </div>
        <nav
          className="flex items-center gap-6 text-sm"
          style={{ color: headerMuted }}
        >
          <a href="#how">How it works</a>
          <a href="#terms">Terms</a>
          <a href="#signin" style={{ color: headerFg }}>
            Sign in
          </a>
        </nav>
      </header>

      {/* Hero */}
      {isCover ? (
        <section
          className="relative min-h-[500px] flex items-center justify-center px-8 py-24 text-center overflow-hidden"
          style={{
            backgroundColor: brandColor,
            backgroundImage: heroImageUrl ? `url(${heroImageUrl})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {heroImageUrl && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            />
          )}
          <div className="relative z-[1] max-w-3xl space-y-6">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#ffffff",
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: "#ffffff" }}
              />
              NOW ACCEPTING
            </span>

            <h1
              className="font-heading text-5xl md:text-6xl leading-[1.05] tracking-tight"
              style={{ color: "#ffffff" }}
            >
              {headline}
            </h1>

            <p
              className="text-base md:text-lg leading-relaxed mx-auto max-w-xl"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              {description}
            </p>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                className="px-5 py-2.5 rounded-md text-sm font-medium inline-flex items-center gap-2"
                style={{ backgroundColor: "#ffffff", color: brandColor }}
              >
                {ctaText} <span aria-hidden>→</span>
              </button>
              <button
                className="px-5 py-2.5 rounded-md text-sm font-medium border"
                style={{
                  borderColor: "rgba(255,255,255,0.4)",
                  color: "#ffffff",
                }}
              >
                How it works
              </button>
            </div>

            {hasSocialProof && (
              <div className="flex items-center justify-center gap-3 pt-3">
                {visibleAvatars.length > 0 && (
                  <div className="flex -space-x-1.5">
                    {visibleAvatars.map((slot, idx) => (
                      <div
                        key={idx}
                        className="size-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-white overflow-hidden"
                        style={{
                          backgroundColor: slot.imageUrl
                            ? "transparent"
                            : AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                          borderColor: "#ffffff",
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
                      </div>
                    ))}
                  </div>
                )}
                {socialProofText.trim() && (
                  <span
                    className="text-sm"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                  >
                    {socialProofText}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section
          className={cn(
            "px-8 py-10 grid gap-10",
            layout === "split"
              ? "grid-cols-1 lg:grid-cols-[1fr_320px] items-start"
              : "grid-cols-1",
          )}
        >
          <div className={cn("space-y-5", layout === "stacked" && "max-w-3xl")}>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: tinted, color: brandColor }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: brandColor }}
              />
              NOW ACCEPTING
            </span>

            <h1
              className="font-heading leading-[1.05] tracking-tight text-4xl md:text-5xl"
              style={{ color: bg.fg }}
            >
              {headline}
            </h1>

            <p
              className="text-base max-w-xl leading-relaxed"
              style={{ color: bg.muted }}
            >
              {description}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                className="px-5 py-2.5 rounded-md text-sm font-medium text-white inline-flex items-center gap-2"
                style={{ backgroundColor: brandColor }}
              >
                {ctaText} <span aria-hidden>→</span>
              </button>
              <button
                className="px-5 py-2.5 rounded-md text-sm font-medium border"
                style={{ borderColor: bg.muted + "55", color: bg.fg }}
              >
                How it works
              </button>
            </div>

            {hasSocialProof && (
              <div className="flex items-center gap-3 pt-3">
                {visibleAvatars.length > 0 && (
                  <div className="flex -space-x-1.5">
                    {visibleAvatars.map((slot, idx) => (
                      <div
                        key={idx}
                        className="size-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-white overflow-hidden"
                        style={{
                          backgroundColor: slot.imageUrl
                            ? "transparent"
                            : AVATAR_PALETTE[idx % AVATAR_PALETTE.length],
                          borderColor: bg.bg,
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
                      </div>
                    ))}
                  </div>
                )}
                {socialProofText.trim() && (
                  <span className="text-sm" style={{ color: bg.muted }}>
                    {socialProofText}
                  </span>
                )}
              </div>
            )}
          </div>

          {layout === "split" && (
            <aside
              className="rounded-md border p-6 space-y-4"
              style={{
                backgroundColor: background === "dark" ? "#171717" : "#ffffff",
                borderColor: bg.muted + "33",
              }}
            >
              <p className="text-eyebrow-muted">Earn alongside</p>
              <ul className="space-y-3">
                {[
                  { t: "Recurring 30%", d: "For the first 3 months" },
                  { t: "Net-15 payouts", d: "Wise, PayPal, or ACH" },
                  { t: "Live attribution", d: "See clicks & conversions live" },
                  { t: "Fair fraud rules", d: "No surprises, no clawbacks" },
                ].map((item) => (
                  <li key={item.t} className="flex items-start gap-2.5">
                    <span
                      className="size-5 rounded flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: tinted }}
                    >
                      <Check className="size-3" style={{ color: brandColor }} />
                    </span>
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: bg.fg }}
                      >
                        {item.t}
                      </p>
                      <p className="text-xs" style={{ color: bg.muted }}>
                        {item.d}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </section>
      )}

      {/* Earnings Calculator */}
      {sections.earningsCalculator &&
        selectedProgram &&
        samplePlanPrice != null &&
        samplePlanPrice > 0 && (
          <section
            className="px-8 py-10 border-t"
            style={{ borderColor: bg.muted + "33" }}
          >
            <EarningsCalculatorPreview
              brandColor={brandColor}
              tinted={tinted}
              fg={bg.fg}
              muted={bg.muted}
              cardBg={background === "dark" ? "#171717" : "#ffffff"}
              borderColor={bg.muted + "33"}
              planName={samplePlanName || "Pro plan"}
              planPrice={samplePlanPrice}
              program={selectedProgram}
            />
          </section>
        )}

      {/* FAQ */}
      {sections.faq && (
        <section className="px-8 py-10">
          <h2
            className="font-heading text-3xl tracking-tight mb-6"
            style={{ color: bg.fg }}
          >
            Frequently asked
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            {(faqs.length > 0 ? faqs : FAQ_ITEMS).map((item, idx) => (
              <div key={`${item.q}-${idx}`} className="space-y-1.5">
                <p className="text-sm font-semibold" style={{ color: bg.fg }}>
                  {item.q}
                </p>
                <p className="text-sm" style={{ color: bg.muted }}>
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default PartnerPageDesigner;
