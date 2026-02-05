import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";

interface JoinPageData {
  projectName: string;
  brandColor: string;
  headline: string;
  description: string | null;
  ctaText: string;
  logo: string | null;
  backgroundImage: string | null;
}

function JoinPartnerProgram() {
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

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
        const err = await response.json();
        throw new Error(
          (err as { error: string }).error ?? "Something went wrong",
        );
      }
      return response.json();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    joinMutation.mutate();
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

  const brandColor = pageData.brandColor || "#7c3aed";

  // ─── Success state ────────────────────────────────────────────────────────
  if (joinMutation.isSuccess) {
    return (
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
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
            <h1 className="text-3xl font-bold text-white leading-tight font-heading">
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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
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
          <h1 className="text-3xl font-bold text-white leading-tight font-heading">
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
              className="text-2xl font-bold leading-tight font-heading"
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
                className="w-full h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                style={
                  { "--tw-ring-color": brandColor } as React.CSSProperties
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
                className="w-full h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                style={
                  { "--tw-ring-color": brandColor } as React.CSSProperties
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
              className="w-full h-11 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: brandColor }}
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
