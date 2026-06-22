import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, and, desc, isNotNull, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { except } from "hono/combine";
import { createAuth, getTrustedOrigins } from "./auth";
import { type HonoAppContext, type AppEnv } from "./types";
import type { Session } from "better-auth";
import {
  partners,
  userSubscriptions,
  projects,
  partnerOtps,
  notifications,
  users,
  payments,
  commissions,
  payouts,
  payoutCommissions,
  commissionPrograms,
  schema,
} from "./db";
import { ProjectService } from "./services/project-service";

/** Sign session token with HMAC-SHA256, base64url no padding (Better Auth compatible). Uses Worker crypto.subtle. */
async function signSessionToken(secret: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
import { PartnerService } from "./services/partner-service";
import { CustomerService } from "./services/customer-service";
import { DashboardService } from "./services/dashboard-service";
import { TrackingService } from "./services/tracking-service";
import { hashIP } from "./services/tracking-service";
import { CommissionService } from "./services/commission-service";
import { AnalyticsService } from "./services/analytics-service";
import { ApiKeyService } from "./services/api-key-service";
import { EmailService } from "./services/email-service";
import { BrandingService } from "./services/branding-service";
import {
  CommissionProgramService,
  CouponService,
} from "./services/commission-program-service";
import { StripeService } from "./services/stripe-service";
import { StripeSyncService } from "./services/stripe-sync-service";
import {
  PaymentService,
  type AssignedFilter,
  type SourceFilter,
} from "./services/payment-service";
import {
  PaymentLiveService,
  monthIndexFromAnchor,
  type Kind as LiveKind,
  type AssignedFilter as LiveAssignedFilter,
} from "./services/payment-live-service";
import { FraudService } from "./services/fraud-service";
import { PartnerDashboardService } from "./services/partner-dashboard-service";
import { PayoutService } from "./services/payout-service";
import { ImportService } from "./services/import-service";
import { SubscriptionService } from "./services/subscription-service";
import { WebhookService } from "./services/webhook-service";
import {
  getPriceId,
  createCheckoutSession,
  createBillingPortalSession,
  getPlanFromPriceId,
  type Plan,
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionImmediately,
} from "./services/stripe-checkout";
import { verifyStripeWebhookSignature } from "./services/stripe-webhook";
import { getMaxProjects,  type Plan as BillingPlan } from "./billing";
import {
  createProjectSchema,
  updateProjectSchema,
  createPartnerSchema,
  updatePartnerSchema,
  updateCommissionSchema,
  bulkCommissionActionSchema,
  createCommissionProgramSchema,
  trackClickSchema,
  trackConversionSchema,
  createApiKeySchema,
  connectStripeSchema,
  updateBrandingSchema,
  joinPartnerSchema,
  verifyPartnerOtpSchema,
  updateFraudFlagSchema,
  createPayoutSchema,
  updatePayoutSchema,
  updateMetadataMappingsSchema,
  updatePartnerPayoutLinkSchema,
  csvImportSchema,
  stripeImportPreviewSchema,
  stripeImportExecuteSchema,
  stripeCustomerSearchSchema,
  assignPartnerToCustomersSchema,
  createCheckoutSessionSchema,
  createPortalSessionSchema,
  selectSubscriptionPlanSchema,
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from "./validation";

// ─── Shared status filter helpers ────────────────────────────────────────────
type CustomerStatusFilter =
  | "trialing"
  | "paid"
  | "cancelled"
  | "past_due"
  | "refunded"
  | "cancels_on"
  | "all";

const CUSTOMER_STATUS_VALUES: readonly CustomerStatusFilter[] = [
  "trialing",
  "paid",
  "cancelled",
  "past_due",
  "refunded",
  "cancels_on",
  "all",
];

function parseCustomerStatusFilter(
  value: string | null | undefined,
): CustomerStatusFilter | undefined {
  if (!value) return undefined;
  return (CUSTOMER_STATUS_VALUES as readonly string[]).includes(value)
    ? (value as CustomerStatusFilter)
    : undefined;
}

type PartnerStatusFilter = "active" | "pending" | "inactive" | "all";

const PARTNER_STATUS_VALUES: readonly PartnerStatusFilter[] = [
  "active",
  "pending",
  "inactive",
  "all",
];

function parsePartnerStatusFilter(
  value: string | null | undefined,
): PartnerStatusFilter | undefined {
  if (!value) return undefined;
  return (PARTNER_STATUS_VALUES as readonly string[]).includes(value)
    ? (value as PartnerStatusFilter)
    : undefined;
}

// ─── Simple IP-based rate limiter (in-memory, per-isolate) ───────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// ─── Zod validation helper ───────────────────────────────────────────────────
function validate<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ message: string }> };
    };
  },
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data as T };
  const message = result.error?.issues?.[0]?.message ?? "Validation failed";
  return { success: false, error: message };
}

// Shared handler for /payouts/approve and /payouts/deny. The only difference
// is the resulting commission status + the `denied_by_owner` fraud flag we tag
// on rejections so they're distinguishable from auto-detected fraud.
async function actionPendingPayout(
  c: import("hono").Context<HonoAppContext>,
  status: "approved" | "rejected",
) {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const projectId = c.req.param("id");
  const db = c.get("db");
  const projectService = new ProjectService(db);
  const project = await projectService.getProjectById(projectId);
  if (!project || project.userId !== user.id) {
    return c.json({ error: "Project not found" }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    paymentId?: string;
    eventId?: string;
    monthIndex?: number | null;
    revenue?: number;
    mrr?: number | null;
    eventDate?: number;
    commissionAmount?: number;
  };
  if (
    !body.paymentId ||
    !body.eventId ||
    typeof body.revenue !== "number" ||
    typeof body.eventDate !== "number"
  ) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const paymentRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, body.paymentId), eq(payments.projectId, projectId)))
    .limit(1);
  const payment = paymentRows[0];
  if (!payment || !payment.partnerId || !payment.customerEmail) {
    return c.json(
      { error: "Assignment not found or missing partner/customer" },
      404,
    );
  }

  const commissionService = new CommissionService(db);
  const result = await commissionService.recordConversion({
    partnerId: payment.partnerId,
    projectId,
    customerEmail: payment.customerEmail.toLowerCase(),
    revenue: body.revenue,
    mrr: body.mrr ?? undefined,
    eventId: body.eventId,
    eventDate: new Date(body.eventDate * 1000),
    monthIndex: body.monthIndex ?? undefined,
    commissionProgramId: payment.commissionProgramId,
    rate: payment.rate ?? undefined,
    commissionAmount:
      typeof body.commissionAmount === "number"
        ? body.commissionAmount
        : undefined,
    forceStatus: status,
    forceFraudFlag: status === "rejected" ? "denied_by_owner" : undefined,
  });
  return c.json(result);
}

interface CommissionForPayoutRecord {
  id: string;
  projectId: string;
  partnerId: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  fraudFlag: string | null;
  eventDate: Date | string | null;
  createdAt: Date | string;
  projectName: string;
  partnerName: string;
  partnerPayoutLink?: string | null;
  programMinPayout?: number | null;
  payoutCadence?: string | null;
  payoutDayOfMonth?: number | null;
  payoutDayOfWeek?: number | null;
  payoutOrdinal?: number | null;
}

interface CommissionActionCandidate {
  status: "pending" | "approved" | "paid" | "rejected";
  fraudFlag: string | null;
}

type CommissionBulkAction = "approve" | "pay" | "reject";
type CommissionStatusUpdate = "pending" | "approved" | "paid" | "rejected";

interface PaidPayoutWebhookData {
  id: string;
  projectId: string;
  partnerId: string;
  amount: number;
  currency: string;
  status: "paid";
  paidAt: Date;
}

function isCommissionEligibleForAction(
  commission: CommissionActionCandidate,
  action: CommissionBulkAction,
): boolean {
  if (action === "approve") {
    return commission.status === "pending" && !commission.fraudFlag;
  }
  if (action === "pay") {
    return commission.status === "approved" && !commission.fraudFlag;
  }
  if (action === "reject") {
    return commission.status !== "paid";
  }
  return false;
}

function getCommissionTransitionError(
  commission: CommissionActionCandidate,
  nextStatus: CommissionStatusUpdate,
): string | null {
  if (nextStatus === "pending" && commission.status !== "pending") {
    return "Commissions cannot be moved back to pending";
  }
  if (nextStatus === "approved" && !isCommissionEligibleForAction(commission, "approve")) {
    return "Only unflagged pending commissions can be approved";
  }
  if (nextStatus === "paid" && !isCommissionEligibleForAction(commission, "pay")) {
    return "Only unflagged approved commissions can be marked paid";
  }
  if (nextStatus === "rejected" && !isCommissionEligibleForAction(commission, "reject")) {
    return "Paid commissions cannot be rejected";
  }
  return null;
}

function validateMinimumPayout(
  commissionsToPay: CommissionForPayoutRecord[],
): string | null {
  const byTarget = new Map<string, CommissionForPayoutRecord[]>();
  for (const commission of commissionsToPay) {
    const groupKey = `${commission.projectId}:${commission.partnerId}`;
    const group = byTarget.get(groupKey) ?? [];
    group.push(commission);
    byTarget.set(groupKey, group);
  }

  for (const group of byTarget.values()) {
    const minimum = Math.max(
      ...group.map((commission) => commission.programMinPayout ?? 0),
      0,
    );
    if (minimum <= 0) continue;

    const amount = group.reduce(
      (total, commission) => total + commission.amount,
      0,
    );
    if (amount + 0.005 < minimum) {
      const partnerName = group[0]?.partnerName ?? "This partner";
      return `${partnerName} has ${amount.toFixed(
        2,
      )} selected for payout, below the ${minimum.toFixed(2)} minimum payout.`;
    }
  }

  return null;
}

function validatePayoutMethod(
  commissionsToPay: CommissionForPayoutRecord[],
): string | null {
  const byTarget = new Map<string, CommissionForPayoutRecord[]>();
  for (const commission of commissionsToPay) {
    const groupKey = `${commission.projectId}:${commission.partnerId}`;
    const group = byTarget.get(groupKey) ?? [];
    group.push(commission);
    byTarget.set(groupKey, group);
  }

  for (const group of byTarget.values()) {
    const first = group[0];
    if (!first?.partnerPayoutLink?.trim()) {
      return `${first?.partnerName ?? "This partner"} needs a payout method before commissions can be marked paid.`;
    }
  }

  return null;
}

function coercePayoutDate(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPayoutDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function matchMonthlyDay(from: Date, dayOfMonth: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const candidate = new Date(
    Date.UTC(year, month, Math.min(dayOfMonth, daysInMonth(year, month))),
  );
  if (candidate.getTime() >= from.getTime()) return candidate;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  return new Date(
    Date.UTC(
      nextYear,
      nextMonth,
      Math.min(dayOfMonth, daysInMonth(nextYear, nextMonth)),
    ),
  );
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  ordinal: number,
  dayOfWeek: number,
): Date {
  const normalizedYear = year + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  if (ordinal === 5) {
    for (
      let day = daysInMonth(normalizedYear, normalizedMonth);
      day >= 1;
      day--
    ) {
      const date = new Date(Date.UTC(normalizedYear, normalizedMonth, day));
      if (date.getUTCDay() === dayOfWeek) return date;
    }
  }
  let count = 0;
  for (let day = 1; day <= daysInMonth(normalizedYear, normalizedMonth); day++) {
    const date = new Date(Date.UTC(normalizedYear, normalizedMonth, day));
    if (date.getUTCDay() === dayOfWeek) {
      count++;
      if (count === ordinal) return date;
    }
  }
  return new Date(Date.UTC(normalizedYear, normalizedMonth, 1));
}

function matchMonthlyOrdinal(
  from: Date,
  ordinal: number,
  dayOfWeek: number,
): Date {
  for (let offset = 0; offset < 12; offset++) {
    const date = nthWeekdayOfMonth(
      from.getUTCFullYear(),
      from.getUTCMonth() + offset,
      ordinal,
      dayOfWeek,
    );
    if (date.getTime() >= from.getTime()) return date;
  }
  return from;
}

function matchWeekly(from: Date, dayOfWeek: number): Date {
  const result = new Date(from);
  const diff = (dayOfWeek - from.getUTCDay() + 7) % 7;
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

function commissionPayoutDueDate(
  commission: CommissionForPayoutRecord,
): Date | null {
  const start = startOfUtcDay(
    coercePayoutDate(commission.eventDate) ??
      coercePayoutDate(commission.createdAt) ??
      new Date(),
  );
  if (commission.payoutCadence === "monthly_day") {
    if (!commission.payoutDayOfMonth) return null;
    return matchMonthlyDay(start, commission.payoutDayOfMonth);
  }
  if (commission.payoutCadence === "monthly_ordinal") {
    if (
      commission.payoutOrdinal == null ||
      commission.payoutDayOfWeek == null
    ) {
      return null;
    }
    return matchMonthlyOrdinal(
      start,
      commission.payoutOrdinal,
      commission.payoutDayOfWeek,
    );
  }
  if (commission.payoutCadence === "weekly") {
    if (commission.payoutDayOfWeek == null) return null;
    return matchWeekly(start, commission.payoutDayOfWeek);
  }
  return null;
}

function validatePayoutSchedule(
  commissionsToPay: CommissionForPayoutRecord[],
): string | null {
  const today = startOfUtcDay(new Date());
  for (const commission of commissionsToPay) {
    const dueDate = commissionPayoutDueDate(commission);
    if (dueDate && dueDate.getTime() > today.getTime()) {
      return `${commission.partnerName} has a commission scheduled for payout on ${formatPayoutDate(
        dueDate,
      )}.`;
    }
  }
  return null;
}

function buildPaidPayoutNote(
  commissionsToPay: CommissionForPayoutRecord[],
  periodStart: Date | null,
  periodEnd: Date | null,
): string {
  const first = commissionsToPay[0];
  const projectName = first?.projectName ?? "Affiliate";
  const count = commissionsToPay.length;
  const period =
    periodStart && periodEnd
      ? ` for ${formatPayoutDate(periodStart)} to ${formatPayoutDate(periodEnd)}`
      : "";
  return `${projectName} affiliate payout: ${count} commission${
    count === 1 ? "" : "s"
  }${period}.`;
}

function calculateDerivedCommissionAmount({
  revenue,
  rate,
  programType,
  flatAmount,
}: {
  revenue: number;
  rate: number;
  programType: "recurring" | "lifetime" | "one-time";
  flatAmount: number | null;
}): number {
  if (programType === "one-time" && flatAmount != null) {
    return flatAmount;
  }
  return revenue * rate;
}

async function createPaidPayoutRecordsFromCommissions(
  db: DrizzleD1Database<Record<string, unknown>>,
  webhookService: WebhookService,
  commissionsToPay: CommissionForPayoutRecord[],
): Promise<{ payoutsCreated: number }> {
  const payableCommissions = commissionsToPay.filter(
    (commission) =>
      commission.status !== "paid" &&
      commission.status !== "rejected" &&
      !commission.fraudFlag &&
      commission.amount > 0,
  );

  const grouped = new Map<string, CommissionForPayoutRecord[]>();
  for (const commission of payableCommissions) {
    const key = `${commission.projectId}:${commission.partnerId}`;
    const group = grouped.get(key) ?? [];
    group.push(commission);
    grouped.set(key, group);
  }

  const createdPayouts = await db.transaction(async (tx) => {
    const rows: PaidPayoutWebhookData[] = [];
    for (const group of grouped.values()) {
      const first = group[0];
      if (!first) continue;

      const commissionIds = group.map((commission) => commission.id);
      const existingLinks = await tx
        .select({ commissionId: payoutCommissions.commissionId })
        .from(payoutCommissions)
        .where(inArray(payoutCommissions.commissionId, commissionIds));
      if (existingLinks.length > 0) {
        throw new Error(
          "One or more commissions are already attached to a payout record.",
        );
      }

      const dates = group
        .map((commission) =>
          coercePayoutDate(commission.eventDate) ??
          coercePayoutDate(commission.createdAt),
        )
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime());
      const periodStart = dates[0] ?? null;
      const periodEnd = dates[dates.length - 1] ?? null;
      const amount = Math.round(
        group.reduce((total, commission) => total + commission.amount, 0) * 100,
      ) / 100;
      const payoutId = crypto.randomUUID();
      const paidAt = new Date();

      await tx.insert(payouts).values({
        id: payoutId,
        projectId: first.projectId,
        partnerId: first.partnerId,
        amount,
        currency: "USD",
        status: "paid",
        note: buildPaidPayoutNote(group, periodStart, periodEnd),
        periodStart,
        periodEnd,
        paidAt,
      });
      await tx.insert(payoutCommissions).values(
        group.map((commission) => ({
          payoutId,
          commissionId: commission.id,
          amount: commission.amount,
        })),
      );
      await tx
        .update(commissions)
        .set({ status: "paid" })
        .where(inArray(commissions.id, commissionIds));

      rows.push({
        id: payoutId,
        projectId: first.projectId,
        partnerId: first.partnerId,
        amount,
        currency: "USD",
        status: "paid",
        paidAt,
      });
    }
    return rows;
  });

  for (const payout of createdPayouts) {
    await webhookService.fireEvent(payout.projectId, "payout.created", {
      payoutId: payout.id,
      projectId: payout.projectId,
      partnerId: payout.partnerId,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
    });
    await webhookService.fireEvent(payout.projectId, "payout.paid", {
      payoutId: payout.id,
      projectId: payout.projectId,
      partnerId: payout.partnerId,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
      paidAt: payout.paidAt.toISOString(),
    });
  }

  return { payoutsCreated: createdPayouts.length };
}

// CORS: never use wildcard when credentials are included (browser rejects). Reflect origin or use allow list.
const app = new Hono<HonoAppContext>()
  .use(
    "*",
    cors({
      origin: (origin) => origin || undefined,
      credentials: true,
    }),
  )
  .use(
    "/api/auth/*",
    cors({
      origin: (origin, c) => {
        const allowed = getTrustedOrigins(c.env);
        if (origin && allowed.includes(origin)) return origin;
        if (!origin && allowed.length) return allowed[0] ?? undefined;
        return undefined;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    }),
  )
  // Auth: every path under /api/auth is handled by better-auth (verify, sign-in, session, etc.).
  // Use path prefix check so /api/auth/magic-link/verify and all subpaths match regardless of router.
  .use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/api/auth")) return next();
    const requestOrigin =
      c.env.BETTER_AUTH_URL ?? (() => {
        try {
          return new URL(c.req.url).origin;
        } catch {
          return undefined;
        }
      })();
    const auth = createAuth(
      c.env,
      c.req.raw.cf as IncomingRequestCfProperties,
      requestOrigin,
    );
    return auth.handler(c.req.raw);
  })
  .use(
    "*",
    except(["/api/*"], async (c) => {
      return c.env.ASSETS.fetch(c.req.raw);
    }),
  )
  // ─── Public Tracking Endpoints (no auth required) ───────────────────────────
  .get("/api/t/:referralCode", async (c) => {
    // Rate limit: 60 req/min per IP
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (!checkRateLimit(`track:${ip}`, 60, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }

    const referralCode = c.req.param("referralCode");
    const db = drizzle(c.env.DB);
    const trackingService = new TrackingService(db);

    const partner =
      await trackingService.getPartnerByReferralCode(referralCode);
    if (!partner || partner.status !== "active") {
      return c.text("Invalid referral link", 404);
    }

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(partner.projectId);

    // Resolve the public app origin for hosted redirects (Option 2: merchant domain or join page):
    // - Prefer BETTER_AUTH_URL (explicit app URL)
    // - Fall back to the current request origin
    // - In dev, if origin is the worker (e.g. :8787), redirect to the SPA (e.g. :5173) so /join lands correctly
    let appOrigin: string | undefined;
    const authBase = c.env.BETTER_AUTH_URL;
    if (authBase) {
      try {
        appOrigin = new URL(authBase).origin;
      } catch {
        appOrigin = undefined;
      }
    }
    if (!appOrigin) {
      try {
        appOrigin = new URL(c.req.url).origin;
      } catch {
        appOrigin = undefined;
      }
    }
    const isWorkerDevOrigin =
      appOrigin === "http://localhost:8787" ||
      appOrigin === "http://127.0.0.1:8787";
    if (isWorkerDevOrigin) {
      appOrigin = "http://localhost:5173";
    }

    // Extract Cloudflare metadata for fraud detection
    const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined;
    const country = cf?.country as string | undefined;
    const botScore = (cf as Record<string, unknown>)?.botManagement
      ? ((cf as Record<string, unknown>).botManagement as { score?: number })
          ?.score
      : undefined;

    // Record click (with fraud detection)
    const { clickId: redirectClickId } = await trackingService.recordClick({
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
      ip,
      userAgent: c.req.header("user-agent"),
      referrer: c.req.header("referer"),
      landingPage: c.req.query("url"),
      country,
      botScore,
    });

    const webhookServiceClick = new WebhookService(db);
    await webhookServiceClick.fireEvent(partner.projectId, "click.recorded", {
      clickId: redirectClickId,
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
    });

    // Set referral cookie (30 days)
    const maxAge = 30 * 24 * 60 * 60;
    c.header(
      "Set-Cookie",
      `__ia_ref=${partner.referralCode}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`,
    );

    // Redirect to landing page or return 1x1 pixel
    const redirectUrl = c.req.query("url");
    if (redirectUrl) {
      // Validate redirect URL against the project's configured domain to
      // prevent open-redirect attacks (e.g. /api/t/CODE?url=https://evil.com)
      try {
        const parsed = new URL(redirectUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return c.text("Invalid redirect URL", 400);
        }
        // If the project has a domain configured, enforce it
        if (project?.domain) {
          const allowedHost = project.domain
            .toLowerCase()
            .replace(/^www\./, "");
          const redirectHost = parsed.hostname
            .toLowerCase()
            .replace(/^www\./, "");
          if (redirectHost !== allowedHost) {
            return c.text("Redirect URL does not match project domain", 403);
          }
        }
      } catch {
        return c.text("Invalid redirect URL", 400);
      }
      return c.redirect(redirectUrl, 302);
    }

    if (project?.domain) {
      const bareDomain = project.domain.replace(/^https?:\/\//, "");
      const landing = `https://${bareDomain}/?ref=${encodeURIComponent(
        partner.referralCode,
      )}`;
      return c.redirect(landing, 302);
    }

    if (project?.slug && appOrigin) {
      const hostedLanding = `${appOrigin}/join/${encodeURIComponent(
        project.slug,
      )}?ref=${encodeURIComponent(partner.referralCode)}`;
      return c.redirect(hostedLanding, 302);
    }

    const pixel = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
      0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]);
    return new Response(pixel, {
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
    });
  })
  .post("/api/track/click", async (c) => {
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    if (!checkRateLimit(`track:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(trackClickSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = drizzle(c.env.DB);
    const trackingService = new TrackingService(db);

    const partner = await trackingService.getPartnerByReferralCode(
      parsed.data.referralCode,
    );
    if (!partner || partner.status !== "active") {
      return c.json({ error: "Invalid referral code" }, 404);
    }

    // Extract Cloudflare metadata for fraud detection
    const cf2 = c.req.raw.cf as IncomingRequestCfProperties | undefined;
    const clickCountry = cf2?.country as string | undefined;
    const clickBotScore = (cf2 as Record<string, unknown>)?.botManagement
      ? ((cf2 as Record<string, unknown>).botManagement as { score?: number })
          ?.score
      : undefined;

    const { clickId } = await trackingService.recordClick({
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
      ip,
      userAgent: c.req.header("user-agent"),
      referrer: c.req.header("referer"),
      landingPage: parsed.data.landingPage,
      country: clickCountry,
      botScore: clickBotScore,
    });

    const webhookServiceTrack = new WebhookService(db);
    await webhookServiceTrack.fireEvent(partner.projectId, "click.recorded", {
      clickId,
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
    });

    const maxAge = 30 * 24 * 60 * 60;
    c.header(
      "Set-Cookie",
      `__ia_ref=${partner.referralCode}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`,
    );

    return c.json({ clickId, referralCode: partner.referralCode });
  })
  .post("/api/track/conversion", async (c) => {
    // ─── API Key Auth ─────────────────────────────────────────────────────────
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ia_")) {
      return c.json(
        { error: "API key required. Use Authorization: Bearer ia_xxx" },
        401,
      );
    }
    const apiKeyValue = authHeader.slice(7); // remove "Bearer "

    const db = drizzle(c.env.DB);
    const apiKeyService = new ApiKeyService(db);
    const keyResult = await apiKeyService.verifyKey(apiKeyValue);
    if (!keyResult) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Rate limit: 30 req/min per API key
    if (!checkRateLimit(`conv:${keyResult.keyId}`, 30, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(trackConversionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const trackingService = new TrackingService(db);
    const partner = await trackingService.getPartnerByReferralCode(
      parsed.data.referralCode,
    );

    if (!partner || partner.projectId !== keyResult.projectId) {
      return c.json({ error: "Invalid referral code for this project" }, 404);
    }

    const commissionService = new CommissionService(db);
    const convCf = c.req.raw.cf as IncomingRequestCfProperties | undefined;
    const result = await commissionService.recordConversion({
      partnerId: partner.id,
      projectId: keyResult.projectId,
      customerEmail: parsed.data.customerEmail.trim().toLowerCase(),
      revenue: parsed.data.revenue,
      customerStatus: parsed.data.customerStatus,
      eventId: parsed.data.eventId,
      conversionCountry: convCf?.country as string | undefined,
      mrr: parsed.data.mrr,
    });

    if (result.conversionCreated) {
      const webhookServiceConv = new WebhookService(db);
      await webhookServiceConv.fireEvent(keyResult.projectId, "customer.created", {
        customerId: result.customerId,
        partnerId: partner.id,
        email: parsed.data.customerEmail.trim().toLowerCase(),
        revenue: parsed.data.revenue,
      });
      await webhookServiceConv.fireEvent(keyResult.projectId, "commission.created", {
        commissionId: result.commissionId,
        customerId: result.customerId,
        partnerId: partner.id,
        amount: result.commissionAmount,
      });
    }

    return c.json(result, result.conversionCreated ? 201 : 200);
  })
  // ─── Public: Serve uploaded images from R2 ─────────────────────────────────
  .get("/api/uploads/:key", async (c) => {
    const key = c.req.param("key");
    const object = await c.env.UPLOADS.get(key);
    if (!object) return c.text("Not found", 404);

    const headers = new Headers();
    headers.set(
      "Content-Type",
      object.httpMetadata?.contentType ?? "application/octet-stream",
    );
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(object.body, { headers });
  })
  // ─── Public: Get branding for partner join page ───────────────────────────
  .get("/api/join/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = drizzle(c.env.DB);
    const brandingService = new BrandingService(db);
    const result = await brandingService.getBySlug(slug);

    const baseUrl = c.req.url.split("/api")[0];

    if (!result) {
      // Fallback: allow join pages to work even if branding hasn't been created yet.
      console.warn("[join] branding missing for slug, falling back to project lookup", { slug });
      const rows = await db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);

      const projectRow = rows[0];
      if (!projectRow) {
        console.warn("[join] project not found for slug", { slug });
        return c.json({ error: "Program not found" }, 404);
      }

      return c.json({
        projectName: projectRow.name,
        // Mirror defaults used in PartnerPageDesigner / JoinPartnerProgram and DB defaults.
        brandColor: "#7c3aed",
        headline: "Join our affiliate program",
        description: null,
        ctaText: "Become a Partner",
        fontFamily: "Inter",
        borderRadius: "soft",
        logo: null,
        backgroundImage: null,
        wordmark: null,
        backgroundMode: "cream",
        layout: "split",
        showSocialProof: true,
        showFaq: true,
        showEarningsCalculator: false,
        showTermsAcceptance: true,
        socialProofText: null,
        socialProofAvatars: null,
        faqs: null,
        samplePlanName: null,
        samplePlanPrice: null,
        commissionProgram: null,
      });
    }

    // Resolve commission program (rate / type / duration) for the calculator
    let commissionProgram: {
      name: string;
      rate: number;
      type: string;
      durationMonths: number | null;
      flatAmount: number | null;
    } | null = null;
    if (result.branding.defaultCommissionProgramId) {
      const programService = new CommissionProgramService(db);
      const program = await programService.getById(
        result.branding.projectId,
        result.branding.defaultCommissionProgramId,
      );
      if (program) {
        commissionProgram = {
          name: program.name,
          rate: program.rate,
          type: program.type,
          durationMonths: program.durationMonths,
          flatAmount: program.flatAmount,
        };
      }
    }

    // Build public-facing response (don't expose internal IDs)
    return c.json({
      projectName: result.projectName,
      brandColor: result.branding.brandColor,
      headline: result.branding.headline,
      description: result.branding.description,
      ctaText: result.branding.ctaText,
      fontFamily: result.branding.fontFamily,
      borderRadius: result.branding.borderRadius,
      logo: result.branding.logo
        ? `${baseUrl}/api/uploads/${result.branding.logo}`
        : null,
      backgroundImage: result.branding.backgroundImage
        ? `${baseUrl}/api/uploads/${result.branding.backgroundImage}`
        : null,
      wordmark: result.branding.wordmark,
      backgroundMode: result.branding.backgroundMode,
      layout: result.branding.layout,
      showSocialProof: result.branding.showSocialProof,
      showFaq: result.branding.showFaq,
      showEarningsCalculator: result.branding.showEarningsCalculator,
      showTermsAcceptance: result.branding.showTermsAcceptance,
      socialProofText: result.branding.socialProofText,
      socialProofAvatars: (result.branding.socialProofAvatars ?? []).map((a) => ({
        image: a.image
          ? a.image.startsWith("http")
            ? a.image
            : `${baseUrl}/api/uploads/${a.image}`
          : null,
        initials: a.initials,
      })),
      faqs: result.branding.faqs,
      samplePlanName: result.branding.samplePlanName,
      samplePlanPrice: result.branding.samplePlanPrice,
      commissionProgram,
    });
  })
  // ─── Public: Partner self-registration ────────────────────────────────────
  .post("/api/join/:slug", async (c) => {
    try {
      const ip =
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for") ??
        "unknown";
      if (!checkRateLimit(`join:${ip}`, 5, 60_000)) {
        return c.json(
          { error: "Too many requests. Please try again later." },
          429,
        );
      }

      const slug = c.req.param("slug");
      const body = await c.req.json();
      const parsed = validate(joinPartnerSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const db = drizzle(c.env.DB);
      const brandingService = new BrandingService(db);

      let brandingResult = await brandingService.getBySlug(slug);
      if (!brandingResult) {
        const projectRows = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.slug, slug))
          .limit(1);
        const projectRow = projectRows[0];
        if (!projectRow) {
          return c.json({ error: "Program not found" }, 404);
        }
        brandingResult = {
          projectName: projectRow.name,
          branding: {
            projectId: projectRow.id,
            autoApprove: false,
            defaultCommissionRate: 0.2,
          },
        } as NonNullable<Awaited<ReturnType<BrandingService["getBySlug"]>>>;
      }

      const branding = brandingResult.branding;

      // Check for duplicate partner
      const partnerService = new PartnerService(db);
      const existing = await partnerService.getPartnerByEmail(
        branding.projectId,
        parsed.data.email.trim().toLowerCase(),
      );
      if (existing) {
        // Existing partner: send OTP instead of duplicate error
        const encoder = new TextEncoder();
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32])
          .join("");
        const data = encoder.encode(code);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const codeHash = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 32);

        const now = Date.now();
        const expiresAt = new Date(now + 10 * 60 * 1000);

        await db.insert(partnerOtps).values({
          id: crypto.randomUUID(),
          projectId: branding.projectId,
          email: parsed.data.email.trim().toLowerCase(),
          codeHash,
          expiresAt,
        });

        const emailService = new EmailService(
          c.env.RESEND_API_KEY,
        );
        await emailService
          .sendPartnerOtp({
            partnerEmail: parsed.data.email.trim().toLowerCase(),
            projectName: brandingResult.projectName,
            code,
          })
          .catch((err) =>
            console.error("Failed to send partner OTP email:", err),
          );

        return c.json(
          {
            status: "otp_required",
            message:
              "We found an existing partner account for this email. Enter the code we just emailed you to continue.",
          },
          200,
        );
      }

      // Hash IP for fraud detection
      const joinHashedIp = await hashIP(ip);

      const status = branding.autoApprove ? "active" : "pending";

      let resolvedRate = branding.defaultCommissionRate;
      if (branding.defaultCommissionProgramId) {
        const programService = new CommissionProgramService(db);
        const program = await programService.getById(
          branding.projectId,
          branding.defaultCommissionProgramId,
        );
        if (program) {
          resolvedRate = program.rate / 100;
        }
      }

      const partner = await partnerService.createPartner({
        projectId: branding.projectId,
        name: parsed.data.name.trim(),
        email: parsed.data.email.trim().toLowerCase(),
        commissionRate: resolvedRate,
        commissionProgramId: branding.defaultCommissionProgramId ?? null,
        status,
        registrationIp: joinHashedIp,
      });

      const webhookServiceJoin = new WebhookService(db);
      await webhookServiceJoin.fireEvent(branding.projectId, "partner.created", {
        partnerId: partner.id,
        name: partner.name,
        email: partner.email,
        status: partner.status,
        referralCode: partner.referralCode ?? null,
      });

      // Fraud checks: owner-as-partner + multi-account
      const joinFraudService = new FraudService(db);
      const joinOwnerCheck = await joinFraudService.checkOwnerAsPartner(
        parsed.data.email.trim().toLowerCase(),
        branding.projectId,
      );
      if (joinOwnerCheck) {
        await joinFraudService.createFlag({
          projectId: branding.projectId,
          partnerId: partner.id,
          type: joinOwnerCheck.type,
          severity: joinOwnerCheck.severity,
          details: joinOwnerCheck.details,
        });
      }

      const multiAccountCheck = await joinFraudService.checkMultiAccount(
        joinHashedIp,
        branding.projectId,
        partner.id,
      );
      if (multiAccountCheck) {
        await joinFraudService.createFlag({
          projectId: branding.projectId,
          partnerId: partner.id,
          type: multiAccountCheck.type,
          severity: multiAccountCheck.severity,
          details: multiAccountCheck.details,
        });
      }

      // Send appropriate email
      const emailService = new EmailService(
        c.env.RESEND_API_KEY,
      );
      const baseUrl = c.env.BETTER_AUTH_URL || c.req.url.split("/api")[0];

      if (branding.autoApprove) {
        emailService
          .sendPartnerWelcome({
            partnerName: partner.name,
            partnerEmail: partner.email,
            projectName: brandingResult.projectName,
            referralCode: partner.referralCode,
            baseUrl,
          })
          .catch((err) =>
            console.error("Failed to send partner welcome:", err),
          );
      } else {
        emailService
          .sendPartnerApplicationReceived({
            partnerName: partner.name,
            partnerEmail: partner.email,
            projectName: brandingResult.projectName,
          })
          .catch((err) =>
            console.error("Failed to send application received:", err),
          );
      }

      return c.json(
        {
          status,
          message: branding.autoApprove
            ? "Welcome! Check your email for your referral link."
            : "Application submitted! We'll review it and get back to you.",
        },
        201,
      );
    } catch (err) {
      console.error("POST /api/join error:", err);
      return c.json(
        { error: "Internal server error. Please try again later." },
        500,
      );
    }
  })
  .post("/api/partner/verify-otp", async (c) => {
    try {
      const body = await c.req.json();
      const parsed = validate(verifyPartnerOtpSchema, body);
      if (!parsed.success) return c.json({ error: parsed.error }, 400);

      const slug = parsed.data.slug;
      const email = parsed.data.email.trim().toLowerCase();
      const code = parsed.data.code.trim().toUpperCase();

      const db = drizzle(c.env.DB, { schema });
      const brandingService = new BrandingService(db);
      const brandingResult = await brandingService.getBySlug(slug);
      let projectId: string;
      if (!brandingResult) {
        const projectRows = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.slug, slug))
          .limit(1);
        const projectRow = projectRows[0];
        if (!projectRow) {
          return c.json({ error: "Program not found" }, 404);
        }
        projectId = projectRow.id;
      } else {
        projectId = brandingResult.branding.projectId;
      }

      // Hash provided code
      const encoder = new TextEncoder();
      const data = encoder.encode(code);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeHash = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);

      const now = Date.now();

      // Find latest matching OTP
      const rows = await db
        .select()
        .from(partnerOtps)
        .where(
          and(
            eq(partnerOtps.projectId, projectId),
            eq(partnerOtps.email, email),
            eq(partnerOtps.codeHash, codeHash),
          ),
        )
        .orderBy(desc(partnerOtps.createdAt))
        .limit(1);

      const otp = rows[0];

      if (
        !otp ||
        (otp.consumedAt instanceof Date
          ? otp.consumedAt.getTime() <= now
          : otp.consumedAt != null) ||
        (otp.expiresAt instanceof Date
          ? otp.expiresAt.getTime() < now
          : otp.expiresAt < now)
      ) {
        return c.json(
          { error: "Invalid or expired code. Please request a new one." },
          400,
        );
      }

      // Dev fallback: If there is no Better Auth secret and we're on localhost,
      // create or reuse a dev user and set a dev-partner-user cookie so partner
      // APIs can treat the user as authenticated.
      const isLocalhost =
        (c.env.BETTER_AUTH_URL ?? "").startsWith("http://localhost");
      if (!c.env.BETTER_AUTH_SECRET && isLocalhost) {
        const nowSec = Math.floor(Date.now() / 1000);
        let devUserId: string;
        try {
          const existing = await c.env.DB.prepare(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
          )
            .bind(email)
            .first<{ id: string }>();
          if (existing?.id) {
            devUserId = existing.id;
          } else {
            devUserId = crypto.randomUUID();
            await c.env.DB.prepare(
              "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
              .bind(devUserId, "", email, 1, nowSec, nowSec)
              .run();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            "POST /api/partner/verify-otp dev fallback user error:",
            msg,
          );
          return c.json(
            { error: "Internal server error. Please try again later.", debug: msg },
            500,
          );
        }

        await db
          .update(partnerOtps)
          .set({ consumedAt: new Date() })
          .where(eq(partnerOtps.id, otp.id));

        const devCookieParts = [
          `dev-partner-user=${devUserId}`,
          "Path=/",
          "SameSite=Lax",
        ];
        c.header("Set-Cookie", devCookieParts.join("; "));

        const now = new Date();
        const expiresAtSession = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        c.set("session", {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          userId: devUserId,
          expiresAt: expiresAtSession,
          token: "",
        });

        return c.json({ status: "ok", redirect: "/portal?dev_otp=1" });
      }

      if (!c.env.BETTER_AUTH_SECRET) {
        console.error("POST /api/partner/verify-otp: BETTER_AUTH_SECRET not set");
        return c.json(
          { error: "Internal server error. Please try again later.", debug: "BETTER_AUTH_SECRET not set" },
          500,
        );
      }

      // Use raw D1 to avoid Drizzle/schema issues in dev; SQLite timestamps in seconds
      const nowSec = Math.floor(Date.now() / 1000);
      const sessionExpiresIn = 60 * 60 * 24 * 7; // 7 days
      const expiresAtSec = nowSec + sessionExpiresIn;

      let userId: string;
      try {
        const userRow = await c.env.DB.prepare(
          "SELECT id FROM users WHERE email = ? LIMIT 1",
        )
          .bind(email)
          .first<{ id: string }>();
        if (userRow?.id) {
          userId = userRow.id;
        } else {
          userId = crypto.randomUUID();
          await c.env.DB.prepare(
            "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
            .bind(userId, "", email, 1, nowSec, nowSec)
            .run();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("POST /api/partner/verify-otp error at get/create user:", msg);
        return c.json(
          { error: "Internal server error. Please try again later.", debug: msg },
          500,
        );
      }

      const sessionId = crypto.randomUUID();
      const sessionToken = Array.from(
        crypto.getRandomValues(new Uint8Array(48)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      try {
        await c.env.DB.prepare(
          "INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(sessionId, sessionToken, userId, expiresAtSec, nowSec, nowSec)
          .run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("POST /api/partner/verify-otp error at insert session:", msg);
        return c.json(
          { error: "Internal server error. Please try again later.", debug: msg },
          500,
        );
      }

      // Sign session token (Worker-native crypto, Better Auth compatible)
      let signedToken: string;
      try {
        signedToken = await signSessionToken(
          c.env.BETTER_AUTH_SECRET,
          sessionToken,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("POST /api/partner/verify-otp error at sign:", msg);
        return c.json(
          {
            error: "Internal server error. Please try again later.",
            debug: msg,
          },
          500,
        );
      }

      const isSecure =
        (c.env.BETTER_AUTH_URL ?? "").startsWith("https");
      const cookieParts = [
        `better-auth.session_token=${signedToken}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${sessionExpiresIn}`,
      ];
      if (isSecure) cookieParts.push("Secure");
      c.header("Set-Cookie", cookieParts.join("; "));

      // Consume OTP only after session/cookie are set successfully
      await db
        .update(partnerOtps)
        .set({ consumedAt: new Date() })
        .where(eq(partnerOtps.id, otp.id));

      return c.json({ status: "ok", redirect: "/portal" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error("POST /api/partner/verify-otp error:", message, stack ?? "");
      return c.json(
        {
          error: "Internal server error. Please try again later.",
          debug: message,
        },
        500,
      );
    }
  })
  // ─── Auth middleware ────────────────────────────────────────────────────────
  .use("/api/*", async (c, next) => {
    const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    const db = drizzle(c.env.DB, { schema });
    c.set("db", db);

    if (!session) {
      // Dev fallback: if Better Auth session is missing but we have a dev-partner-user
      // cookie on localhost, treat that user as authenticated for partner APIs.
      const isLocalhost =
        (c.env.BETTER_AUTH_URL ?? "").startsWith("http://localhost");
      const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
      const match = cookieHeader.match(/dev-partner-user=([^;]+)/);
      if (isLocalhost && match) {
        const devUserId = match[1];
        try {
          const userRows = await db
            .select()
            .from(users)
            .where(eq(users.id, devUserId))
            .limit(1);
          const devUser = userRows[0];
          if (devUser) {
            c.set("user", devUser);
            c.set("session", { userId: devUser.id } as Session);
            return next();
          }
        } catch (err) {
          console.error(
            "/api/* dev auth fallback error:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      c.set("user", null);
      c.set("session", null);
      return next();
    }

    c.set("user", session.user);
    c.set("session", session.session);
    return next();
  })
  // ─── Dashboard ──────────────────────────────────────────────────────────────
  .get("/api/dashboard", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const projectId = c.req.query("project");
    const dashboardService = new DashboardService(db);
    const data = await dashboardService.getDashboardData(user.id, projectId);

    return c.json(data);
  })
  // ─── Projects ───────────────────────────────────────────────────────────────
  .get("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    // Bootstrap starter subscription on first use (e.g. first request after login)
    try {
      const subscriptionService = new SubscriptionService(db);
      await subscriptionService.getOrCreateSubscription(user.id);
    } catch {
      // Table missing or DB error: continue without subscription; POST /api/projects will still allow first project
    }

    const projectService = new ProjectService(db);
    const projectsList = await projectService.getProjectsByUserId(user.id);
    return c.json({ projects: projectsList });
  })
  .get("/api/notifications", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: user.id,
        type: "system",
        title: "Welcome to UnlockAffiliate",
        message:
          "Your notifications center is ready. Important account and billing updates will appear here.",
        href: "/app/account",
      });
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt));

    return c.json({
      notifications: rows,
      unreadCount: rows.filter((item) => !item.isRead).length,
    });
  })
  .post("/api/notifications/read-all", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.userId, user.id));

    return c.json({ success: true });
  })
  .post("/api/notifications/:id/read", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const notificationId = c.req.param("id");
    const db = c.get("db");
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, user.id),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      return c.json({ error: "Notification not found" }, 404);
    }

    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.id, notificationId));

    return c.json({ success: true });
  })
  .post("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const existingProjects = await projectService.getProjectsByUserId(user.id);

    // Plan limit: use subscription when available.
    // - If subscription exists but plan is null -> require plan selection before creating any project.
    // - If subscription lookup fails (e.g. table missing) -> allow 1 project as a safe fallback.
    let subscription: Awaited<
      ReturnType<SubscriptionService["getOrCreateSubscription"]>
    > | null = null;
    let subscriptionError = false;
    try {
      const subscriptionService = new SubscriptionService(db);
      subscription = await subscriptionService.getOrCreateSubscription(user.id);
    } catch (err) {
      subscriptionError = true;
      console.error("Subscription lookup failed (project create):", err);
    }

    // When plan is null (onboarding not finished), allow 1 project so user can complete setup; they choose plan at the end.
    const effectivePlan: BillingPlan | undefined =
      !subscriptionError && subscription?.plan
        ? (subscription.plan as BillingPlan)
        : undefined;

    const maxProjects =
      effectivePlan != null ? getMaxProjects(effectivePlan) : 1;

    if (existingProjects.length >= maxProjects) {
      return c.json(
        {
          error: "Plan limit reached",
          code: "upgrade_required",
          maxProjects,
        },
        403,
      );
    }

    const baseSlug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";

    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const existingWithSlug = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.slug, slug)))
        .limit(1);
      if (!existingWithSlug[0]) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    try {
      const project = await projectService.createProject({
        userId: user.id,
        name: parsed.data.name.trim(),
        slug,
        domain: parsed.data.domain?.trim() || null,
      });
      return c.json({ project }, 201);
    } catch (err) {
      console.error("Create project failed:", err);
      return c.json(
        { error: "Failed to create project", code: "create_failed" },
        500,
      );
    }
  })
  .patch("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updateProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const updates: { name?: string; domain?: string | null } = {};

    if (typeof parsed.data.name === "string") {
      updates.name = parsed.data.name.trim();
    }
    if (parsed.data.domain !== undefined) {
      const trimmed =
        parsed.data.domain === null ? null : parsed.data.domain.trim();
      updates.domain = trimmed ? trimmed : null;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No updates provided" }, 400);
    }

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.updateProject(id, user.id, updates);
    if (!project) return c.json({ error: "Project not found" }, 404);

    return c.json({ project });
  })
  // ─── Partners ───────────────────────────────────────────────────────────────
  .get("/api/partners", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    const statusQuery = c.req.query("status");
    const search = c.req.query("search");
    const channel = c.req.query("channel");
    const status = parsePartnerStatusFilter(statusQuery);

    const db = c.get("db");
    const partnerService = new PartnerService(db);
    let partnersList = await partnerService.getPartnersByUser(user.id, {
      projectId,
      status,
      search: search ?? undefined,
    });

    if (channel && channel !== "all") {
      partnersList = partnersList.filter((p) =>
        channel === "unset" ? !p.channel : p.channel === channel,
      );
    }

    const metrics = await partnerService.getListMetrics(
      partnersList.map((p) => p.id),
    );
    const enriched = partnersList.map((p) => ({
      ...p,
      metrics: metrics.get(p.id) ?? {
        refs: 0,
        clicks: 0,
        conv: 0,
        epc: 0,
        mrr: 0,
      },
    }));

    const stats = await partnerService.getPartnerStats(user.id, projectId);

    return c.json({ partners: enriched, stats });
  })
  .get("/api/partners/:id/detail", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const id = c.req.param("id");
    const db = c.get("db");
    const partnerService = new PartnerService(db);
    const partner = await partnerService.getPartnerById(id);
    if (!partner) return c.json({ error: "Not found" }, 404);
    // Ownership check via project
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(partner.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    const detail = await partnerService.getPartnerDetail(id);
    return c.json(detail);
  })
  .post("/api/partners", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = validate(createPartnerSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const partnerService = new PartnerService(db);
    if (parsed.data.email) {
      const existingPartner = await partnerService.getPartnerByEmail(
        parsed.data.projectId,
        parsed.data.email.trim().toLowerCase(),
      );
      if (existingPartner) {
        return c.json(
          { error: "A partner with this email already exists in this project." },
          409,
        );
      }
    }

    const partnerIp =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    const hashedPartnerIp = await hashIP(partnerIp);

    let commissionRate = parsed.data.commissionRate ?? 0.2;
    if (parsed.data.commissionProgramId) {
      const programService = new CommissionProgramService(db);
      const program = await programService.getById(
        parsed.data.projectId,
        parsed.data.commissionProgramId,
      );
      if (!program || program.archivedAt) {
        return c.json({ error: "Commission program not found" }, 400);
      }
      commissionRate = program.rate / 100;
    }

    let partner;
    try {
      partner = await partnerService.createPartner({
        projectId: parsed.data.projectId,
        name: parsed.data.name?.trim() ?? "",
        email: parsed.data.email?.trim().toLowerCase() ?? "",
        commissionRate,
        commissionProgramId: parsed.data.commissionProgramId ?? null,
        referralCode: parsed.data.referralCode,
        payoutLink: parsed.data.payoutLink?.trim() || null,
        status: "active",
        registrationIp: hashedPartnerIp,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("POST /api/partners createPartner error:", msg);
      return c.json(
        { error: "Failed to create partner. Please try again." },
        500,
      );
    }

    const webhookServicePartners = new WebhookService(db);
    await webhookServicePartners.fireEvent(parsed.data.projectId, "partner.created", {
      partnerId: partner.id,
      name: partner.name,
      email: partner.email,
      status: partner.status,
      referralCode: partner.referralCode ?? null,
    });

    if (parsed.data.email) {
      const fraudService = new FraudService(db);
      const ownerCheck = await fraudService.checkOwnerAsPartner(
        parsed.data.email.trim().toLowerCase(),
        parsed.data.projectId,
      );
      if (ownerCheck) {
        await fraudService.createFlag({
          projectId: parsed.data.projectId,
          partnerId: partner.id,
          type: ownerCheck.type,
          severity: ownerCheck.severity,
          details: ownerCheck.details,
        });
      }
    }

    const sendInvite = (body as { sendInvite?: boolean }).sendInvite !== false;
    if (sendInvite && partner.email) {
      if (!c.env.RESEND_API_KEY) {
        await db.delete(partners).where(eq(partners.id, partner.id));
        return c.json(
          {
            error:
              "Invitation email is not configured (missing RESEND_API_KEY). Partner was not created.",
          },
          500,
        );
      }
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      const baseUrl = c.env.BETTER_AUTH_URL || c.req.url.split("/api")[0];
      const sent = await emailService.sendPartnerInvitation({
        partnerName: partner.name,
        partnerEmail: partner.email,
        projectName: project.name,
        referralCode: partner.referralCode,
        baseUrl,
      });
      if (!sent) {
        await db.delete(partners).where(eq(partners.id, partner.id));
        return c.json(
          {
            error:
              "Failed to send invitation email. Please try again after checking email settings.",
          },
          500,
        );
      }
    }

    return c.json({ partner }, 201);
  })
  .patch("/api/partners/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updatePartnerSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");

    // Verify ownership: user must own the partner's project
    const partnerService = new PartnerService(db);
    const existing = await partnerService.getPartnerById(id);
    if (!existing) return c.json({ error: "Partner not found" }, 404);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(existing.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Partner not found" }, 404);
    }

    // If commissionProgramId is set, also sync commissionRate from the program
    const updates: Parameters<typeof partnerService.updatePartner>[1] = {
      ...parsed.data,
    };
    if (parsed.data.commissionProgramId) {
      const programService = new CommissionProgramService(db);
      const program = await programService.getById(
        existing.projectId,
        parsed.data.commissionProgramId,
      );
      if (program) {
        updates.commissionRate = program.rate / 100;
      }
    } else if (parsed.data.commissionProgramId === null) {
      // Explicitly clearing program — leave commissionRate alone (admin can edit it directly)
    }

    const partner = await partnerService.updatePartner(id, updates);
    if (!partner) return c.json({ error: "Partner not found" }, 404);

    if (parsed.data.status === "active" && existing.status !== "active") {
      const webhookServicePartner = new WebhookService(db);
      await webhookServicePartner.fireEvent(existing.projectId, "partner.approved", {
        partnerId: partner.id,
        name: partner.name,
        email: partner.email,
        status: partner.status,
      });
    }
    return c.json({ partner });
  })
  // ─── Customers ──────────────────────────────────────────────────────────────
  .get("/api/customers", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    const statusQuery = c.req.query("status");
    const partnerId = c.req.query("partnerId");
    const status = parseCustomerStatusFilter(statusQuery);

    const db = c.get("db");
    const customerService = new CustomerService(db);
    const customersList = await customerService.getCustomersByUser(user.id, {
      projectId,
      status,
      partnerId: partnerId ?? undefined,
    });
    const stats = await customerService.getCustomerStats(user.id, projectId);

    return c.json({ customers: customersList, stats });
  })
  .patch("/api/customers/:id/flag", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const customerId = c.req.param("id");
    const body = await c.req.json();
    const reason: string | null = body.reason ?? null;

    const db = c.get("db");

    // Verify ownership: customer must belong to one of user's projects
    const customerService = new CustomerService(db);
    const allCustomers = await customerService.getCustomersByUser(user.id, {});
    const customer = allCustomers.find((c) => c.id === customerId);
    if (!customer) {
      return c.json({ error: "Customer not found" }, 404);
    }

    const commissionService = new CommissionService(db);
    const result = await commissionService.flagCustomer(customerId, reason);

    return c.json({
      customerId,
      flagReason: reason,
      commissionsRejected: result.commissionsRejected,
    });
  })
  // Legacy endpoint - redirects to new flag endpoint
  .patch("/api/customers/:id/self-referral", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const customerId = c.req.param("id");
    const body = await c.req.json();
    const isSelfReferral = body.isSelfReferral === true;

    const db = c.get("db");

    const customerService = new CustomerService(db);
    const allCustomers = await customerService.getCustomersByUser(user.id, {});
    const customer = allCustomers.find((c) => c.id === customerId);
    if (!customer) {
      return c.json({ error: "Customer not found" }, 404);
    }

    const commissionService = new CommissionService(db);
    const result = await commissionService.flagCustomer(
      customerId,
      isSelfReferral ? "self_referral" : null,
    );

    return c.json({
      customerId,
      isSelfReferral,
      commissionsRejected: result.commissionsRejected,
    });
  })
  // ─── Analytics ──────────────────────────────────────────────────────────────
  .get("/api/analytics", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    const days = c.req.query("days");

    const db = c.get("db");
    const analyticsService = new AnalyticsService(db);
    const data = await analyticsService.getAnalytics(user.id, {
      projectId,
      days: days ? parseInt(days, 10) : undefined,
    });

    return c.json(data);
  })
  // ─── Commissions ────────────────────────────────────────────────────────────
  .get("/api/commissions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    const status = c.req.query("status");

    const db = c.get("db");
    const commissionService = new CommissionService(db);
    const commissionsList = await commissionService.getCommissionsByUser(
      user.id,
      {
        projectId,
        status,
      },
    );
    const stats = await commissionService.getCommissionStats(
      user.id,
      projectId,
    );

    return c.json({ commissions: commissionsList, stats });
  })
  .patch("/api/commissions/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updateCommissionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");

    // Verify ownership: user must own the commission's project
    const commissionService = new CommissionService(db);
    const existing = await commissionService.getCommissionsByUser(user.id, {});
    const commission = existing.find((c) => c.id === id);
    if (!commission) {
      return c.json({ error: "Commission not found" }, 404);
    }

    const transitionError = getCommissionTransitionError(
      commission,
      parsed.data.status,
    );
    if (transitionError) {
      return c.json({ error: transitionError }, 400);
    }

    if (parsed.data.status === "paid") {
      const methodError = validatePayoutMethod([commission]);
      if (methodError) return c.json({ error: methodError }, 400);
      const minimumError = validateMinimumPayout([commission]);
      if (minimumError) return c.json({ error: minimumError }, 400);
      const scheduleError = validatePayoutSchedule([commission]);
      if (scheduleError) return c.json({ error: scheduleError }, 400);
    }

    let payoutsCreated = 0;
    let updated = null;
    if (parsed.data.status === "paid") {
      try {
        const payoutResult = await createPaidPayoutRecordsFromCommissions(
          db,
          new WebhookService(db),
          [commission],
        );
        payoutsCreated = payoutResult.payoutsCreated;
        const updatedRows = await db
          .select()
          .from(commissions)
          .where(eq(commissions.id, id))
          .limit(1);
        updated = updatedRows[0] ?? null;
      } catch (err) {
        return c.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Failed to create payout record",
          },
          400,
        );
      }
    } else {
      updated = await commissionService.updateCommissionStatus(
        id,
        parsed.data.status,
        parsed.data.fraudFlag,
      );
    }

    if (parsed.data.status === "approved") {
      const webhookServiceComm = new WebhookService(db);
      await webhookServiceComm.fireEvent(commission.projectId, "commission.approved", {
        commissionId: id,
        partnerId: commission.partnerId,
        customerId: commission.customerId,
        amount: commission.amount,
      });
    }

    // When approving a commission, auto-activate the partner if they're still pending
    if (parsed.data.status === "approved") {
      const partnerService = new PartnerService(db);
      const partner = await partnerService.getPartnerById(commission.partnerId);
      if (partner && partner.status === "pending") {
        await partnerService.updatePartner(partner.id, { status: "active" });
        const webhookServicePartnerAct = new WebhookService(db);
        await webhookServicePartnerAct.fireEvent(commission.projectId, "partner.approved", {
          partnerId: partner.id,
          name: partner.name,
          email: partner.email,
          status: "active",
        });
      }
    }

    // When rejecting with a fraud reason, create a confirmed fraud flag
    if (parsed.data.status === "rejected" && parsed.data.fraudFlag) {
      const fraudService = new FraudService(db);
      await fraudService.createFlag({
        projectId: commission.projectId,
        partnerId: commission.partnerId,
        type: parsed.data.fraudFlag as "self_referral",
        severity: "high",
        status: "confirmed",
        details: {
          commissionId: id,
          partnerEmail: commission.partnerEmail,
          customerEmail: commission.customerEmail,
          amount: commission.amount,
          reason: parsed.data.fraudFlag,
        },
        relatedCommissionId: id,
      });
    }

    return c.json({ commission: updated, payoutsCreated });
  })
  .get("/api/commissions/by-partner", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");

    const db = c.get("db");
    const commissionService = new CommissionService(db);
    const result = await commissionService.getCommissionsGroupedByPartner(
      user.id,
      { projectId },
    );

    return c.json(result);
  })
  .post("/api/commissions/bulk-action", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(bulkCommissionActionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const commissionService = new CommissionService(db);

    // Verify ownership: all commission IDs must belong to user's projects
    const allCommissions = await commissionService.getCommissionsByUser(user.id, {});
    const validIds = new Set(allCommissions.map((c) => c.id));
    const requestedCommissions = allCommissions.filter(
      (commission) =>
        parsed.data.ids.includes(commission.id) &&
        validIds.has(commission.id) &&
        isCommissionEligibleForAction(commission, parsed.data.action),
    );
    const requestedIds = requestedCommissions.map((commission) => commission.id);

    if (requestedIds.length === 0) {
      return c.json({ error: "No eligible commission IDs found" }, 404);
    }

    if (parsed.data.action === "pay") {
      const methodError = validatePayoutMethod(requestedCommissions);
      if (methodError) return c.json({ error: methodError }, 400);
      const minimumError = validateMinimumPayout(requestedCommissions);
      if (minimumError) return c.json({ error: minimumError }, 400);
      const scheduleError = validatePayoutSchedule(requestedCommissions);
      if (scheduleError) return c.json({ error: scheduleError }, 400);
    }

    const statusMap = {
      approve: "approved" as const,
      pay: "paid" as const,
      reject: "rejected" as const,
    };

    let payoutsCreated = 0;
    let count = 0;
    if (parsed.data.action === "pay") {
      try {
        const payoutResult = await createPaidPayoutRecordsFromCommissions(
          db,
          new WebhookService(db),
          requestedCommissions,
        );
        payoutsCreated = payoutResult.payoutsCreated;
        count = requestedIds.length;
      } catch (err) {
        return c.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Failed to create payout records",
          },
          400,
        );
      }
    } else {
      count = await commissionService.bulkUpdateStatus(
        requestedIds,
        statusMap[parsed.data.action],
        parsed.data.fraudFlag,
      );
    }

    if (parsed.data.action === "approve") {
      const webhookServiceBulk = new WebhookService(db);
      const approvedCommissions = allCommissions.filter((c) => requestedIds.includes(c.id));
      for (const comm of approvedCommissions) {
        await webhookServiceBulk.fireEvent(comm.projectId, "commission.approved", {
          commissionId: comm.id,
          partnerId: comm.partnerId,
          customerId: comm.customerId,
          amount: comm.amount,
        });
      }
      const partnerService = new PartnerService(db);
      const partnerIds = [...new Set(approvedCommissions.map((c) => c.partnerId))];
      for (const partnerId of partnerIds) {
        const partner = await partnerService.getPartnerById(partnerId);
        if (partner && partner.status === "pending") {
          await partnerService.updatePartner(partner.id, { status: "active" });
          await webhookServiceBulk.fireEvent(partner.projectId, "partner.approved", {
            partnerId: partner.id,
            name: partner.name,
            email: partner.email,
            status: "active",
          });
        }
      }
    }

    return c.json({ updated: count, payoutsCreated });
  })
  // ─── Fraud Flags ────────────────────────────────────────────────────────────
  .get("/api/fraud-flags", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    if (!projectId)
      return c.json({ error: "project query param required" }, 400);

    // Verify user owns the project
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const fraudService = new FraudService(db);
    const flags = await fraudService.getFlagsByProject(projectId, {
      status: c.req.query("status"),
      type: c.req.query("type"),
      severity: c.req.query("severity"),
    });
    const stats = await fraudService.getFlagStats(projectId);

    return c.json({ flags, stats });
  })
  .patch("/api/fraud-flags/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const flagId = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updateFraudFlagSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const fraudService = new FraudService(db);

    // Verify ownership: flag must belong to a project the user owns
    const flag = await fraudService.getFlagById(flagId);
    if (!flag) return c.json({ error: "Flag not found" }, 404);

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(flag.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Flag not found" }, 404);
    }

    const updated = await fraudService.updateFlagStatus(
      flagId,
      parsed.data.status,
    );
    return c.json({ flag: updated });
  })
  // ─── API Keys ───────────────────────────────────────────────────────────────
  .get("/api/api-keys", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    if (!projectId)
      return c.json({ error: "project query param required" }, 400);

    // Verify ownership
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const apiKeyService = new ApiKeyService(db);
    const keys = await apiKeyService.listByProject(projectId);

    // Strip keyHash from response
    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        prefix: k.prefix,
        name: k.name,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })),
    });
  })
  .post("/api/api-keys", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createApiKeySchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Verify ownership
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const apiKeyService = new ApiKeyService(db);
    const { key, row } = await apiKeyService.generateKey(
      parsed.data.projectId,
      parsed.data.name,
    );

    // Return the full key only once
    return c.json(
      {
        key, // plaintext, shown once
        id: row.id,
        prefix: row.prefix,
        name: row.name,
        createdAt: row.createdAt,
      },
      201,
    );
  })
  .delete("/api/api-keys/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");

    // We need to verify the key belongs to a project the user owns
    const apiKeyService = new ApiKeyService(db);
    const allUserProjects = await new ProjectService(db).getProjectsByUserId(
      user.id,
    );

    // Search all user's projects to find this key
    let found = false;
    for (const proj of allUserProjects) {
      const projectKeys = await apiKeyService.listByProject(proj.id);
      if (projectKeys.some((k) => k.id === id)) {
        found = true;
        break;
      }
    }

    if (!found) return c.json({ error: "API key not found" }, 404);

    await apiKeyService.revoke(id);
    return c.json({ success: true });
  })
  // ─── Stripe Integration ─────────────────────────────────────────────────────
  .get("/api/projects/:id/stripe", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(projectId);

    if (!conn) {
      return c.json({ connected: false });
    }

    const mappings = await stripeService.getMetadataMappings(projectId);
    const lastSyncSummary = await stripeService.getLastSyncSummary(projectId);

    return c.json({
      connected: true,
      lastSyncAt: conn.lastSyncAt,
      syncStatus: conn.syncStatus,
      syncError: conn.syncError,
      createdAt: conn.createdAt,
      metadataMappings: mappings,
      lastSyncSummary,
    });
  })
  .post("/api/projects/:id/stripe", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(connectStripeSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );

    // Validate the key with Stripe
    const isValid = await stripeService.validateStripeKey(parsed.data.apiKey);
    if (!isValid) {
      return c.json({ error: "Invalid Stripe API key" }, 400);
    }

    await stripeService.saveConnection(projectId, parsed.data.apiKey);
    return c.json({ connected: true }, 201);
  })
  .delete("/api/projects/:id/stripe", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    await stripeService.removeConnection(projectId);
    return c.json({ success: true });
  })
  .post("/api/projects/:id/stripe/sync", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected" }, 400);
    }

    // Concurrency guard: prevent multiple syncs running simultaneously
    if (conn.syncStatus === "syncing") {
      return c.json({ error: "Sync already in progress" }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    const fullResync = (body as { fullResync?: boolean })?.fullResync === true;

    const syncService = new StripeSyncService(db, stripeService);
    const result = await syncService.syncProject(projectId, { fullResync });

    // Persist the summary so it survives navigation
    await stripeService.updateLastSyncSummary(projectId, result);

    if (result.error) {
      return c.json(result, 500);
    }

    return c.json(result);
  })
  // ─── Payments ──────────────────────────────────────────────────────────────
  // Live-pull list. Stripe rows come from the API on every request; CSV rows
  // are still served from the DB via a separate endpoint below.
  .get("/api/projects/:id/payments", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const kind = c.req.query("kind") as LiveKind | undefined;
    if (kind !== "subscription" && kind !== "one_time") {
      return c.json(
        { error: "kind query param required: subscription | one_time" },
        400,
      );
    }
    const limit = Math.min(
      Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
      100,
    );
    const cursor = c.req.query("cursor") || undefined;
    const query = c.req.query("query") || undefined;
    const assignedParam = c.req.query("assigned");
    const assigned: LiveAssignedFilter =
      assignedParam === "assigned" || assignedParam === "unassigned"
        ? assignedParam
        : "all";

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) {
      return c.json({ error: "Stripe not connected for this project" }, 412);
    }

    const mappings = await stripeService.getMetadataMappings(projectId);
    const liveService = new PaymentLiveService(db);
    try {
      const opts = {
        limit,
        cursor,
        query,
        referralCodeKeys: mappings.referralCodeKeys,
      };
      const result =
        kind === "subscription"
          ? await liveService.listSubscriptions(apiKey, projectId, opts, assigned)
          : await liveService.listOneTimeCharges(apiKey, projectId, opts, assigned);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "List failed";
      return c.json({ error: msg }, 500);
    }
  })
  // CSV-source ledger rows (kept separate from Stripe live-pull).
  .get("/api/projects/:id/payments/csv", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const paymentService = new PaymentService(db);
    const result = await paymentService.list(projectId, {
      assigned: (c.req.query("assigned") as AssignedFilter) ?? undefined,
      source: "csv" satisfies SourceFilter,
      search: c.req.query("search") ?? undefined,
    });
    return c.json(result);
  })
  .post("/api/projects/:id/payments/assign", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      source?: string;
      externalPaymentId?: string;
      kind?: "subscription" | "one_time";
      partnerId?: string;
      customerEmail?: string | null;
      customerName?: string | null;
      planName?: string | null;
      mrr?: number | null;
      startedAt?: number | null;
      status?: string | null;
      subscriptionAnchorAt?: number | null;
    };
    if (
      !body.externalPaymentId ||
      !body.kind ||
      !body.partnerId ||
      body.source !== "stripe"
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Verify partner belongs to this project; resolve commission program.
    const partnerRows = await db
      .select()
      .from(partners)
      .where(
        and(eq(partners.id, body.partnerId), eq(partners.projectId, projectId)),
      )
      .limit(1);
    const partner = partnerRows[0];
    if (!partner) return c.json({ error: "Partner not found" }, 404);

    const programService = new CommissionProgramService(db);
    let programId =
      partner.commissionProgramId ?? null;
    if (!programId) {
      const brandingService = new BrandingService(db);
      const branding = await brandingService.getByProjectId(projectId);
      programId = branding?.defaultCommissionProgramId ?? null;
    }
    const program = programId
      ? await programService.getById(projectId, programId)
      : null;

    // commissionPrograms.rate is stored as percent (e.g. 30 for 30%); the
    // partners.commissionRate fallback is stored as a decimal (0.2). Normalize
    // to decimal for the snapshot so approve/deny math is consistent.
    const rate = program ? program.rate / 100 : partner.commissionRate;

    const paymentService = new PaymentService(db);
    const result = await paymentService.upsertFromExternal({
      projectId,
      source: "stripe",
      externalPaymentId: body.externalPaymentId,
      kind: body.kind,
      customerEmail: body.customerEmail ?? null,
      customerName: body.customerName ?? null,
      planName: body.planName ?? null,
      mrr: body.mrr ?? null,
      startedAt: body.startedAt ? new Date(body.startedAt * 1000) : null,
      status: body.status ?? null,
      partnerId: body.partnerId,
      commissionProgramId: program?.id ?? null,
      programType:
        (program?.type as "recurring" | "lifetime" | "one-time" | null) ?? null,
      durationMonths: program?.durationMonths ?? null,
      rate,
      flatAmount: program?.flatAmount ?? null,
      subscriptionAnchorAt: body.subscriptionAnchorAt
        ? new Date(body.subscriptionAnchorAt * 1000)
        : null,
    });
    return c.json({ payment: result.row });
  })
  .post("/api/projects/:id/payments/unassign", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      externalPaymentId?: string;
    };
    if (!body.externalPaymentId) {
      return c.json({ error: "externalPaymentId required" }, 400);
    }
    const paymentService = new PaymentService(db);
    await paymentService.deleteByExternalId(
      projectId,
      "stripe",
      body.externalPaymentId,
    );
    return c.json({ ok: true });
  })
  // CSV row deletion stays on its own endpoint (keyed by internal id).
  .delete("/api/payments/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const id = c.req.param("id");
    const db = c.get("db");
    const paymentService = new PaymentService(db);
    const existing = await paymentService.getById(id);
    if (!existing) return c.json({ ok: true });
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(existing.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }
    await paymentService.delete(id);
    return c.json({ ok: true });
  })
  // ─── Pending payouts (derived live; nothing persisted until approve/deny) ──
  .get("/api/projects/:id/payouts/pending", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) {
      return c.json({ error: "Stripe not connected for this project" }, 412);
    }

    // 1. All Stripe assignments for this project.
    const assignments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.projectId, projectId),
          eq(payments.source, "stripe"),
          isNotNull(payments.partnerId),
        ),
      );

    // 2. All commissions for this project, indexed by externalEventId so we
    //    can exclude already-actioned events.
    const existingCommissions = await db
      .select({ eventId: commissions.externalEventId })
      .from(commissions)
      .where(eq(commissions.projectId, projectId));
    const actionedEventIds = new Set(
      existingCommissions
        .map((r) => r.eventId)
        .filter((id): id is string => !!id),
    );

    // 3. Partner names for display.
    const partnerIds = [...new Set(assignments.map((a) => a.partnerId!))];
    const partnerRows = partnerIds.length
      ? await db
          .select({
            id: partners.id,
            name: partners.name,
            email: partners.email,
          })
          .from(partners)
          .where(inArray(partners.id, partnerIds))
      : [];
    const partnerMap = new Map(partnerRows.map((p) => [p.id, p]));

    // 4. Program names for display (for assignments where snapshot has a
    //    programId).
    const programIds = [
      ...new Set(
        assignments
          .map((a) => a.commissionProgramId)
          .filter((id): id is string => !!id),
      ),
    ];
    const programRows = programIds.length
      ? await db
          .select({
            id: commissionPrograms.id,
            name: commissionPrograms.name,
          })
          .from(commissionPrograms)
          .where(inArray(commissionPrograms.id, programIds))
      : [];
    const programMap = new Map(programRows.map((p) => [p.id, p]));

    const liveService = new PaymentLiveService(db);

    // Derive in parallel — N concurrent Stripe calls for N subscription
    // assignments. Acceptable at MVP scale.
    const derivedRows = await Promise.all(
      assignments.map(async (a) => {
        const partner = partnerMap.get(a.partnerId!);
        const programName =
          a.commissionProgramId && programMap.has(a.commissionProgramId)
            ? programMap.get(a.commissionProgramId)!.name
            : "Default";
        const rate = a.rate ?? 0;
        const programType = a.programType ?? "recurring";
        const flatAmount = a.flatAmount ?? null;

        if (a.kind === "one_time") {
          if (actionedEventIds.has(a.externalPaymentId)) return [];
          const revenue = a.mrr ?? 0;
          const commissionAmount = calculateDerivedCommissionAmount({
            revenue,
            rate,
            programType,
            flatAmount,
          });
          return [
            {
              paymentId: a.id,
              partnerId: a.partnerId!,
              partnerName: partner?.name ?? "Unknown",
              partnerEmail: partner?.email ?? "",
              customerEmail: a.customerEmail,
              customerName: a.customerName,
              source: "stripe" as const,
              kind: "one_time" as const,
              eventId: a.externalPaymentId,
              eventDate: a.startedAt
                ? Math.floor(a.startedAt.getTime() / 1000)
                : Math.floor(Date.now() / 1000),
              revenue,
              mrr: a.mrr,
              rate,
              flatAmount,
              commissionAmount,
              programType,
              programName,
              monthIndex: null,
              durationMonths: null,
              monthsRemaining: null,
              isFinalMonth: false,
            },
          ];
        }

        // kind === "subscription"
        const invoices = await liveService.listPaidInvoicesForSubscription(
          apiKey,
          a.externalPaymentId,
        );
        const anchorSec = a.subscriptionAnchorAt
          ? Math.floor(a.subscriptionAnchorAt.getTime() / 1000)
          : a.startedAt
            ? Math.floor(a.startedAt.getTime() / 1000)
            : null;

        if (programType === "one-time") {
          // Only the earliest paid invoice counts; ignore the rest.
          const earliest = invoices
            .slice()
            .sort((x, y) => x.created - y.created)[0];
          if (!earliest || actionedEventIds.has(earliest.id)) return [];
          const revenue = earliest.amount_paid / 100;
          const commissionAmount = calculateDerivedCommissionAmount({
            revenue,
            rate,
            programType,
            flatAmount,
          });
          return [
            {
              paymentId: a.id,
              partnerId: a.partnerId!,
              partnerName: partner?.name ?? "Unknown",
              partnerEmail: partner?.email ?? "",
              customerEmail: a.customerEmail,
              customerName: a.customerName,
              source: "stripe" as const,
              kind: "subscription" as const,
              subscriptionId: a.externalPaymentId,
              eventId: earliest.id,
              eventDate: earliest.created,
              revenue,
              mrr: a.mrr,
              rate,
              flatAmount,
              commissionAmount,
              programType,
              programName,
              monthIndex: null,
              durationMonths: null,
              monthsRemaining: null,
              isFinalMonth: false,
            },
          ];
        }

        // Recurring or lifetime: every paid invoice (capped for recurring).
        const rows = [];
        for (const inv of invoices) {
          if (actionedEventIds.has(inv.id)) continue;
          const monthIndex = anchorSec
            ? monthIndexFromAnchor(inv.created, anchorSec)
            : 1;
          if (
            programType === "recurring" &&
            a.durationMonths != null &&
            monthIndex > a.durationMonths
          ) {
            continue;
          }
          const revenue = inv.amount_paid / 100;
          const commissionAmount = calculateDerivedCommissionAmount({
            revenue,
            rate,
            programType,
            flatAmount,
          });
          const monthsRemaining =
            programType === "recurring" && a.durationMonths != null
              ? Math.max(0, a.durationMonths - monthIndex)
              : null;
          rows.push({
            paymentId: a.id,
            partnerId: a.partnerId!,
            partnerName: partner?.name ?? "Unknown",
            partnerEmail: partner?.email ?? "",
            customerEmail: a.customerEmail,
            customerName: a.customerName,
            source: "stripe" as const,
            kind: "subscription" as const,
            subscriptionId: a.externalPaymentId,
            eventId: inv.id,
            eventDate: inv.created,
            revenue,
            mrr: a.mrr,
            rate,
            flatAmount,
            commissionAmount,
            programType,
            programName,
            monthIndex: programType === "recurring" ? monthIndex : null,
            durationMonths:
              programType === "recurring" ? a.durationMonths : null,
            monthsRemaining,
            isFinalMonth:
              programType === "recurring" &&
              a.durationMonths != null &&
              monthIndex === a.durationMonths,
          });
        }
        return rows;
      }),
    );

    return c.json({ data: derivedRows.flat() });
  })
  .post("/api/projects/:id/payouts/approve", async (c) => {
    return await actionPendingPayout(c, "approved");
  })
  .post("/api/projects/:id/payouts/deny", async (c) => {
    return await actionPendingPayout(c, "rejected");
  })
  // ─── Stripe Metadata Mappings ───────────────────────────────────────────────
  .get("/api/projects/:id/stripe/mappings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    const mappings = await stripeService.getMetadataMappings(projectId);
    return c.json({ mappings });
  })
  .put("/api/projects/:id/stripe/mappings", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const stripeService = new StripeService(
      db,
      c.env.ENCRYPTION_KEY ?? "",
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected" }, 400);
    }

    const body = await c.req.json();
    const parsed = validate(updateMetadataMappingsSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    await stripeService.updateMetadataMappings(projectId, parsed.data);
    return c.json({ mappings: parsed.data });
  })
  // ─── Stripe Customer Browsing ─────────────────────────────────────────────────
  .get("/api/projects/:id/stripe/customers", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected" }, 400);
    }

    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) {
      return c.json({ error: "Stripe API key not found" }, 500);
    }

    const params = validate(stripeCustomerSearchSchema, {
      query: c.req.query("query"),
      filter: c.req.query("filter") ?? "recent",
      limit: c.req.query("limit") ?? "20",
      starting_after: c.req.query("starting_after"),
    });
    if (!params.success) return c.json({ error: params.error }, 400);

    const mappings = await stripeService.getMetadataMappings(projectId);
    const syncService = new StripeSyncService(db, stripeService);

    if (params.data.query) {
      const result = await syncService.searchStripeCustomers(
        apiKey,
        params.data.query,
        mappings.referralCodeKeys,
        params.data.limit,
      );
      return c.json(result);
    }

    const result = await syncService.listDefaultCustomers(
      apiKey,
      params.data.filter,
      params.data.limit,
      params.data.starting_after,
    );
    return c.json(result);
  })
  .post("/api/projects/:id/stripe/assign-partner", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(assignPartnerToCustomersSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Verify partner belongs to project
    const partnerService = new PartnerService(db);
    const partner = await partnerService.getPartnerById(parsed.data.partnerId);
    if (!partner || partner.projectId !== projectId) {
      return c.json({ error: "Partner not found in this project" }, 404);
    }

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );
    const apiKey = await stripeService.getDecryptedKey(projectId);
    if (!apiKey) {
      return c.json({ error: "Stripe API key not found" }, 500);
    }

    const syncService = new StripeSyncService(db, stripeService);

    let totalCommissionsCreated = 0;
    let totalDuplicatesSkipped = 0;
    let totalProgramRulesSkipped = 0;

    for (const customerId of parsed.data.stripeCustomerIds) {
      const result = await syncService.syncCustomerHistory(
        apiKey,
        projectId,
        parsed.data.partnerId,
        customerId,
      );
      totalCommissionsCreated += result.commissionsCreated;
      totalDuplicatesSkipped += result.duplicatesSkipped;
      totalProgramRulesSkipped += result.programRulesSkipped;
    }

    return c.json({
      customersProcessed: parsed.data.stripeCustomerIds.length,
      commissionsCreated: totalCommissionsCreated,
      duplicatesSkipped: totalDuplicatesSkipped,
      programRulesSkipped: totalProgramRulesSkipped,
    });
  })
  // ─── Import ─────────────────────────────────────────────────────────────────
  .post("/api/import/csv", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(csvImportSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const importService = new ImportService(db);
    const result = await importService.importFromCsv(
      parsed.data.projectId,
      {
        partners: parsed.data.partners,
        customers: parsed.data.customers,
        commissions: parsed.data.commissions,
      },
      parsed.data.options ?? {},
    );

    return c.json(result);
  })
  .post("/api/import/stripe-preview", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(stripeImportPreviewSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(parsed.data.projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected for this project" }, 400);
    }

    const importService = new ImportService(db);
    const preview = await importService.previewStripeImport(
      parsed.data.projectId,
      stripeService,
      parsed.data.filters ?? {},
    );

    return c.json(preview);
  })
  .post("/api/import/stripe-execute", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(stripeImportExecuteSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: "Encryption not configured" }, 500);
    }

    const stripeService = new StripeService(
      db,
      encryptionKey,
      c.env.SALT ?? "",
    );
    const conn = await stripeService.getConnection(parsed.data.projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected for this project" }, 400);
    }

    const importService = new ImportService(db);
    const result = await importService.executeStripeImport(
      parsed.data.projectId,
      stripeService,
      parsed.data.assignments,
      parsed.data.filters ?? {},
    );

    return c.json(result);
  })
  // ─── Branding ──────────────────────────────────────────────────────────────
  .get("/api/projects/:id/branding", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const brandingService = new BrandingService(db);
    const branding = await brandingService.getByProjectId(projectId);

    // Return defaults if no branding exists yet (portalName from column when migration 0015 applied, else null)
    const baseUrl = c.req.url.split("/api")[0];
    const brandingRow = branding as Record<string, unknown> | null;
    return c.json({
      branding: branding
        ? {
            ...branding,
            portalName: brandingRow?.portalName ?? null,
            logo: branding.logo
              ? `${baseUrl}/api/uploads/${branding.logo}`
              : null,
            backgroundImage: branding.backgroundImage
              ? `${baseUrl}/api/uploads/${branding.backgroundImage}`
              : null,
            socialProofAvatars: (branding.socialProofAvatars ?? []).map((a) => ({
              image: a.image
                ? a.image.startsWith("http")
                  ? a.image
                  : `${baseUrl}/api/uploads/${a.image}`
                : null,
              initials: a.initials,
            })),
          }
        : null,
      // Use the same origin as the current request for joinUrl; APP_BASE_URL can
      // still be used by other parts of the system if needed.
      joinUrl: `${baseUrl}/join/${project.slug}`,
    });
  })
  .put("/api/projects/:id/branding", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = validate(updateBrandingSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    if (parsed.data.defaultCommissionProgramId) {
      const programService = new CommissionProgramService(db);
      const program = await programService.getById(
        projectId,
        parsed.data.defaultCommissionProgramId,
      );
      if (!program || program.archivedAt) {
        return c.json({ error: "Default commission program not found" }, 400);
      }
    }

    // Omit portalName so DB layer does not require portal_name column (optional until migration 0015)
    const brandingData = { ...parsed.data };
    delete brandingData.portalName;
    const brandingService = new BrandingService(db);
    const branding = await brandingService.upsert(projectId, brandingData);

    const baseUrl = c.req.url.split("/api")[0];
    return c.json({
      branding: {
        ...branding,
        logo: branding.logo ? `${baseUrl}/api/uploads/${branding.logo}` : null,
        backgroundImage: branding.backgroundImage
          ? `${baseUrl}/api/uploads/${branding.backgroundImage}`
          : null,
        socialProofAvatars: (branding.socialProofAvatars ?? []).map((a) => ({
          image: a.image
            ? a.image.startsWith("http")
              ? a.image
              : `${baseUrl}/api/uploads/${a.image}`
            : null,
          initials: a.initials,
        })),
      },
      joinUrl: `${baseUrl}/join/${project.slug}`,
    });
  })
  // ─── Commission Programs ─────────────────────────────────────────────────
  .get("/api/projects/:id/commission-programs", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const service = new CommissionProgramService(db);
    const programs = await service.list(projectId);
    return c.json({ programs });
  })
  .post("/api/projects/:id/commission-programs", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const body = await c.req.json();
    const parsed = validate(createCommissionProgramSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const service = new CommissionProgramService(db);
    try {
      const program = await service.create(projectId, parsed.data);
      return c.json({ program }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create";
      return c.json({ error: msg }, 400);
    }
  })
  .patch("/api/projects/:id/commission-programs/:programId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const programId = c.req.param("programId");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const service = new CommissionProgramService(db);
    const existing = await service.getById(projectId, programId);
    if (!existing) return c.json({ error: "Program not found" }, 404);
    if (existing.archivedAt) {
      return c.json({ error: "Archived programs cannot be edited" }, 400);
    }

    const body = await c.req.json();
    const mergedProgram = {
      code: body.code ?? existing.code,
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      rate: body.rate ?? existing.rate,
      durationMonths:
        body.durationMonths !== undefined
          ? body.durationMonths
          : existing.durationMonths,
      flatAmount:
        body.flatAmount !== undefined ? body.flatAmount : existing.flatAmount,
      description:
        body.description !== undefined ? body.description : existing.description,
      minPayout:
        body.minPayout !== undefined ? body.minPayout : existing.minPayout,
      isDefault:
        body.isDefault !== undefined ? body.isDefault : existing.isDefault,
      payoutCadence:
        body.payoutCadence !== undefined
          ? body.payoutCadence
          : existing.payoutCadence,
      payoutDayOfMonth:
        body.payoutDayOfMonth !== undefined
          ? body.payoutDayOfMonth
          : existing.payoutDayOfMonth,
      payoutDayOfWeek:
        body.payoutDayOfWeek !== undefined
          ? body.payoutDayOfWeek
          : existing.payoutDayOfWeek,
      payoutOrdinal:
        body.payoutOrdinal !== undefined
          ? body.payoutOrdinal
          : existing.payoutOrdinal,
    };
    const parsed = validate(createCommissionProgramSchema, mergedProgram);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const program = await service.update(projectId, programId, parsed.data);
    if (!program) return c.json({ error: "Program not found" }, 404);
    return c.json({ program });
  })
  .delete("/api/projects/:id/commission-programs/:programId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const programId = c.req.param("programId");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const service = new CommissionProgramService(db);
    await service.archive(projectId, programId);
    const brandingService = new BrandingService(db);
    const branding = await brandingService.getByProjectId(projectId);
    const defaultCleared =
      branding?.defaultCommissionProgramId === programId;
    if (defaultCleared) {
      await brandingService.upsert(projectId, {
        defaultCommissionProgramId: null,
      });
    }
    return c.json({ ok: true, defaultCleared });
  })
  // ─── Coupons ─────────────────────────────────────────────────────────────
  .get("/api/projects/:id/coupons", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const service = new CouponService(db);
    const couponList = await service.list(projectId);
    return c.json({ coupons: couponList });
  })
  .post("/api/projects/:id/coupons", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const body = (await c.req.json()) as {
      code: string;
      partnerId: string;
      commissionProgramId?: string | null;
      customerDiscount?: string | null;
      stripeCoupon?: string | null;
    };
    if (!body.code || !body.partnerId) {
      return c.json({ error: "code and partnerId are required" }, 400);
    }
    const service = new CouponService(db);
    try {
      const coupon = await service.create(projectId, body);
      return c.json({ coupon }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create";
      return c.json({ error: msg }, 400);
    }
  })
  .delete("/api/projects/:id/coupons/:couponId", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const projectId = c.req.param("id");
    const couponId = c.req.param("couponId");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }
    const service = new CouponService(db);
    await service.delete(projectId, couponId);
    return c.json({ ok: true });
  })
  // ─── Image Upload ──────────────────────────────────────────────────────────
  .post("/api/upload", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(file.type)) {
      return c.json(
        { error: "Only JPEG, PNG, WebP, and SVG images are allowed" },
        400,
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: "File must be under 5MB" }, 400);
    }

    const ext = file.name.split(".").pop() ?? "bin";
    const key = `${user.id}/${crypto.randomUUID()}.${ext}`;

    await c.env.UPLOADS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    const baseUrl = c.req.url.split("/api")[0];
    return c.json({ key, url: `${baseUrl}/api/uploads/${key}` }, 201);
  })
  // ─── Delete endpoints ───────────────────────────────────────────────────────
  .delete("/api/projects/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const deleted = await projectService.deleteProject(id, user.id);

    if (!deleted) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ success: true });
  })
  .delete("/api/partners/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");

    // Verify user owns the partner's project
    const partnerService = new PartnerService(db);
    const partner = await partnerService.getPartnerById(id);
    if (!partner) {
      return c.json({ error: "Partner not found" }, 404);
    }

    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(partner.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Partner not found" }, 404);
    }

    await db.delete(partners).where(eq(partners.id, id));
    return c.json({ success: true });
  })
  // ─── Admin Payouts ──────────────────────────────────────────────────────────
  .get("/api/payouts", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    const status = c.req.query("status");

    const db = c.get("db");
    const payoutService = new PayoutService(db);
    const payoutsList = await payoutService.getPayoutsByUser(user.id, {
      projectId,
      status,
    });
    const stats = await payoutService.getPayoutStats(user.id, projectId);

    return c.json({ payouts: payoutsList, stats });
  })
  .post("/api/payouts", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createPayoutSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Verify user owns the project
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Verify partner belongs to the project
    const partnerService = new PartnerService(db);
    const partner = await partnerService.getPartnerById(parsed.data.partnerId);
    if (!partner || partner.projectId !== parsed.data.projectId) {
      return c.json({ error: "Partner not found" }, 404);
    }

    const payoutService = new PayoutService(db);
    const payout = await payoutService.createPayout({
      projectId: parsed.data.projectId,
      partnerId: parsed.data.partnerId,
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? "USD",
      note: parsed.data.note ?? null,
      periodStart: parsed.data.periodStart
        ? new Date(parsed.data.periodStart)
        : null,
      periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null,
      status: "scheduled",
    });

    const webhookServicePayout = new WebhookService(db);
    await webhookServicePayout.fireEvent(parsed.data.projectId, "payout.created", {
      payoutId: payout.id,
      projectId: payout.projectId,
      partnerId: payout.partnerId,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
    });

    return c.json({ payout }, 201);
  })
  .patch("/api/payouts/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updatePayoutSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const payoutService = new PayoutService(db);
    const existing = await payoutService.getPayoutById(id);
    if (!existing) return c.json({ error: "Payout not found" }, 404);

    // Verify ownership
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(existing.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Payout not found" }, 404);
    }

    const paidAt = parsed.data.status === "paid" ? new Date() : undefined;
    const payout = await payoutService.updatePayoutStatus(
      id,
      parsed.data.status,
      paidAt,
    );
    const linkedCommissionIds = await payoutService.getLinkedCommissionIds(id);
    if (linkedCommissionIds.length > 0) {
      const commissionService = new CommissionService(db);
      await commissionService.bulkUpdateStatus(
        linkedCommissionIds,
        parsed.data.status === "paid" ? "paid" : "approved",
      );
    }
    if (payout) {
      const event =
        parsed.data.status === "paid"
          ? "payout.paid"
          : parsed.data.status === "failed"
            ? "payout.failed"
            : "payout.updated";
      const webhookServicePayoutUpdate = new WebhookService(db);
      await webhookServicePayoutUpdate.fireEvent(existing.projectId, event, {
        payoutId: payout.id,
        projectId: payout.projectId,
        partnerId: payout.partnerId,
        amount: payout.amount,
        currency: payout.currency,
        previousStatus: existing.status,
        status: payout.status,
        paidAt: payout.paidAt?.toISOString() ?? null,
      });
    }
    return c.json({ payout });
  })
  // ─── Partner Portal API (partner-facing, auth via session) ──────────────────
  .get("/api/partner/dashboard", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);

    // Link user to partner records if not already linked
    await dashboardService.linkUserToPartners(user.id, user.email);

    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ error: "No partner account found for this email" }, 404);
    }

    const partnerIds = partnerRecords.map((p) => p.id);
    const stats = await dashboardService.getDashboardData(partnerIds);
    const effectivePrograms =
      await dashboardService.getEffectiveCommissionPrograms(partnerRecords);

    // Return first partner's info as primary (partner may span multiple projects)
    const primary = partnerRecords[0];
    const primaryProgram = effectivePrograms.get(primary.id);
    return c.json({
      partner: {
        name: primary.name,
        email: primary.email,
        referralCode: primary.referralCode,
        commissionRate: primary.commissionRate,
        status: primary.status,
        payoutLink: primary.payoutLink,
        commissionProgram: primaryProgram?.commissionProgram ?? null,
        usesDefaultCommissionProgram:
          primaryProgram?.usesDefaultCommissionProgram ?? false,
        defaultCommissionProgramId:
          primaryProgram?.defaultCommissionProgramId ?? null,
      },
      programs: partnerRecords.map((p) => ({
        id: p.id,
        projectId: p.projectId,
        referralCode: p.referralCode,
        commissionRate: p.commissionRate,
        status: p.status,
        commissionProgram:
          effectivePrograms.get(p.id)?.commissionProgram ?? null,
        usesDefaultCommissionProgram:
          effectivePrograms.get(p.id)?.usesDefaultCommissionProgram ?? false,
        defaultCommissionProgramId:
          effectivePrograms.get(p.id)?.defaultCommissionProgramId ?? null,
      })),
      stats,
    });
  })
  .get("/api/partner/portal-branding", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);
    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ portalName: null, logo: null, brandColor: "#7c3aed" });
    }

    const firstProjectId = partnerRecords[0].projectId;
    const brandingService = new BrandingService(db);
    const branding = await brandingService.getByProjectId(firstProjectId);
    const baseUrl = c.req.url.split("/api")[0];

    const brandingObj = branding as Record<string, unknown> | null;
    return c.json({
      portalName: brandingObj?.portalName ?? null,
      logo: branding?.logo ? `${baseUrl}/api/uploads/${branding.logo}` : null,
      brandColor: branding?.brandColor ?? "#7c3aed",
    });
  })
  .get("/api/partner/referrals", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);
    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ error: "No partner account found" }, 404);
    }

    const partnerIds = partnerRecords.map((p) => p.id);
    let referrals = await dashboardService.getReferredCustomers(partnerIds);

    // Enrich with Stripe status if encryption key is available
    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (encryptionKey) {
      referrals = await dashboardService.enrichCustomersWithStripeStatus(
        referrals,
        partnerIds,
        encryptionKey,
        c.env.SALT ?? "",
      );
    }

    return c.json({ referrals });
  })
  .get("/api/partner/commissions", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);
    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ error: "No partner account found" }, 404);
    }

    const partnerIds = partnerRecords.map((p) => p.id);
    const commissionsList = await dashboardService.getCommissions(partnerIds);

    return c.json({ commissions: commissionsList });
  })
  .get("/api/partner/payouts", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);
    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ error: "No partner account found" }, 404);
    }

    const partnerIds = partnerRecords.map((p) => p.id);
    const payoutsList = await dashboardService.getPayouts(partnerIds);

    return c.json({ payouts: payoutsList });
  })
  .patch("/api/partner/payout-link", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(updatePartnerPayoutLinkSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);
    const payoutLink = parsed.data.payoutLink?.trim() || null;

    const db = c.get("db");
    const dashboardService = new PartnerDashboardService(db);
    const partnerRecords = await dashboardService.getPartnersByUserId(user.id);
    if (partnerRecords.length === 0) {
      return c.json({ error: "No partner account found" }, 404);
    }

    // Update payout link on all partner records for this user
    const partnerService = new PartnerService(db);
    for (const record of partnerRecords) {
      await partnerService.updatePartner(record.id, {
        payoutLink,
      });
    }

    return c.json({ payoutLink });
  })
  // ─── Webhooks ──────────────────────────────────────────────────────────────────
  .get("/api/webhooks", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("projectId")?.trim();
    if (!projectId) return c.json({ error: "projectId is required" }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const webhookService = new WebhookService(db);
    const endpoints = await webhookService.getEndpointsByProjectId(projectId);
    return c.json({ endpoints });
  })
  .post("/api/webhooks", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createWebhookEndpointSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const webhookService = new WebhookService(db);
    const endpoint = await webhookService.createEndpoint({
      projectId: parsed.data.projectId,
      url: parsed.data.url,
      events: parsed.data.events,
    });
    return c.json({ endpoint }, 201);
  })
  .patch("/api/webhooks/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = validate(updateWebhookEndpointSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const webhookService = new WebhookService(db);
    const projectService = new ProjectService(db);
    const endpoint = await webhookService.getEndpointById(id);
    if (!endpoint) return c.json({ error: "Endpoint not found" }, 404);
    const project = await projectService.getProjectById(endpoint.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const updated = await webhookService.updateEndpoint(id, {
      url: parsed.data.url,
      events: parsed.data.events,
      isActive: parsed.data.isActive,
    });
    return c.json({ endpoint: updated });
  })
  .delete("/api/webhooks/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");
    const webhookService = new WebhookService(db);
    const projectService = new ProjectService(db);
    const endpoint = await webhookService.getEndpointById(id);
    if (!endpoint) return c.json({ error: "Endpoint not found" }, 404);
    const project = await projectService.getProjectById(endpoint.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    await webhookService.deleteEndpoint(id);
    return c.json({ ok: true });
  })
  .post("/api/webhooks/:id/test", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");
    const webhookService = new WebhookService(db);
    const projectService = new ProjectService(db);
    const endpoint = await webhookService.getEndpointById(id);
    if (!endpoint) return c.json({ error: "Endpoint not found" }, 404);
    const project = await projectService.getProjectById(endpoint.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const result = await webhookService.sendTestWebhook(id);
    return c.json(result);
  })
  .get("/api/webhooks/:id/logs", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
    const db = c.get("db");
    const webhookService = new WebhookService(db);
    const projectService = new ProjectService(db);
    const endpoint = await webhookService.getEndpointById(id);
    if (!endpoint) return c.json({ error: "Endpoint not found" }, 404);
    const project = await projectService.getProjectById(endpoint.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    const logs = await webhookService.getLogsByEndpointId(id, limit);
    return c.json({
      logs: logs.map((l) => ({
        ...l,
        createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
      })),
    });
  })
  // ─── Billing (primary API) ─────────────────────────────────────────────────────
  .get("/api/billing", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const defaultBilling = () =>
      c.json({
        subscription: {
          plan: null,
          status: "active",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
        },
        mrr: 0,
        usage: { projectCount: 0, maxProjects: 1 },
        trialEndsAt: null,
      });

    try {
      const db = c.get("db");
      const subscriptionService = new SubscriptionService(db);
      const projectService = new ProjectService(db);
      const subscription = await subscriptionService.getOrCreateSubscription(
        user.id,
      );
      const mrr = await subscriptionService.calculateMRR(user.id);
      const projectsList = await projectService.getProjectsByUserId(user.id);
      const effectivePlan: BillingPlan =
        (subscription.plan as BillingPlan | null) ?? "starter";
      const maxProjects = getMaxProjects(effectivePlan);

      return c.json({
        subscription: {
          plan: subscription.plan,
          status: subscription.status,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
          currentPeriodEnd:
            subscription.currentPeriodEnd instanceof Date
              ? subscription.currentPeriodEnd.toISOString()
              : subscription.currentPeriodEnd ?? null,
        },
        mrr,
        usage: {
          projectCount: projectsList.length,
          maxProjects,
        },
        trialEndsAt:
          subscription.trialEndsAt instanceof Date
            ? subscription.trialEndsAt.toISOString()
            : subscription.trialEndsAt ?? null,
      });
    } catch (err) {
      console.error("GET /api/billing error:", err);
      return defaultBilling();
    }
  })
  .post("/api/billing/checkout", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createCheckoutSessionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const billing = await subscriptionService.getOrCreateSubscription(user.id);

    const interval = (parsed.data.interval ?? "month") as "month" | "year";
    const priceId = getPriceId(c.env, parsed.data.plan as Plan, interval);

    if (!priceId) {
      return c.json({ error: "invalid_plan" }, 400);
    }

    const eligibleForTrial =
      (parsed.data.plan === "growth" || parsed.data.plan === "scale") &&
      !billing.stripeSubscriptionId;

    const session = await createCheckoutSession(c.env, {
      customerId: billing.stripeCustomerId ?? undefined,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      userId: user.id,
      priceId,
      eligibleForTrial,
    });

    if (!session) {
      return c.json({ error: "stripe_session_failed" }, 500);
    }

    return c.json({ url: session.url });
  })
  .post("/api/billing/portal", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createPortalSessionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const billing = await subscriptionService.getOrCreateSubscription(user.id);

    if (!billing.stripeCustomerId) {
      return c.json({ error: "no_customer" }, 400);
    }

    const session = await createBillingPortalSession(c.env, {
      returnUrl: parsed.data.returnUrl,
      customerId: billing.stripeCustomerId,
      subscriptionId: billing.stripeSubscriptionId ?? undefined,
    });

    if (!session) {
      return c.json({ error: "portal_failed" }, 500);
    }

    return c.json({ url: session.url });
  })
  // ─── Subscriptions (legacy aliases) ─────────────────────────────────────────────
  .get("/api/subscription", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const defaultSubscription = () =>
      c.json({
        subscription: {
          plan: null,
          status: "active",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          trialEndsAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        mrr: 0,
        shouldShowUpgrade: false,
      });

    try {
      const db = c.get("db");
      const subscriptionService = new SubscriptionService(db);
      const subscription = await subscriptionService.getOrCreateSubscription(user.id);
      const mrr = await subscriptionService.calculateMRR(user.id);
      const shouldShowUpgrade = await subscriptionService.shouldShowUpgradePrompt(user.id);

      return c.json({
        subscription: {
          id: subscription.id,
          userId: subscription.userId,
          plan: subscription.plan,
          status: subscription.status,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          currentPeriodEnd:
            subscription.currentPeriodEnd instanceof Date
              ? subscription.currentPeriodEnd.toISOString()
              : subscription.currentPeriodEnd ?? null,
          trialEndsAt:
            subscription.trialEndsAt instanceof Date
              ? subscription.trialEndsAt.toISOString()
              : subscription.trialEndsAt ?? null,
          createdAt:
            subscription.createdAt instanceof Date
              ? subscription.createdAt.toISOString()
              : String(subscription.createdAt),
          updatedAt:
            subscription.updatedAt instanceof Date
              ? subscription.updatedAt.toISOString()
              : String(subscription.updatedAt),
        },
        mrr,
        shouldShowUpgrade,
      });
    } catch (err) {
      console.error("[GET /api/subscription] Error:", err instanceof Error ? err.message : String(err));
      if (err instanceof Error && err.stack) {
        console.error("[GET /api/subscription] Stack:", err.stack);
      }
      return defaultSubscription();
    }
  })
  .post("/api/subscription/select-plan", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(selectSubscriptionPlanSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const existing = await subscriptionService.getOrCreateSubscription(user.id);

    const nextStatus =
      parsed.data.plan === "starter"
        ? existing.status ?? "active"
        : existing.status ?? "trialing";

    const updated = await subscriptionService.updateSubscription(user.id, {
      plan: parsed.data.plan,
      status: nextStatus,
    });

    return c.json({
      subscription: updated,
    });
  })
  .post("/api/subscription/checkout", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createCheckoutSessionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const billing = await subscriptionService.getOrCreateSubscription(user.id);

    const interval = (parsed.data.interval ?? "month") as "month" | "year";
    const priceId = getPriceId(c.env, parsed.data.plan as Plan, interval);

    if (!priceId) {
      console.error("Invalid plan or missing price config", parsed.data.plan, interval);
      return c.json({ error: "invalid_plan" }, 400);
    }

    const eligibleForTrial =
      (parsed.data.plan === "growth" || parsed.data.plan === "scale") &&
      !billing.stripeSubscriptionId;

    const session = await createCheckoutSession(c.env, {
      customerId: billing.stripeCustomerId ?? undefined,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      userId: user.id,
      priceId,
      eligibleForTrial,
    });

    if (!session) {
      console.error("Stripe session failed");
      return c.json({ error: "stripe_session_failed" }, 500);
    }

    return c.json({ url: session.url });
  })
  .post("/api/subscription/portal", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createPortalSessionSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const billing = await subscriptionService.getOrCreateSubscription(user.id);

    if (!billing.stripeCustomerId) {
      return c.json({ error: "no_customer" }, 400);
    }

    const session = await createBillingPortalSession(c.env, {
      returnUrl: parsed.data.returnUrl,
      customerId: billing.stripeCustomerId,
      subscriptionId: billing.stripeSubscriptionId ?? undefined,
    });

    if (!session) {
      console.error("Stripe portal session failed");
      return c.json({ error: "portal_failed" }, 500);
    }

    return c.json({ url: session.url });
  })
  .post("/api/subscription/cancel-at-period-end", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const subscription = await subscriptionService.getOrCreateSubscription(
      user.id,
    );

    if (!subscription.stripeSubscriptionId) {
      return c.json({ error: "no_stripe_subscription" }, 400);
    }

    const ok = await cancelSubscriptionAtPeriodEnd(
      c.env,
      subscription.stripeSubscriptionId,
    );
    if (!ok) {
      return c.json({ error: "stripe_cancel_failed" }, 500);
    }

    // Rely on Stripe webhooks to update local subscription status and period end.
    return c.json({ success: true, mode: "at_period_end" });
  })
  .post("/api/subscription/cancel-now", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const subscription = await subscriptionService.getOrCreateSubscription(
      user.id,
    );

    if (!subscription.stripeSubscriptionId) {
      return c.json({ error: "no_stripe_subscription" }, 400);
    }

    const ok = await cancelSubscriptionImmediately(
      c.env,
      subscription.stripeSubscriptionId,
    );
    if (!ok) {
      return c.json({ error: "stripe_cancel_failed" }, 500);
    }

    // Rely on Stripe webhooks to update local subscription record.
    return c.json({ success: true, mode: "immediate" });
  })
  .post("/api/subscription/downgrade-to-starter", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);
    const existing = await subscriptionService.getOrCreateSubscription(user.id);

    const updated = await subscriptionService.updateSubscription(user.id, {
      plan: "starter",
      status: existing.status ?? "active",
    });

    return c.json({
      subscription: updated,
    });
  })
  .get("/api/billing/stripe-connection", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const secret = c.env.STRIPE_SECRET_KEY;
    if (!secret || secret.length === 0) {
      return c.json({
        connected: false,
        message: "STRIPE_SECRET_KEY is not set.",
        configured: false,
      });
    }

    try {
      const res = await fetch("https://api.stripe.com/v1/balance", {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });

      if (res.ok) {
        return c.json({
          connected: true,
          message: "Stripe connection successful.",
          configured: true,
        });
      }

      const text = await res.text();
      let message = `Stripe API returned ${res.status}.`;
      try {
        const err = JSON.parse(text) as { error?: { message?: string } };
        if (err?.error?.message) message = err.error.message;
      } catch {
        if (text) message = text.slice(0, 200);
      }
      console.error("[GET /api/billing/stripe-connection] Stripe API error:", res.status, message);

      return c.json({
        connected: false,
        message: res.status === 401 ? "Invalid Stripe secret key." : message,
        configured: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[GET /api/billing/stripe-connection] Error:", msg);
      return c.json({
        connected: false,
        message: `Connection failed: ${msg}`,
        configured: true,
      });
    }
  })
  .get("/api/webhooks/stripe/status", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const configured =
      !!c.env.STRIPE_WEBHOOK_SECRET &&
      c.env.STRIPE_WEBHOOK_SECRET.length > 0 &&
      !!c.env.STRIPE_SECRET_KEY;
    const message = configured
      ? "Webhook endpoint is configured. Send test events from Stripe Dashboard to verify."
      : "Set STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY to enable webhooks.";

    return c.json({
      configured,
      message,
      endpoint: "/api/webhooks/stripe",
    });
  })
  .post("/api/webhooks/stripe", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature")?? null;

    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json({ error: "Stripe not configured" }, 500);
    }

    if (c.env.STRIPE_WEBHOOK_SECRET) {
      const valid = await verifyStripeWebhookSignature(
        rawBody,
        signature,
        c.env.STRIPE_WEBHOOK_SECRET,
      );
      if (!valid) {
        console.error("Stripe webhook signature verification failed");
        return c.json({ error: "Invalid signature" }, 400);
      }
    }

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        client_reference_id?: string;
        customer?: string;
        subscription?: string;
      };

      if (session.client_reference_id && session.customer && session.subscription) {
        const subResponse = await fetch(
          `https://api.stripe.com/v1/subscriptions/${session.subscription}`,
          {
            headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}` },
          },
        );
        if (subResponse.ok) {
          const sub = (await subResponse.json()) as {
            items: { data: Array<{ price: { id: string } }> };
            current_period_end: number;
            status: string;
          };
          const priceId = sub.items.data[0]?.price.id;
          const plan = getPlanFromPriceId(c.env, priceId);
          const periodEnd = new Date(sub.current_period_end * 1000);
          const isTrialing = sub.status === "trialing";

          await subscriptionService.updateSubscription(session.client_reference_id, {
            plan,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            status: sub.status === "active" ? "active" : "trialing",
            currentPeriodEnd: periodEnd,
            trialEndsAt: isTrialing ? periodEnd : undefined,
          });
        }
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as {
        id?: string;
        customer?: string;
        status?: string;
        current_period_end?: number;
        items?: { data: Array<{ price: { id: string } }> };
      };

      if (sub.customer && sub.id) {
        const rows = await db
          .select()
          .from(userSubscriptions)
          .where(eq(userSubscriptions.stripeCustomerId, sub.customer as string))
          .limit(1);

        if (rows[0]) {
          const priceId = sub.items?.data[0]?.price.id;
          const plan = priceId ? getPlanFromPriceId(c.env, priceId) : "starter";
          const periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : undefined;
          const isTrialing = sub.status === "trialing";
          const normalizedStatus = (
            sub.status === "active"
              ? "active"
              : sub.status === "canceled"
                ? "canceled"
                : sub.status === "past_due"
                  ? "past_due"
                  : "trialing"
          ) as "active" | "canceled" | "past_due" | "trialing";

          await subscriptionService.updateSubscription(rows[0].userId, {
            plan,
            status: normalizedStatus,
            currentPeriodEnd: periodEnd,
            trialEndsAt: isTrialing ? periodEnd : undefined,
          });
        }
      }
    }

    return c.json({ received: true });
  })
  .post("/api/billing/webhook", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? null;

    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json({ error: "Stripe not configured" }, 500);
    }
    if (c.env.STRIPE_WEBHOOK_SECRET) {
      const valid = await verifyStripeWebhookSignature(
        rawBody,
        signature,
        c.env.STRIPE_WEBHOOK_SECRET,
      );
      if (!valid) {
        return c.json({ error: "Invalid signature" }, 400);
      }
    }

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const db = c.get("db");
    const subscriptionService = new SubscriptionService(db);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        client_reference_id?: string;
        customer?: string;
        subscription?: string;
      };
      if (session.client_reference_id && session.customer && session.subscription) {
        const subResponse = await fetch(
          `https://api.stripe.com/v1/subscriptions/${session.subscription}`,
          { headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}` } },
        );
        if (subResponse.ok) {
          const sub = (await subResponse.json()) as {
            items: { data: Array<{ price: { id: string } }> };
            current_period_end: number;
            status: string;
          };
          const priceId = sub.items.data[0]?.price.id;
          const plan = getPlanFromPriceId(c.env, priceId);
          const periodEnd = new Date(sub.current_period_end * 1000);
          const isTrialing = sub.status === "trialing";
          await subscriptionService.updateSubscription(session.client_reference_id, {
            plan,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            status: sub.status === "active" ? "active" : "trialing",
            currentPeriodEnd: periodEnd,
            trialEndsAt: isTrialing ? periodEnd : undefined,
          });
        }
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as {
        customer?: string;
        id?: string;
        status?: string;
        current_period_end?: number;
        items?: { data: Array<{ price: { id: string } }> };
      };
      if (sub.customer && sub.id) {
        const rows = await db
          .select()
          .from(userSubscriptions)
          .where(eq(userSubscriptions.stripeCustomerId, sub.customer as string))
          .limit(1);
        if (rows[0]) {
          const priceId = sub.items?.data[0]?.price.id;
          const plan = priceId ? getPlanFromPriceId(c.env, priceId) : "starter";
          const periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : undefined;
          const isTrialing = sub.status === "trialing";
          await subscriptionService.updateSubscription(rows[0].userId, {
            plan,
            status:
              sub.status === "active"
                ? "active"
                : sub.status === "canceled"
                  ? "canceled"
                  : sub.status === "past_due"
                    ? "past_due"
                    : "trialing",
            currentPeriodEnd: periodEnd,
            trialEndsAt: isTrialing ? periodEnd : undefined,
          });
        }
      }
    }

    return c.json({ received: true });
  });

// ─── Cron handler for daily Stripe sync ────────────────────────────────────────
async function handleScheduled(env: AppEnv): Promise<void> {
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("ENCRYPTION_KEY not set, skipping Stripe sync");
    return;
  }

  const db = drizzle(env.DB);
  const stripeService = new StripeService(db, encryptionKey, env.SALT ?? "");
  const syncService = new StripeSyncService(db, stripeService);

  const connections = await stripeService.getAllConnections();
  console.log(`Cron: syncing ${connections.length} Stripe connections`);

  for (const conn of connections) {
    if (conn.syncStatus === "syncing") continue; // skip in-progress syncs
    try {
      const result = await syncService.syncProject(conn.projectId);
      console.log(
        `Synced project ${conn.projectId}: ${result.processedCount} processed`,
      );
    } catch (err) {
      console.error(`Failed to sync project ${conn.projectId}:`, err);
    }
  }
}

export default {
  scheduled: (_controller: ScheduledController, env: AppEnv) => {
    return handleScheduled(env);
  },

  fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;

export type AppType = typeof app;
