import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import * as authSchema from "./auth.schema";

// Projects - each user can have multiple projects (SaaS products)
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    domain: text("domain"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_projects_slug").on(table.userId, table.slug),
    index("idx_projects_user").on(table.userId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

// Partners (affiliates) - people who promote your products
export const partners = sqliteTable(
  "partners",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authSchema.users.id, {
      onDelete: "set null",
    }), // linked when partner logs in via magic link
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status", { enum: ["active", "pending", "inactive"] })
      .notNull()
      .default("pending"),
    commissionRate: real("commission_rate").notNull().default(0.2),
    commissionProgramId: text("commission_program_id"),
    channel: text("channel"),
    referralCode: text("referral_code").notNull().unique(),
    payoutLink: text("payout_link"), // e.g. PayPal.me, Wise, or Venmo link
    registrationIp: text("registration_ip"), // hashed IP at join time
    totalRevenue: real("total_revenue").notNull().default(0),
    referredCustomers: integer("referred_customers").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_partners_project").on(table.projectId),
    index("idx_partners_user").on(table.userId),
    uniqueIndex("idx_partners_email_project").on(
      table.projectId,
      table.email,
    ),
  ],
);

export type PartnerRow = typeof partners.$inferSelect;
export type NewPartnerRow = typeof partners.$inferInsert;

// Customers - people referred by partners
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"), // customer display name (optional)
    stripeCustomerId: text("stripe_customer_id"), // Stripe customer ID for on-demand status lookups
    isSelfReferral: integer("is_self_referral", { mode: "boolean" }).notNull().default(false),
    flagReason: text("flag_reason"), // when set, customer is flagged and future commissions are blocked
    status: text("status", {
      enum: [
        "trialing",
        "paid",
        "cancelled",
        "past_due",
        "refunded",
        "cancels_on",
      ],
    })
      .notNull()
      .default("trialing"),
    revenue: real("revenue").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_customers_project").on(table.projectId),
    index("idx_customers_partner").on(table.partnerId),
    uniqueIndex("idx_customers_project_email").on(table.projectId, table.email),
  ],
);

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;

// Payments - source-agnostic ledger of payments (Stripe subs/charges, CSV, future) with optional partner attribution
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id").references(() => partners.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("stripe"),
    externalPaymentId: text("external_payment_id").notNull(),
    kind: text("kind", { enum: ["subscription", "one_time"] }).notNull(),
    customerEmail: text("customer_email"),
    customerName: text("customer_name"),
    planName: text("plan_name"),
    mrr: real("mrr"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    status: text("status"),
    flagReason: text("flag_reason"),
    // Snapshots taken at assignment time so program edits don't retroactively
    // change recurring-payout calculations for existing assignments.
    commissionProgramId: text("commission_program_id"),
    programType: text("program_type", {
      enum: ["recurring", "lifetime", "one-time"],
    }),
    durationMonths: integer("duration_months"),
    rate: real("rate"),
    flatAmount: real("flat_amount"),
    // Stripe `subscription.billing_cycle_anchor` — the anchor we derive
    // monthIndex from for recurring commissions.
    subscriptionAnchorAt: integer("subscription_anchor_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_payments_project_source_extid").on(
      table.projectId,
      table.source,
      table.externalPaymentId,
    ),
    index("idx_payments_project_partner").on(table.projectId, table.partnerId),
    index("idx_payments_project").on(table.projectId),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;

// Partner OTPs - one-time codes for partner login via join page
export const partnerOtps = sqliteTable(
  "partner_otps",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_partner_otps_project_email").on(table.projectId, table.email),
  ],
);

export type PartnerOtpRow = typeof partnerOtps.$inferSelect;
export type NewPartnerOtpRow = typeof partnerOtps.$inferInsert;

// Clicks - tracked referral link clicks
export const clicks = sqliteTable(
  "clicks",
  {
    id: text("id").primaryKey(),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referralCode: text("referral_code").notNull(),
    ip: text("ip"), // hashed for privacy
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    landingPage: text("landing_page"),
    isUnique: integer("is_unique", { mode: "boolean" })
      .notNull()
      .default(true),
    country: text("country"),
    botScore: integer("bot_score"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_clicks_project").on(table.projectId),
    index("idx_clicks_partner").on(table.partnerId),
    index("idx_clicks_referral_created").on(table.referralCode, table.createdAt),
    index("idx_clicks_ip_referral_created").on(table.ip, table.referralCode, table.createdAt),
  ],
);

export type ClickRow = typeof clicks.$inferSelect;
export type NewClickRow = typeof clicks.$inferInsert;

// Commissions - earned commissions from conversions
export const commissions = sqliteTable(
  "commissions",
  {
    id: text("id").primaryKey(),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    rate: real("rate").notNull(), // snapshot of commission rate at calculation time
    status: text("status", { enum: ["pending", "approved", "paid", "rejected"] })
      .notNull()
      .default("pending"),
    externalEventId: text("external_event_id"),
    eventDate: integer("event_date", { mode: "timestamp" }), // when the payment actually occurred (e.g. Stripe charge/invoice date)
    fraudFlag: text("fraud_flag"),
    commissionProgramId: text("commission_program_id"),
    monthIndex: integer("month_index"),
    mrr: real("mrr"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_commissions_partner_status").on(table.partnerId, table.status),
    index("idx_commissions_project").on(table.projectId),
    uniqueIndex("idx_commissions_event_unique").on(
      table.projectId,
      table.externalEventId,
    ),
  ],
);

export type CommissionRow = typeof commissions.$inferSelect;
export type NewCommissionRow = typeof commissions.$inferInsert;

// Commission Programs (rules/templates) - define how partners earn
export const commissionPrograms = sqliteTable(
  "commission_programs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // e.g. "rec-30-3"
    name: text("name").notNull(), // e.g. "Standard recurring"
    type: text("type", { enum: ["recurring", "lifetime", "one-time"] })
      .notNull()
      .default("recurring"),
    rate: real("rate").notNull(), // percent (e.g. 30 for 30%)
    durationMonths: integer("duration_months"), // for recurring; null for lifetime/one-time
    flatAmount: real("flat_amount"), // for one-time when set; otherwise null
    description: text("description"),
    minPayout: real("min_payout").notNull().default(50),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    payoutCadence: text("payout_cadence"),
    payoutDayOfMonth: integer("payout_day_of_month"),
    payoutDayOfWeek: integer("payout_day_of_week"),
    payoutOrdinal: integer("payout_ordinal"),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_commission_programs_project_code").on(
      table.projectId,
      table.code,
    ),
    index("idx_commission_programs_project").on(table.projectId),
  ],
);

export type CommissionProgramRow = typeof commissionPrograms.$inferSelect;
export type NewCommissionProgramRow = typeof commissionPrograms.$inferInsert;

// Coupons - coupon code attribution to partners
export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    commissionProgramId: text("commission_program_id").references(
      () => commissionPrograms.id,
      { onDelete: "set null" },
    ),
    code: text("code").notNull(), // e.g. "IHW20"
    customerDiscount: text("customer_discount"), // human-readable, e.g. "15% off year 1"
    stripeCoupon: text("stripe_coupon"), // optional external coupon id
    redemptions: integer("redemptions").notNull().default(0),
    mrrAttributed: real("mrr_attributed").notNull().default(0),
    status: text("status", { enum: ["live", "paused", "archived"] })
      .notNull()
      .default("live"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_coupons_project_code").on(table.projectId, table.code),
    index("idx_coupons_partner").on(table.partnerId),
    index("idx_coupons_program").on(table.commissionProgramId),
  ],
);

export type CouponRow = typeof coupons.$inferSelect;
export type NewCouponRow = typeof coupons.$inferInsert;

// Coupon redemptions - idempotency records for external coupon use
export const couponRedemptions = sqliteTable(
  "coupon_redemptions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    externalRedemptionId: text("external_redemption_id").notNull(),
    amount: real("amount").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_coupon_redemptions_coupon_external").on(
      table.couponId,
      table.externalRedemptionId,
    ),
    index("idx_coupon_redemptions_project").on(table.projectId),
    index("idx_coupon_redemptions_coupon").on(table.couponId),
  ],
);

export type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemptionRow = typeof couponRedemptions.$inferInsert;

// API Keys - project-level keys for authenticating the conversion endpoint
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(), // SHA-256 hash of the full key
    prefix: text("prefix").notNull(), // first 8 chars for display (e.g. "ia_ab12cd34")
    name: text("name").notNull(), // user-given label
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_api_keys_project").on(table.projectId),
    uniqueIndex("idx_api_keys_hash").on(table.keyHash),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

// Stripe Connections - stores encrypted Stripe API key + sync state per project
export const stripeConnections = sqliteTable(
  "stripe_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" })
      .unique(),
    encryptedApiKey: text("encrypted_api_key").notNull(), // AES-GCM encrypted
    metadataMappings: text("metadata_mappings"), // JSON: { referralCodeKeys: string[], source: "charge_metadata" | "subscription_metadata" | "both" }
    lastSyncSummary: text("last_sync_summary"), // JSON: SyncSummary from last sync run
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
    lastSyncCursor: text("last_sync_cursor"), // for incremental sync
    syncStatus: text("sync_status", { enum: ["idle", "syncing", "error"] })
      .notNull()
      .default("idle"),
    syncError: text("sync_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_stripe_connections_project").on(table.projectId),
  ],
);

export type StripeConnectionRow = typeof stripeConnections.$inferSelect;
export type NewStripeConnectionRow = typeof stripeConnections.$inferInsert;

// Sync Logs - audit trail for sync runs
export const syncLogs = sqliteTable(
  "sync_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["stripe"] }).notNull(),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    processedCount: integer("processed_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_sync_logs_project").on(table.projectId),
  ],
);

export type SyncLogRow = typeof syncLogs.$inferSelect;
export type NewSyncLogRow = typeof syncLogs.$inferInsert;

// Project Branding - customization settings for the partner sign-up page
export const projectBranding = sqliteTable(
  "project_branding",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" })
      .unique(),
    logo: text("logo"), // R2 object key
    brandColor: text("brand_color").notNull().default("#7c3aed"),
    headline: text("headline").notNull().default("Join our affiliate program"),
    description: text("description"),
    backgroundImage: text("background_image"), // R2 object key
    ctaText: text("cta_text").notNull().default("Become a Partner"),
    fontFamily: text("font_family").notNull().default("Inter"),
    borderRadius: text("border_radius").notNull().default("soft"),
    autoApprove: integer("auto_approve", { mode: "boolean" })
      .notNull()
      .default(false),
    defaultCommissionRate: real("default_commission_rate").notNull().default(0.2),
    defaultCommissionProgramId: text("default_commission_program_id"),
    wordmark: text("wordmark"),
    backgroundMode: text("background_mode").notNull().default("cream"),
    layout: text("layout").notNull().default("split"),
    theme: text("theme").notNull().default("minimal"),
    partnerAgreement: text("partner_agreement"),
    showSocialProof: integer("show_social_proof", { mode: "boolean" })
      .notNull()
      .default(true),
    showFaq: integer("show_faq", { mode: "boolean" }).notNull().default(true),
    showEarningsCalculator: integer("show_earnings_calculator", { mode: "boolean" })
      .notNull()
      .default(false),
    showTermsAcceptance: integer("show_terms_acceptance", { mode: "boolean" })
      .notNull()
      .default(true),
    socialProofText: text("social_proof_text"),
    socialProofAvatars: text("social_proof_avatars"),
    faqs: text("faqs"),
    samplePlanName: text("sample_plan_name"),
    samplePlanPrice: real("sample_plan_price"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_branding_project").on(table.projectId),
  ],
);

export type ProjectBrandingRow = typeof projectBranding.$inferSelect;
export type NewProjectBrandingRow = typeof projectBranding.$inferInsert;

// Fraud Flags - system-detected and user-confirmed fraud signals
export const fraudFlags = sqliteTable(
  "fraud_flags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id").references(() => partners.id, {
      onDelete: "set null",
    }),
    type: text("type", {
      enum: [
        "self_referral",
        "owner_as_partner",
        "duplicate_commission",
        "click_flood",
        "bot_click",
        "geo_mismatch",
        "velocity_spike",
        "multi_account",
        "customer_reuse",
        "revenue_cap",
        "manual",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["low", "medium", "high"] }).notNull(),
    status: text("status", { enum: ["open", "dismissed", "confirmed"] })
      .notNull()
      .default("open"),
    details: text("details").notNull(), // JSON blob with context
    relatedCommissionId: text("related_commission_id"),
    relatedClickId: text("related_click_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_fraud_flags_project_status").on(table.projectId, table.status),
    index("idx_fraud_flags_partner").on(table.partnerId),
  ],
);

export type FraudFlagRow = typeof fraudFlags.$inferSelect;
export type NewFraudFlagRow = typeof fraudFlags.$inferInsert;

// Payouts - manual payout records from project owners to partners
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status", { enum: ["scheduled", "paid", "failed"] })
      .notNull()
      .default("scheduled"),
    note: text("note"), // optional note from the admin
    periodStart: integer("period_start", { mode: "timestamp" }), // payout period covered
    periodEnd: integer("period_end", { mode: "timestamp" }),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_payouts_project").on(table.projectId),
    index("idx_payouts_partner").on(table.partnerId),
    index("idx_payouts_partner_status").on(table.partnerId, table.status),
  ],
);

export type PayoutRow = typeof payouts.$inferSelect;
export type NewPayoutRow = typeof payouts.$inferInsert;

// Payout commission links - exact commission batch represented by a payout
export const payoutCommissions = sqliteTable(
  "payout_commissions",
  {
    payoutId: text("payout_id")
      .notNull()
      .references(() => payouts.id, { onDelete: "cascade" }),
    commissionId: text("commission_id")
      .notNull()
      .references(() => commissions.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_payout_commissions_payout_commission").on(
      table.payoutId,
      table.commissionId,
    ),
    uniqueIndex("idx_payout_commissions_commission_unique").on(
      table.commissionId,
    ),
    index("idx_payout_commissions_payout").on(table.payoutId),
  ],
);

export type PayoutCommissionRow = typeof payoutCommissions.$inferSelect;
export type NewPayoutCommissionRow = typeof payoutCommissions.$inferInsert;

// Commission adjustments (clawbacks) - a positive amount owed back to the
// program when a paid commission's customer is later refunded. `pending`
// adjustments are netted against the partner's next payout, then marked
// `applied`; `dismissed` means the owner recovered it another way.
export const commissionAdjustments = sqliteTable(
  "commission_adjustments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    commissionId: text("commission_id")
      .notNull()
      .references(() => commissions.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    reason: text("reason").notNull().default("refund"),
    status: text("status", { enum: ["pending", "applied", "dismissed"] })
      .notNull()
      .default("pending"),
    appliedPayoutId: text("applied_payout_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    appliedAt: integer("applied_at", { mode: "timestamp" }),
  },
  (table) => [
    // One adjustment per commission — you can't claw back the same one twice.
    uniqueIndex("idx_commission_adjustments_commission").on(table.commissionId),
    index("idx_commission_adjustments_partner_status").on(
      table.partnerId,
      table.status,
    ),
  ],
);

export type CommissionAdjustmentRow = typeof commissionAdjustments.$inferSelect;
export type NewCommissionAdjustmentRow =
  typeof commissionAdjustments.$inferInsert;

// User Subscriptions (billing) - selected plan (nullable until onboarding), Stripe customer/subscription, status, trial
export const userSubscriptions = sqliteTable(
  "user_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" })
      .unique(),
    // Plan is null until the user explicitly chooses a subscription tier during onboarding or billing.
    plan: text("plan", { enum: ["starter", "growth", "scale"] }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status", { enum: ["active", "canceled", "past_due", "trialing"] })
      .notNull()
      .default("active"),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
    trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_user_subscriptions_user").on(table.userId),
    index("idx_user_subscriptions_stripe_customer").on(table.stripeCustomerId),
  ],
);

export type UserSubscriptionRow = typeof userSubscriptions.$inferSelect;
export type NewUserSubscriptionRow = typeof userSubscriptions.$inferInsert;

// Notifications - in-app notifications for account and billing events
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["system", "billing", "account"],
    })
      .notNull()
      .default("system"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    href: text("href"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_notifications_user_created").on(table.userId, table.createdAt),
    index("idx_notifications_user_read").on(table.userId, table.isRead),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

// Webhook Endpoints - configured URLs per project for event delivery
export const webhookEndpoints = sqliteTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").notNull(), // JSON array of event types
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_webhook_endpoints_project").on(table.projectId),
    index("idx_webhook_endpoints_active").on(table.projectId, table.isActive),
  ],
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRow = typeof webhookEndpoints.$inferInsert;

// Webhook Logs - delivery history per endpoint
export const webhookLogs = sqliteTable(
  "webhook_logs",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    attempt: integer("attempt").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    index("idx_webhook_logs_endpoint").on(table.endpointId),
    index("idx_webhook_logs_endpoint_created").on(table.endpointId, table.createdAt),
  ],
);

export type WebhookLogRow = typeof webhookLogs.$inferSelect;
export type NewWebhookLogRow = typeof webhookLogs.$inferInsert;

export const schema = {
  ...authSchema,
  projects,
  partners,
  customers,
  clicks,
  commissions,
  apiKeys,
  stripeConnections,
  syncLogs,
  projectBranding,
  fraudFlags,
  payouts,
  userSubscriptions,
  notifications,
  webhookEndpoints,
  webhookLogs,
  commissionPrograms,
  coupons,
} as const;
