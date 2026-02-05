import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import {
  withCloudflare,
  type CloudflareGeolocation,
} from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "./db";
import { type AppEnv } from "./types";

const ENABLE_DEBUG_LOGS = true;

function createAuth(env?: AppEnv, cf?: IncomingRequestCfProperties) {
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
            db: db as any,
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
            sendMagicLink: async ({ email, url }) => {
              // Send magic link email via Resend
              if (!env?.RESEND_API_KEY) {
                console.warn("RESEND_API_KEY not set, magic link URL:", url);
                return;
              }
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${env.RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                  from: "UnlockAffiliate <noreply@unlockaffiliate.com>",
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
                        <a href="${url}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
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
                }),
              });
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
        baseURL: env?.BETTER_AUTH_URL,
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
