import { type User, type Session } from "better-auth";
import { type DrizzleD1Database } from "drizzle-orm/d1";

// Extend Env with secrets not in generated wrangler types.
// BETTER_AUTH_URL: set in .dev.vars (local) and Cloudflare Dashboard (production).
export interface AppEnv extends Omit<Env, "BETTER_AUTH_URL"> {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ENCRYPTION_KEY?: string;
  /** Comma-separated extra origins for auth (e.g. https://www.unlockaffiliate.com). Optional. */
  TRUSTED_ORIGINS?: string;
  /** Public app base URL used for join links, e.g. https://app.example.com */
  APP_BASE_URL?: string;
  UPLOADS: R2Bucket;
  /** Optional: per-plan price IDs */
  STRIPE_PRICE_GROWTH_MONTHLY?: string;
  STRIPE_PRICE_GROWTH_ANNUAL?: string;
  STRIPE_PRICE_SCALE_MONTHLY?: string;
  STRIPE_PRICE_SCALE_ANNUAL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export interface HonoAppContext {
  Bindings: AppEnv;
  Variables: {
    user: User | null;
    session: Session | null;
    db: DrizzleD1Database<Record<string, unknown>>;
  };
}
