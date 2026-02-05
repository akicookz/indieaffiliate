import { z } from "zod";

// ─── Projects ─────────────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  domain: z.string().max(255).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100).optional(),
  domain: z.string().max(255).nullable().optional(),
});

// ─── Partners ─────────────────────────────────────────────────────────────────
export const createPartnerSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  commissionRate: z.number().min(0.01).max(1).optional(),
});

export const updatePartnerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "pending", "inactive"]).optional(),
  commissionRate: z.number().min(0.01).max(1).optional(),
});

// ─── Commissions ──────────────────────────────────────────────────────────────
export const updateCommissionSchema = z.object({
  status: z.enum(["pending", "approved", "paid", "rejected"]),
  fraudFlag: z.enum([
    "self_referral",
    "bot_click",
    "revenue_cap",
    "suspicious_activity",
    "policy_violation",
  ]).optional(),
});

// ─── Tracking ─────────────────────────────────────────────────────────────────
export const trackClickSchema = z.object({
  referralCode: z.string().min(1, "referralCode is required"),
  landingPage: z.string().max(2048).optional(),
});

export const trackConversionSchema = z.object({
  referralCode: z.string().min(1, "referralCode is required"),
  customerEmail: z.string().email("Invalid customer email"),
  revenue: z.number().min(0, "Revenue must be non-negative"),
  customerStatus: z.enum(["trialing", "paid", "cancelled"]).optional(),
  eventId: z.string().max(255).optional(),
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const createApiKeySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  name: z.string().min(1, "Name is required").max(100),
});

// ─── Branding ─────────────────────────────────────────────────────────────────
export const updateBrandingSchema = z.object({
  logo: z.string().nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color").optional(),
  headline: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  backgroundImage: z.string().nullable().optional(),
  ctaText: z.string().min(1).max(50).optional(),
  autoApprove: z.boolean().optional(),
  defaultCommissionRate: z.number().min(0.01).max(1).optional(),
});

// ─── Partner Self-Registration ────────────────────────────────────────────────
export const joinPartnerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
});

// ─── Fraud Flags ──────────────────────────────────────────────────────────────
export const updateFraudFlagSchema = z.object({
  status: z.enum(["dismissed", "confirmed"]),
});

// ─── Payouts ──────────────────────────────────────────────────────────────────
export const createPayoutSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  partnerId: z.string().min(1, "partnerId is required"),
  amount: z.number().min(0.01, "Amount must be positive"),
  currency: z.string().length(3).default("USD").optional(),
  note: z.string().max(500).nullable().optional(),
  periodStart: z.string().optional(), // ISO date string
  periodEnd: z.string().optional(),
});

export const updatePayoutSchema = z.object({
  status: z.enum(["scheduled", "paid", "failed"]),
});

// ─── Partner Magic Link Login ─────────────────────────────────────────────────
export const partnerMagicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const connectStripeSchema = z.object({
  apiKey: z.string().min(1, "Stripe API key is required").startsWith("rk_", "Use a Stripe restricted API key (starts with rk_)"),
});
