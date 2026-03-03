import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Copy,
  Check,
  ExternalLink,
  ImageIcon,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
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
  portalName: string | null;
}

const FONT_OPTIONS = [
  { value: "Inter", label: "Inter" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans" },
  { value: "DM Sans", label: "DM Sans" },
  { value: "Poppins", label: "Poppins" },
  { value: "Nunito", label: "Nunito" },
  { value: "Raleway", label: "Raleway" },
  { value: "Lato", label: "Lato" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Source Sans 3", label: "Source Sans 3" },
] as const;

const BORDER_RADIUS_OPTIONS = [
  { value: "rectangle", label: "Rectangle", px: "0px" },
  { value: "soft", label: "Soft", px: "8px" },
  { value: "pill", label: "Pill", px: "9999px" },
] as const;

function getBorderRadiusPx(value: string): string {
  return BORDER_RADIUS_OPTIONS.find((o) => o.value === value)?.px ?? "8px";
}

function getGoogleFontUrl(font: string): string {
  const family = font.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

interface BrandingResponse {
  branding: BrandingData | null;
  joinUrl: string;
}

// ─── Defaults used when no branding exists yet ────────────────────────────────
const DEFAULTS = {
  brandColor: "#7c3aed",
  headline: "Join our affiliate program",
  description:
    "Earn commissions by referring customers. Share your unique link and get paid for every conversion.",
  ctaText: "Become a Partner",
  fontFamily: "Inter",
  borderRadius: "soft",
  autoApprove: false,
  defaultCommissionRate: 0.2,
};

function PartnerPageDesigner() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  // ─── Form state ───────────────────────────────────────────────────────────
  const [brandColor, setBrandColor] = useState(DEFAULTS.brandColor);
  const [headline, setHeadline] = useState(DEFAULTS.headline);
  const [description, setDescription] = useState(DEFAULTS.description);
  const [ctaText, setCtaText] = useState(DEFAULTS.ctaText);
  const [fontFamily, setFontFamily] = useState(DEFAULTS.fontFamily);
  const [borderRadius, setBorderRadius] = useState(DEFAULTS.borderRadius);
  const [autoApprove, setAutoApprove] = useState(DEFAULTS.autoApprove);
  const [commissionRate, setCommissionRate] = useState(
    DEFAULTS.defaultCommissionRate * 100,
  );
  const [portalName, setPortalName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgKey, setBgKey] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // ─── Load Google Font dynamically ────────────────────────────────────────
  useEffect(() => {
    const linkId = "branding-google-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = getGoogleFontUrl(fontFamily);
  }, [fontFamily]);

  // ─── Fetch project ────────────────────────────────────────────────────────
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<{ projects: Project[] }> => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const project = projectsData?.projects.find((p) => p.slug === slug);

  // ─── Fetch branding ──────────────────────────────────────────────────────
  const { data: brandingData, isLoading } = useQuery({
    queryKey: ["branding", project?.id],
    queryFn: async (): Promise<BrandingResponse> => {
      const response = await fetch(`/api/projects/${project!.id}/branding`);
      if (!response.ok) throw new Error("Failed to fetch branding");
      return response.json();
    },
    enabled: !!project?.id,
  });

  // Populate form from fetched data
  useEffect(() => {
    if (!brandingData?.branding) return;
    const b = brandingData.branding;
    setBrandColor(b.brandColor);
    setHeadline(b.headline);
    setDescription(b.description ?? "");
    setCtaText(b.ctaText);
    setFontFamily(b.fontFamily ?? DEFAULTS.fontFamily);
    setBorderRadius(b.borderRadius ?? DEFAULTS.borderRadius);
    setAutoApprove(b.autoApprove);
    setCommissionRate(b.defaultCommissionRate * 100);
    setPortalName(b.portalName ?? "");
    setLogoUrl(b.logo);
    setBgUrl(b.backgroundImage);
    // Extract keys from URLs if they exist
    if (b.logo) {
      const parts = b.logo.split("/api/uploads/");
      setLogoKey(parts.length > 1 ? parts[1] : null);
    }
    if (b.backgroundImage) {
      const parts = b.backgroundImage.split("/api/uploads/");
      setBgKey(parts.length > 1 ? parts[1] : null);
    }
  }, [brandingData]);

  // ─── Upload mutation ──────────────────────────────────────────────────────
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

  // ─── Save branding mutation ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${project!.id}/branding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandColor,
          headline,
          description: description || null,
          ctaText,
          fontFamily,
          borderRadius,
          autoApprove,
          defaultCommissionRate: commissionRate / 100,
          logo: logoKey,
          backgroundImage: bgKey,
          portalName: portalName.trim() || null,
        }),
      });
      if (!response.ok) throw new Error("Failed to save branding");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding", project?.id] });
    },
  });

  // ─── File upload handlers ─────────────────────────────────────────────────
  const handleLogoUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await uploadMutation.mutateAsync(file);
      setLogoUrl(result.url);
      setLogoKey(result.key);
    },
    [uploadMutation],
  );

  const handleBgUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await uploadMutation.mutateAsync(file);
      setBgUrl(result.url);
      setBgKey(result.key);
    },
    [uploadMutation],
  );

  function handleCopyUrl() {
    if (!brandingData?.joinUrl) return;
    navigator.clipboard.writeText(brandingData.joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading || !project) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      </div>
    );
  }

  const joinUrl = brandingData?.joinUrl ?? `${window.location.origin}/join/${slug}`;
  const projectName = project.name;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Partner Page
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customize the sign-up page where partners can apply to your affiliate
            program.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Preview
            </a>
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : null}
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Join URL bar */}
      <div className="flex items-center gap-2 rounded-xl bg-card/50 border border-border px-4 py-3">
        <span className="text-sm text-muted-foreground shrink-0">
          Partner sign-up URL:
        </span>
        <code className="text-sm font-mono truncate flex-1">{joinUrl}</code>
        <Button variant="ghost" size="icon" onClick={handleCopyUrl}>
          {copied ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Two-column: Editor + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Left: Form controls ─────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Logo */}
          <div className="space-y-2">
            <Label>Logo</Label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => logoInputRef.current?.click()}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="h-16 object-contain"
                />
              ) : (
                <>
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Click to upload logo
                  </span>
                </>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
            {logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  setLogoUrl(null);
                  setLogoKey(null);
                }}
              >
                Remove logo
              </Button>
            )}
          </div>

          {/* Brand Color */}
          <div className="space-y-2">
            <Label htmlFor="brandColor">Brand Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                id="brandColor"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#7c3aed"
                className="font-mono w-32"
              />
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-2">
            <Label>Font Family</Label>
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger>
                <SelectValue placeholder="Select a font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: `"${font.value}", sans-serif` }}>
                      {font.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Border Radius */}
          <div className="space-y-2">
            <Label>Border Radius</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {BORDER_RADIUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBorderRadius(option.value)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
                    borderRadius === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div
                    className={`w-5 h-4 border-2 shrink-0 ${
                      borderRadius === option.value
                        ? "border-primary"
                        : "border-muted-foreground/40"
                    }`}
                    style={{ borderRadius: option.px }}
                  />
                  <span className={`text-xs ${
                    borderRadius === option.value
                      ? "text-primary font-medium"
                      : "text-muted-foreground"
                  }`}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-2">
            <Label htmlFor="headline">Headline</Label>
            <Input
              id="headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Join our affiliate program"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell potential partners why they should join..."
              rows={3}
              maxLength={1000}
            />
          </div>

          {/* Background Image */}
          <div className="space-y-2">
            <Label>Background Image</Label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/40 transition-colors relative overflow-hidden"
              onClick={() => bgInputRef.current?.click()}
            >
              {bgUrl ? (
                <img
                  src={bgUrl}
                  alt="Background preview"
                  className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
              ) : null}
              <div className="relative z-10 flex flex-col items-center gap-2">
                <ImageIcon className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {bgUrl ? "Click to change" : "Click to upload background"}
                </span>
              </div>
              <input
                ref={bgInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleBgUpload}
              />
            </div>
            {bgUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  setBgUrl(null);
                  setBgKey(null);
                }}
              >
                Remove background
              </Button>
            )}
          </div>

          {/* CTA Text */}
          <div className="space-y-2">
            <Label htmlFor="ctaText">Button Text</Label>
            <Input
              id="ctaText"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="Become a Partner"
              maxLength={50}
            />
          </div>

          {/* Commission Rate */}
          <div className="space-y-2">
            <Label htmlFor="commissionRate">Default Commission Rate</Label>
            <div className="flex items-center gap-2">
              <Input
                id="commissionRate"
                type="number"
                min={1}
                max={100}
                value={commissionRate}
                onChange={(e) => setCommissionRate(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          {/* Partner portal customization */}
          <div className="space-y-2 rounded-xl bg-muted/30 border border-border px-4 py-3">
            <Label htmlFor="portalName">Partner portal title</Label>
            <p className="text-sm text-muted-foreground">
              Custom name shown in the header when partners log in (e.g. &quot;Acme Partner Hub&quot;). Leave blank for &quot;Partner Portal&quot;.
            </p>
            <Input
              id="portalName"
              value={portalName}
              onChange={(e) => setPortalName(e.target.value)}
              placeholder="Partner Portal"
              maxLength={80}
              className="max-w-xs"
            />
          </div>

          {/* Auto-approve */}
          <div className="flex items-center justify-between rounded-xl bg-card/50 border border-border px-4 py-3">
            <div>
              <Label htmlFor="autoApprove" className="cursor-pointer">
                Auto-approve partners
              </Label>
              <p className="text-sm text-muted-foreground mt-0.5">
                Automatically activate new partners without manual review.
              </p>
            </div>
            <Switch
              id="autoApprove"
              checked={autoApprove}
              onCheckedChange={setAutoApprove}
            />
          </div>

          {uploadMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading image...
            </div>
          )}

          {saveMutation.isSuccess && (
            <p className="text-sm text-green-600">Changes saved.</p>
          )}
          {saveMutation.isError && (
            <p className="text-sm text-destructive">
              Failed to save. Please try again.
            </p>
          )}
        </div>

        {/* ── Right: Live Preview ─────────────────────────────────────────── */}
        <div className="sticky top-6">
          <Label className="mb-3 block">Preview</Label>
          <div
            className="rounded-2xl border border-border overflow-hidden shadow-xs bg-white h-[600px]"
            style={{
              fontFamily: `"${fontFamily}", sans-serif`,
            }}
          >
            <div className="grid grid-cols-2 h-full">
              {/* Preview Left Side */}
              <div
                className="relative flex flex-col justify-end p-6"
                style={{
                  backgroundColor: bgUrl ? undefined : brandColor,
                }}
              >
                {bgUrl && (
                  <img
                    src={bgUrl}
                    alt="Background"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(to top, ${brandColor}ee, ${brandColor}44)`,
                  }}
                />
                <div className="relative z-10 space-y-3">
                  {logoUrl && (
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="h-8 object-contain"
                    />
                  )}
                  <h2 className="text-lg font-semibold text-white leading-tight">
                    {headline || "Join our affiliate program"}
                  </h2>
                  {description && (
                    <p className="text-xs text-white/80 leading-relaxed line-clamp-3">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              {/* Preview Right Side */}
              <div className="flex flex-col justify-center px-6 bg-gray-50">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {projectName}
                    </p>
                    <h3 className="text-base font-semibold text-gray-900 mt-1">
                      Partner Application
                    </h3>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500">Name</div>
                      <div
                        className="h-8 border border-gray-200 bg-white"
                        style={{ borderRadius: getBorderRadiusPx(borderRadius) }}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500">Email</div>
                      <div
                        className="h-8 border border-gray-200 bg-white"
                        style={{ borderRadius: getBorderRadiusPx(borderRadius) }}
                      />
                    </div>
                  </div>
                  <div
                    className="h-9 flex items-center justify-center text-white text-sm font-medium"
                    style={{
                      backgroundColor: brandColor,
                      borderRadius: getBorderRadiusPx(borderRadius),
                    }}
                  >
                    {ctaText || "Become a Partner"}
                  </div>
                  <p className="text-[10px] text-gray-400 text-center">
                    {commissionRate}% commission per referral
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PartnerPageDesigner;
