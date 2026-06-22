import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import {
  withCloudflare,
  type CloudflareGeolocation,
  type WithCloudflareOptions,
} from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { Resend } from "resend";
import { schema } from "./db";
import { type AppEnv } from "./types";

const ENABLE_DEBUG_LOGS = false;
type CloudflareD1Database = NonNullable<WithCloudflareOptions["d1"]>["db"];

/** Trusted origins from BETTER_AUTH_URL (and optional TRUSTED_ORIGINS). Exported for CORS. */
export function getTrustedOrigins(env?: AppEnv): string[] {
  const origins: string[] = [];
  const base = env?.BETTER_AUTH_URL;
  if (base) {
    try {
      const url = new URL(base);
      const host = url.hostname.toLowerCase();
      const port = url.port ? `:${url.port}` : "";
      origins.push(url.origin);
      const otherProtocol = url.protocol === "https:" ? "http:" : "https:";
      origins.push(`${otherProtocol}//${host}${port}`);
      if (!host.startsWith("www.")) {
        origins.push(`${url.protocol}//www.${host}${port}`);
        origins.push(`${otherProtocol}//www.${host}${port}`);
      } else {
        const bare = host.replace(/^www\./, "");
        origins.push(`${url.protocol}//${bare}${port}`);
        origins.push(`${otherProtocol}//${bare}${port}`);
      }
    } catch {
      /* ignore */
    }
  }
  if (env?.TRUSTED_ORIGINS) {
    origins.push(
      ...env.TRUSTED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    );
  }
  return [...new Set(origins)];
}

/** Normalize base URL (no trailing slash) so magic link URLs are built correctly. */
function normalizeBaseURL(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

/** Build absolute verify-login URL for magic link email. Requires a valid origin; uses https in production. */
function buildVerifyLoginUrl(base: string | undefined, token: string): string {
  const normalized = normalizeBaseURL(base);
  if (!normalized || (!normalized.startsWith("http://") && !normalized.startsWith("https://"))) {
    throw new Error(
      "BETTER_AUTH_URL must be set to a full app URL (e.g. https://yourdomain.com) for magic links to work.",
    );
  }
  let origin = normalized;
  const isLocalhost =
    normalized.includes("localhost") || normalized.startsWith("http://127.0.0.1");
  if (!isLocalhost && normalized.startsWith("http://")) {
    origin = normalized.replace(/^http:\/\//, "https://");
  }
  return `${origin}/verify-login?token=${encodeURIComponent(token)}`;
}

function createAuth(
  env?: AppEnv,
  cf?: IncomingRequestCfProperties,
  /** Fallback when BETTER_AUTH_URL is not set (e.g. derive from request origin). */
  requestOrigin?: string,
) {
  const db = env
    ? drizzle(env.DB, { schema, logger: ENABLE_DEBUG_LOGS })
    : ({} as DrizzleD1Database<Record<string, unknown>> & {
        $client: D1Database;
      });

  return betterAuth({
    ...withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        // Local dev (Miniflare/Vite) may not provide `request.cf`.
        // better-auth-cloudflare requires a truthy `cf` when geolocation or IP detection is enabled.
        cf: (cf as CloudflareGeolocation) || ({} as CloudflareGeolocation),
        d1: env
          ? {
              // better-auth-cloudflare bundles its own drizzle-orm dependency; type-only mismatch can occur.
              db: db as unknown as CloudflareD1Database,
              options: {
                usePlural: true,
                debugLogs: ENABLE_DEBUG_LOGS,
              },
            }
          : undefined,
      },
      {
        socialProviders: {
          google: {
            clientId: env?.GOOGLE_CLIENT_ID ?? "",
            clientSecret: env?.GOOGLE_CLIENT_SECRET ?? "",
          },
          github: {
            clientId: env?.GITHUB_CLIENT_ID ?? "",
            clientSecret: env?.GITHUB_CLIENT_SECRET ?? "",
          },
        },
        plugins: [
          magicLink({
            sendMagicLink: async ({ email, token }) => {
              try {
                if (!env?.RESEND_API_KEY) {
                  console.error("RESEND_API_KEY not set; cannot send magic link");
                  throw new Error("Email is not configured. Please try again later.");
                }
                const base = normalizeBaseURL(env.BETTER_AUTH_URL);
                if (!base || (!base.startsWith("http://") && !base.startsWith("https://"))) {
                  console.error("BETTER_AUTH_URL missing or invalid; set it in Worker env to your app URL (e.g. https://yoursite.com)");
                  throw new Error(
                    "BETTER_AUTH_URL is not set. Set it in Cloudflare Worker env to your app URL (e.g. https://yoursite.com) for magic links to work.",
                  );
                }
                const verifyLoginUrl = buildVerifyLoginUrl(env.BETTER_AUTH_URL, token);
                const resend = new Resend(env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                  from: "UnlockAffiliate <hello@updates.unlockaffiliate.com>",
                  to: [email],
                  subject: "Your partner dashboard login link",
                  html: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
                    <h2 style="color: #1a1a1a;">Sign in to your partner dashboard</h2>
                    <p style="color: #555; line-height: 1.6;">
                      Click the button below to securely sign in to your affiliate partner dashboard.
                      This link expires in 5 minutes.
                    </p>
                    <div style="margin: 24px 0;">
                      <a href="${verifyLoginUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                        Sign in to Dashboard
                      </a>
                    </div>
                    <p style="color: #888; font-size: 13px;">
                      If you didn't request this link, you can safely ignore this email.
                    </p>
                    <p style="color: #888; font-size: 13px; margin-top: 32px;">
                      — UnlockAffiliate
                    </p>
                  </div>
                `,
                });
                if (error) {
                  console.error("[magic-link] Resend error:", error.message);
                  throw new Error(
                    error.message ?? "Failed to send login email. Please try again.",
                  );
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : "";
                const known =
                  message.includes("BETTER_AUTH_URL") ||
                  message.includes("Email is not configured") ||
                  message.includes("send login email");
                if (!known) {
                  console.error("[magic-link] sendMagicLink failed:", message, err instanceof Error ? err.stack : "");
                }
                if (err instanceof Error && known) throw err;
                throw new Error("Failed to send login link. Please try again later.");
              }
            },
            expiresIn: 300, // 5 minutes
          }),
        ],
        rateLimit: {
          enabled: true,
          window: 60,
          max: 200,
        },
        secret: env?.BETTER_AUTH_SECRET,
        basePath: "/api/auth",
        baseURL:
          normalizeBaseURL(env?.BETTER_AUTH_URL) ??
          (requestOrigin ? normalizeBaseURL(requestOrigin) : undefined),
        trustedOrigins: getTrustedOrigins(env),
        advanced: {
          trustedProxyHeaders: true,
        },
      },
    ),
    // Fallback database adapter for CLI schema generation
    ...(env
      ? {}
      : {
          database: drizzleAdapter({} as D1Database, {
            provider: "sqlite",
            usePlural: true,
          }),
        }),
  });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };
