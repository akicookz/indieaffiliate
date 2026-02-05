import { betterAuth } from "better-auth";
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
