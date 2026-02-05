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
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const createApiKeySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  name: z.string().min(1, "Name is required").max(100),
});

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const connectStripeSchema = z.object({
  apiKey: z.string().min(1, "Stripe API key is required").startsWith("rk_", "Use a Stripe restricted API key (starts with rk_)"),
});
