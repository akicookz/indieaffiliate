import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { except } from "hono/combine";
import { createAuth } from "./auth";
import { type HonoAppContext, type AppEnv } from "./types";
import { partners } from "./db";
import { ProjectService } from "./services/project-service";
import { PartnerService } from "./services/partner-service";
import { CustomerService } from "./services/customer-service";
import { DashboardService } from "./services/dashboard-service";
import { TrackingService } from "./services/tracking-service";
import { CommissionService } from "./services/commission-service";
import { AnalyticsService } from "./services/analytics-service";
import { ApiKeyService } from "./services/api-key-service";
import { EmailService } from "./services/email-service";
import { BrandingService } from "./services/branding-service";
import { StripeService } from "./services/stripe-service";
import { StripeSyncService } from "./services/stripe-sync-service";
import {
  createProjectSchema,
  updateProjectSchema,
  createPartnerSchema,
  updatePartnerSchema,
  updateCommissionSchema,
  trackClickSchema,
  trackConversionSchema,
  createApiKeySchema,
  connectStripeSchema,
  updateBrandingSchema,
  joinPartnerSchema,
} from "./validation";

// ─── Simple IP-based rate limiter (in-memory, per-isolate) ───────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
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
function validate<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } } }, data: unknown): { success: true; data: T } | { success: false; error: string } {
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
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(`track:${ip}`, 60, 60_000)) {
      return c.text("Rate limit exceeded", 429);
    }

    const referralCode = c.req.param("referralCode");
    const db = drizzle(c.env.DB);
    const trackingService = new TrackingService(db);

    const partner = await trackingService.getPartnerByReferralCode(referralCode);
    if (!partner || partner.status !== "active") {
      return c.text("Invalid referral link", 404);
    }

    // Record click
    await trackingService.recordClick({
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
      ip,
      userAgent: c.req.header("user-agent"),
      referrer: c.req.header("referer"),
      landingPage: c.req.query("url"),
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
      return c.redirect(redirectUrl, 302);
    }
    const pixel = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
      0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
      0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
      0x01, 0x00, 0x3b,
    ]);
    return new Response(pixel, {
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
    });
  })
  .post("/api/track/click", async (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(`track:${ip}`, 60, 60_000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json();
    const parsed = validate(trackClickSchema, body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const db = drizzle(c.env.DB);
    const trackingService = new TrackingService(db);

    const partner = await trackingService.getPartnerByReferralCode(parsed.data.referralCode);
    if (!partner || partner.status !== "active") {
      return c.json({ error: "Invalid referral code" }, 404);
    }

    const clickId = await trackingService.recordClick({
      partnerId: partner.id,
      projectId: partner.projectId,
      referralCode: partner.referralCode,
      ip,
      userAgent: c.req.header("user-agent"),
      referrer: c.req.header("referer"),
      landingPage: parsed.data.landingPage,
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
      return c.json({ error: "API key required. Use Authorization: Bearer ia_xxx" }, 401);
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
    const partner = await trackingService.getPartnerByReferralCode(parsed.data.referralCode);

    if (!partner || partner.projectId !== keyResult.projectId) {
      return c.json({ error: "Invalid referral code for this project" }, 404);
    }

    const commissionService = new CommissionService(db);
    const result = await commissionService.recordConversion({
      partnerId: partner.id,
      projectId: keyResult.projectId,
      customerEmail: parsed.data.customerEmail.trim().toLowerCase(),
      revenue: parsed.data.revenue,
      customerStatus: parsed.data.customerStatus,
    });

    return c.json(result, 201);
  })
  // ─── Public: Serve uploaded images from R2 ─────────────────────────────────
  .get("/api/uploads/:key", async (c) => {
    const key = c.req.param("key");
    const object = await c.env.UPLOADS.get(key);
    if (!object) return c.text("Not found", 404);

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
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
      logo: result.branding.logo ? `${baseUrl}/api/uploads/${result.branding.logo}` : null,
      backgroundImage: result.branding.backgroundImage
        ? `${baseUrl}/api/uploads/${result.branding.backgroundImage}`
        : null,
    });
  })
  // ─── Public: Partner self-registration ────────────────────────────────────
  .post("/api/join/:slug", async (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(`join:${ip}`, 5, 60_000)) {
      return c.json({ error: "Too many requests. Please try again later." }, 429);
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

    const status = branding.autoApprove ? "active" : "pending";
    const partner = await partnerService.createPartner({
      projectId: branding.projectId,
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      commissionRate: branding.defaultCommissionRate,
      status,
    });

    // Send appropriate email
    if (c.env.RESEND_API_KEY) {
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      const baseUrl = c.env.BETTER_AUTH_URL || c.req.url.split("/api")[0];

      if (branding.autoApprove) {
        emailService.sendPartnerWelcome({
          partnerName: partner.name,
          partnerEmail: partner.email,
          projectName: brandingResult.projectName,
          referralCode: partner.referralCode,
          baseUrl,
        }).catch((err) => console.error("Failed to send partner welcome:", err));
      } else {
        emailService.sendPartnerApplicationReceived({
          partnerName: partner.name,
          partnerEmail: partner.email,
          projectName: brandingResult.projectName,
        }).catch((err) => console.error("Failed to send application received:", err));
      }
    }

    return c.json({
      status,
      message: branding.autoApprove
        ? "Welcome! Check your email for your referral link."
        : "Application submitted! We'll review it and get back to you.",
    }, 201);
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

    const slug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const db = c.get("db");
    const projectService = new ProjectService(db);
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
      const trimmed = parsed.data.domain === null ? null : parsed.data.domain.trim();
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

    const partnerService = new PartnerService(db);
    const partner = await partnerService.createPartner({
      projectId: parsed.data.projectId,
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      commissionRate: parsed.data.commissionRate ?? 0.2,
      status: "pending",
    });

    // Send invitation email (async, don't block response)
    if (c.env.RESEND_API_KEY) {
      const emailService = new EmailService(c.env.RESEND_API_KEY);
      const baseUrl = c.env.BETTER_AUTH_URL || c.req.url.split("/api")[0];
      emailService.sendPartnerInvitation({
        partnerName: partner.name,
        partnerEmail: partner.email,
        projectName: project.name,
        referralCode: partner.referralCode,
        baseUrl,
      }).catch((err) => console.error("Failed to send partner invitation:", err));
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
    const commissionsList = await commissionService.getCommissionsByUser(user.id, {
      projectId,
      status,
    });
    const stats = await commissionService.getCommissionStats(user.id, projectId);

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

    const updated = await commissionService.updateCommissionStatus(id, parsed.data.status);
    return c.json({ commission: updated });
  })
  // ─── API Keys ───────────────────────────────────────────────────────────────
  .get("/api/api-keys", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const projectId = c.req.query("project");
    if (!projectId) return c.json({ error: "project query param required" }, 400);

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
    return c.json({
      key, // plaintext, shown once
      id: row.id,
      prefix: row.prefix,
      name: row.name,
      createdAt: row.createdAt,
    }, 201);
  })
  .delete("/api/api-keys/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = c.get("db");

    // We need to verify the key belongs to a project the user owns
    const apiKeyService = new ApiKeyService(db);
    const allUserProjects = await new ProjectService(db).getProjectsByUserId(user.id);

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

    const stripeService = new StripeService(db, c.env.ENCRYPTION_KEY ?? "", c.env.SALT ?? "");
    const conn = await stripeService.getConnection(projectId);

    if (!conn) {
      return c.json({ connected: false });
    }

    return c.json({
      connected: true,
      lastSyncAt: conn.lastSyncAt,
      syncStatus: conn.syncStatus,
      syncError: conn.syncError,
      createdAt: conn.createdAt,
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

    const stripeService = new StripeService(db, encryptionKey, c.env.SALT ?? "");

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

    const stripeService = new StripeService(db, c.env.ENCRYPTION_KEY ?? "", c.env.SALT ?? "");
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

    const stripeService = new StripeService(db, encryptionKey, c.env.SALT ?? "");
    const conn = await stripeService.getConnection(projectId);
    if (!conn) {
      return c.json({ error: "Stripe not connected" }, 400);
    }

    const syncService = new StripeSyncService(db, stripeService);
    const result = await syncService.syncProject(projectId);

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
            logo: branding.logo ? `${baseUrl}/api/uploads/${branding.logo}` : null,
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
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: "Only JPEG, PNG, WebP, and SVG images are allowed" }, 400);
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
      console.log(`Synced project ${conn.projectId}: ${result.processedCount} processed`);
    } catch (err) {
      console.error(`Failed to sync project ${conn.projectId}:`, err);
    }
  }
}

export default {
  scheduled: (_controller: ScheduledController, env: AppEnv) => {
    return handleScheduled(env);
  },

  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;

export type AppType = typeof app;
