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
  name: z.string().max(100).optional(),
  email: z.string().email("Invalid email address").optional(),
  commissionRate: z.number().min(0.01).max(1).optional(),
  commissionProgramId: z.string().min(1).nullable().optional(),
  referralCode: z.string().min(1).max(50).optional(),
  payoutLink: z.string().trim().max(500).optional(),
});

export const PARTNER_CHANNELS = [
  "newsletter",
  "youtube",
  "paid",
  "podcast",
  "twitter",
  "agency",
  "blog",
  "community",
] as const;

export const updatePartnerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "pending", "inactive"]).optional(),
  commissionRate: z.number().min(0.01).max(1).optional(),
  commissionProgramId: z.string().min(1).nullable().optional(),
  channel: z.enum(PARTNER_CHANNELS).nullable().optional(),
  payoutLink: z.string().max(500).nullable().optional(),
  referralCode: z.string().min(1).max(50).optional(),
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

export const bulkCommissionActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "At least one commission ID is required"),
  action: z.enum(["approve", "pay", "reject"]),
  fraudFlag: z.enum([
    "self_referral",
    "bot_click",
    "revenue_cap",
    "suspicious_activity",
    "policy_violation",
  ]).optional(),
});

const payoutCadenceSchema = z.enum(["monthly_day", "monthly_ordinal", "weekly"]);

const commissionProgramBaseSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["recurring", "lifetime", "one-time"]),
  rate: z.number().min(0, "Rate must be non-negative").max(100, "Rate cannot exceed 100%"),
  durationMonths: z.number().int().min(1).max(120).nullable().optional(),
  flatAmount: z.number().min(0).max(100000).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  minPayout: z.number().min(0).max(100000).optional(),
  isDefault: z.boolean().optional(),
  payoutCadence: payoutCadenceSchema.nullable().optional(),
  payoutDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  payoutDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  payoutOrdinal: z.number().int().min(1).max(5).nullable().optional(),
});

export const createCommissionProgramSchema = commissionProgramBaseSchema
  .superRefine((data, ctx) => {
    if (data.type === "recurring" && data.durationMonths == null) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMonths"],
        message: "Recurring programs need a duration",
      });
    }
    if (data.type !== "one-time" && data.rate <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "Percentage programs need a positive rate",
      });
    }
    if (
      data.type === "one-time" &&
      (data.flatAmount == null || data.flatAmount <= 0) &&
      data.rate <= 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "One-time programs need a positive rate or flat bounty",
      });
    }
  })
  .transform((data) => ({
    ...data,
    durationMonths: data.type === "recurring" ? data.durationMonths : null,
    flatAmount:
      data.type === "one-time" && data.flatAmount != null && data.flatAmount > 0
        ? data.flatAmount
        : null,
    description: data.description ?? null,
    minPayout: data.minPayout ?? 50,
    payoutCadence: data.payoutCadence ?? null,
    payoutDayOfMonth:
      data.payoutCadence === "monthly_day" ? data.payoutDayOfMonth ?? 1 : null,
    payoutDayOfWeek:
      data.payoutCadence === "weekly" ||
      data.payoutCadence === "monthly_ordinal"
        ? data.payoutDayOfWeek ?? 0
        : null,
    payoutOrdinal:
      data.payoutCadence === "monthly_ordinal"
        ? data.payoutOrdinal ?? 1
        : null,
  }));

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
  mrr: z.number().min(0).optional(),
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
  fontFamily: z.enum([
    "Inter",
    "Plus Jakarta Sans",
    "DM Sans",
    "Poppins",
    "Nunito",
    "Raleway",
    "Lato",
    "Open Sans",
    "Montserrat",
    "Source Sans 3",
  ]).optional(),
  borderRadius: z.enum(["rectangle", "soft", "pill"]).optional(),
  autoApprove: z.boolean().optional(),
  defaultCommissionRate: z.number().min(0.01).max(1).optional(),
  defaultCommissionProgramId: z.string().min(1).nullable().optional(),
  portalName: z.string().max(80).nullable().optional(), // accepted but only persisted when portal_name column exists (run migration 0015)
  wordmark: z.string().max(20).nullable().optional(),
  backgroundMode: z.enum(["cream", "white", "dark"]).optional(),
  layout: z.enum(["split", "stacked", "cover"]).optional(),
  showSocialProof: z.boolean().optional(),
  showFaq: z.boolean().optional(),
  showEarningsCalculator: z.boolean().optional(),
  showTermsAcceptance: z.boolean().optional(),
  socialProofText: z.string().max(200).nullable().optional(),
  socialProofAvatars: z
    .array(
      z.object({
        image: z.string().nullable(),
        initials: z.string().max(2).nullable(),
      }),
    )
    .max(5)
    .nullable()
    .optional(),
  faqs: z
    .array(
      z.object({
        q: z.string().min(1).max(200),
        a: z.string().min(1).max(1000),
      }),
    )
    .max(8)
    .nullable()
    .optional(),
  samplePlanName: z.string().max(80).nullable().optional(),
  samplePlanPrice: z.number().nonnegative().max(100000).nullable().optional(),
});

// ─── Partner Self-Registration ────────────────────────────────────────────────
export const joinPartnerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
});

export const verifyPartnerOtpSchema = z.object({
  slug: z.string().min(1, "Program slug is required"),
  email: z.string().email("Invalid email address"),
  code: z.string().min(4, "Code is required").max(10, "Code is too long"),
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

// ─── Partner Self-Edit ─────────────────────────────────────────────────────────
export const updatePartnerPayoutLinkSchema = z.object({
  payoutLink: z.string().trim().max(500).nullable(),
});

// ─── Partner Magic Link Login ─────────────────────────────────────────────────
export const partnerMagicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const connectStripeSchema = z.object({
  apiKey: z.string().min(1, "Stripe API key is required").startsWith("rk_", "Use a Stripe restricted API key (starts with rk_)"),
});

export const updateMetadataMappingsSchema = z.object({
  referralCodeKeys: z.array(z.string().min(1).max(100)).min(1, "At least one metadata key is required").max(20),
  source: z.enum(["charge_metadata", "subscription_metadata", "both"]),
});

// ─── Import ───────────────────────────────────────────────────────────────────

export const csvImportPartnerSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email().optional(),
  referralCode: z.string().max(50).optional(),
  commissionRate: z.number().min(0.01).max(1).optional(),
  status: z.enum(["active", "pending", "inactive"]).optional(),
  payoutLink: z.string().max(500).optional(),
});

export const csvImportCustomerSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  partnerEmail: z.string().email(), // used to link customer to partner
  revenue: z.number().min(0).optional(),
  status: z.enum(["trialing", "paid", "cancelled", "past_due", "refunded", "cancels_on"]).optional(),
});

export const csvImportCommissionSchema = z.object({
  partnerEmail: z.string().email(),
  customerEmail: z.string().email(),
  amount: z.number().min(0),
  status: z.enum(["pending", "approved", "paid", "rejected"]).optional(),
});

export const csvImportSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  partners: z.array(csvImportPartnerSchema).default([]),
  customers: z.array(csvImportCustomerSchema).default([]),
  commissions: z.array(csvImportCommissionSchema).default([]),
  options: z.object({
    commissionMode: z.enum(["csv", "recalculate"]).default("csv"),
  }).optional(),
});

const importFiltersSchema = z.object({
  status: z.enum(["active", "canceled", "all"]).default("all"),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
});

export const stripeImportPreviewSchema = z.object({
  projectId: z.string().min(1),
  filters: importFiltersSchema.optional(),
});

export const stripeImportExecuteSchema = z.object({
  projectId: z.string().min(1),
  assignments: z.array(z.object({
    referralCode: z.string().min(1),
    partnerId: z.string().min(1),
    action: z.enum(["link", "skip"]),
  })),
  filters: importFiltersSchema.optional(),
});

// ─── Stripe Customer Browsing ──────────────────────────────────────────────────
export const stripeCustomerSearchSchema = z.object({
  query: z.string().optional(),
  filter: z.enum(["recent", "active_subscribers"]).default("recent"),
  limit: z.coerce.number().min(1).max(100).default(20),
  starting_after: z.string().optional(),
});

export const assignPartnerToCustomersSchema = z.object({
  partnerId: z.string().min(1),
  stripeCustomerIds: z.array(z.string().min(1)).min(1),
});

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const createCheckoutSessionSchema = z.object({
  plan: z.enum(["starter", "growth", "scale"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  interval: z.enum(["month", "year"]).optional(),
});

export const createPortalSessionSchema = z.object({
  returnUrl: z.string().url(),
});

export const selectSubscriptionPlanSchema = z.object({
  plan: z.enum(["starter", "growth", "scale"]),
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export const webhookEventSchema = z.enum([
  "partner.created",
  "partner.approved",
  "customer.created",
  "commission.created",
  "commission.approved",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "click.recorded",
]);

export const createWebhookEndpointSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().url().max(2048),
  events: z.array(webhookEventSchema).min(1, "At least one event is required"),
});

export const updateWebhookEndpointSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});
