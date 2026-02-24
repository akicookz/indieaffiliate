import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { except } from "hono/combine";
import { createAuth } from "./auth";
import { type HonoAppContext, type AppEnv } from "./types";
import { partners, userSubscriptions } from "./db";
import { ProjectService } from "./services/project-service";
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
import { StripeService } from "./services/stripe-service";
import { StripeSyncService } from "./services/stripe-sync-service";
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
} from "./services/stripe-checkout";
import { verifyStripeWebhookSignature } from "./services/stripe-webhook";
import { getMaxProjects, canCreateProject, type Plan as BillingPlan } from "./billing";
import {
  createProjectSchema,
  updateProjectSchema,
  createPartnerSchema,
  updatePartnerSchema,
  updateCommissionSchema,
  bulkCommissionActionSchema,
  trackClickSchema,
  trackConversionSchema,
  createApiKeySchema,
  connectStripeSchema,
  updateBrandingSchema,
  joinPartnerSchema,
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
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from "./validation";

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

const app = new Hono<HonoAppContext>()
  .use("*", cors())
  .use(
    "/api/auth/*",
    cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    }),
  )
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties);
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
        const projectService = new ProjectService(db);
        const project = await projectService.getProjectById(partner.projectId);
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
    });

    if (!result.isDuplicate) {
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

    return c.json(result, result.isDuplicate ? 200 : 201);
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

    if (!result) {
      return c.json({ error: "Program not found" }, 404);
    }

    // Build public-facing response (don't expose internal IDs)
    const baseUrl = c.req.url.split("/api")[0];
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
    });
  })
  // ─── Public: Partner self-registration ────────────────────────────────────
  .post("/api/join/:slug", async (c) => {
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

    const brandingResult = await brandingService.getBySlug(slug);
    if (!brandingResult) {
      return c.json({ error: "Program not found" }, 404);
    }

    const branding = brandingResult.branding;

    // Check for duplicate partner
    const partnerService = new PartnerService(db);
    const existing = await partnerService.getPartnerByEmail(
      branding.projectId,
      parsed.data.email.trim().toLowerCase(),
    );
    if (existing) {
      return c.json({ error: "You've already applied to this program." }, 409);
    }

    // Hash IP for fraud detection
    const joinHashedIp = await hashIP(ip);

    const status = branding.autoApprove ? "active" : "pending";
    const partner = await partnerService.createPartner({
      projectId: branding.projectId,
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      commissionRate: branding.defaultCommissionRate,
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
    const emailService = new EmailService(c.env.RESEND_API_KEY);
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
        .catch((err) => console.error("Failed to send partner welcome:", err));
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
  })
  // ─── Auth middleware ────────────────────────────────────────────────────────
  .use("/api/*", async (c, next) => {
    const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    c.set("db", drizzle(c.env.DB));
    if (!session) {
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
    const projectService = new ProjectService(db);
    const projectsList = await projectService.getProjectsByUserId(user.id);

    return c.json({ projects: projectsList });
  })
  .post("/api/projects", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createProjectSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const projectService = new ProjectService(db);
    const subscriptionService = new SubscriptionService(db);
    const subscription = await subscriptionService.getOrCreateSubscription(user.id);
    const existingProjects = await projectService.getProjectsByUserId(user.id);
    if (!canCreateProject(subscription.plan as BillingPlan, existingProjects.length)) {
      return c.json(
        {
          error: "Plan limit reached",
          code: "upgrade_required",
          maxProjects: getMaxProjects(subscription.plan as BillingPlan),
        },
        403,
      );
    }

    const slug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const project = await projectService.createProject({
      userId: user.id,
      name: parsed.data.name.trim(),
      slug,
      domain: parsed.data.domain?.trim() || null,
    });

    return c.json({ project }, 201);
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
    const status = c.req.query("status");

    const db = c.get("db");
    const partnerService = new PartnerService(db);
    const partnersList = await partnerService.getPartnersByUser(user.id, {
      projectId,
      status,
    });
    const stats = await partnerService.getPartnerStats(user.id, projectId);

    return c.json({ partners: partnersList, stats });
  })
  .post("/api/partners", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const parsed = validate(createPartnerSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    // Verify user owns the project
    const db = c.get("db");
    const projectService = new ProjectService(db);
    const project = await projectService.getProjectById(parsed.data.projectId);
    if (!project || project.userId !== user.id) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Hash IP for fraud detection
    const partnerIp =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "unknown";
    const hashedPartnerIp = await hashIP(partnerIp);

    const partnerService = new PartnerService(db);
    let partner;
    try {
      partner = await partnerService.createPartner({
        projectId: parsed.data.projectId,
        name: parsed.data.name.trim(),
        email: parsed.data.email.trim().toLowerCase(),
        commissionRate: parsed.data.commissionRate ?? 0.2,
        referralCode: parsed.data.referralCode,
        status: "active",
        registrationIp: hashedPartnerIp,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE constraint failed")) {
        return c.json(
          { error: "A partner with this email or referral code already exists in this project" },
          409,
        );
      }
      throw err;
    }

    const webhookServicePartners = new WebhookService(db);
    await webhookServicePartners.fireEvent(parsed.data.projectId, "partner.created", {
      partnerId: partner.id,
      name: partner.name,
      email: partner.email,
      status: partner.status,
      referralCode: partner.referralCode ?? null,
    });

    // Fraud checks: owner-as-partner
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

    // Send invitation email only if requested
    const sendInvite = (body as { sendInvite?: boolean }).sendInvite !== false;
    if (sendInvite) {
      try {
        const emailService = new EmailService(c.env.RESEND_API_KEY);
        const baseUrl = c.env.BETTER_AUTH_URL || c.req.url.split("/api")[0];
        emailService
          .sendPartnerInvitation({
            partnerName: partner.name,
            partnerEmail: partner.email,
            projectName: project.name,
            referralCode: partner.referralCode,
            baseUrl,
          })
          .catch((err) => console.error("Failed to send partner invitation:", err));
      } catch (err) {
        console.error("Email service init failed:", err);
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

    const partner = await partnerService.updatePartner(id, parsed.data);
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
    const status = c.req.query("status");

    const db = c.get("db");
    const customerService = new CustomerService(db);
    const customersList = await customerService.getCustomersByUser(user.id, {
      projectId,
      status,
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

    const updated = await commissionService.updateCommissionStatus(
      id,
      parsed.data.status,
      parsed.data.fraudFlag,
    );

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

    return c.json({ commission: updated });
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
    const requestedIds = parsed.data.ids.filter((id) => validIds.has(id));

    if (requestedIds.length === 0) {
      return c.json({ error: "No valid commission IDs found" }, 404);
    }

    const statusMap = {
      approve: "approved" as const,
      pay: "paid" as const,
      reject: "rejected" as const,
    };

    const count = await commissionService.bulkUpdateStatus(
      requestedIds,
      statusMap[parsed.data.action],
      parsed.data.fraudFlag,
    );

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

    return c.json({ updated: count });
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

    for (const customerId of parsed.data.stripeCustomerIds) {
      const result = await syncService.syncCustomerHistory(
        apiKey,
        projectId,
        parsed.data.partnerId,
        customerId,
      );
      totalCommissionsCreated += result.commissionsCreated;
      totalDuplicatesSkipped += result.duplicatesSkipped;
    }

    return c.json({
      customersProcessed: parsed.data.stripeCustomerIds.length,
      commissionsCreated: totalCommissionsCreated,
      duplicatesSkipped: totalDuplicatesSkipped,
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

    // Return defaults if no branding exists yet
    const baseUrl = c.req.url.split("/api")[0];
    return c.json({
      branding: branding
        ? {
            ...branding,
            logo: branding.logo
              ? `${baseUrl}/api/uploads/${branding.logo}`
              : null,
            backgroundImage: branding.backgroundImage
              ? `${baseUrl}/api/uploads/${branding.backgroundImage}`
              : null,
          }
        : null,
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

    const brandingService = new BrandingService(db);
    const branding = await brandingService.upsert(projectId, parsed.data);

    const baseUrl = c.req.url.split("/api")[0];
    return c.json({
      branding: {
        ...branding,
        logo: branding.logo ? `${baseUrl}/api/uploads/${branding.logo}` : null,
        backgroundImage: branding.backgroundImage
          ? `${baseUrl}/api/uploads/${branding.backgroundImage}`
          : null,
      },
      joinUrl: `${baseUrl}/join/${project.slug}`,
    });
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

    // Return first partner's info as primary (partner may span multiple projects)
    const primary = partnerRecords[0];
    return c.json({
      partner: {
        name: primary.name,
        email: primary.email,
        referralCode: primary.referralCode,
        commissionRate: primary.commissionRate,
        status: primary.status,
        payoutLink: primary.payoutLink,
      },
      programs: partnerRecords.map((p) => ({
        id: p.id,
        projectId: p.projectId,
        referralCode: p.referralCode,
        commissionRate: p.commissionRate,
        status: p.status,
      })),
      stats,
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
        payoutLink: parsed.data.payoutLink,
      });
    }

    return c.json({ payoutLink: parsed.data.payoutLink });
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
          plan: "starter",
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
      const subscription = await subscriptionService.getOrCreateSubscription(user.id);
      const mrr = await subscriptionService.calculateMRR(user.id);
      const projectsList = await projectService.getProjectsByUserId(user.id);
      const maxProjects = getMaxProjects(subscription.plan as BillingPlan);

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
          plan: "starter",
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
