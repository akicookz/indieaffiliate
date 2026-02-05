import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  partners,
  projects,
  type PartnerRow,
  type NewPartnerRow,
} from "../db";

export class PartnerService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getPartnersByUser(
    userId: string,
    filters?: { projectId?: string; status?: string },
  ): Promise<(PartnerRow & { projectName: string })[]> {
    // First get user's project IDs
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) return [];

    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const conditions = [inArray(partners.projectId, projectIds)];

    if (filters?.projectId && filters.projectId !== "all") {
      conditions.push(eq(partners.projectId, filters.projectId));
    }
    if (filters?.status && filters.status !== "all") {
      conditions.push(
        eq(partners.status, filters.status as "active" | "pending" | "inactive"),
      );
    }

    const rows = await this.db
      .select()
      .from(partners)
      .where(and(...conditions));

    return rows.map((row) => ({
      ...row,
      projectName: projectMap.get(row.projectId) ?? "Unknown",
    }));
  }

  async getPartnerById(id: string): Promise<PartnerRow | null> {
    const rows = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createPartner(
    data: Omit<NewPartnerRow, "id" | "createdAt" | "updatedAt" | "referralCode" | "totalRevenue" | "referredCustomers">,
  ): Promise<PartnerRow> {
    const id = crypto.randomUUID();
    const referralCode = generateReferralCode();
    const row: NewPartnerRow = {
      id,
      referralCode,
      ...data,
    };
    await this.db.insert(partners).values(row);
    return (await this.getPartnerById(id))!;
  }

  async updatePartner(
    id: string,
    updates: Partial<Pick<PartnerRow, "name" | "email" | "status" | "commissionRate">>,
  ): Promise<PartnerRow | null> {
    await this.db
      .update(partners)
      .set(updates)
      .where(eq(partners.id, id));
    return this.getPartnerById(id);
  }

  async getPartnerByEmail(
    projectId: string,
    email: string,
  ): Promise<PartnerRow | null> {
    const rows = await this.db
      .select()
      .from(partners)
      .where(and(eq(partners.projectId, projectId), eq(partners.email, email)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPartnerStats(userId: string, projectId?: string) {
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { totalPartners: 0, activePartners: 0, pendingPartners: 0 };
    }

    const projectIds = projectId && projectId !== "all"
      ? [projectId]
      : userProjects.map((p) => p.id);

    const stats = await this.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${partners.status} = 'active' then 1 else 0 end)`,
        pending: sql<number>`sum(case when ${partners.status} = 'pending' then 1 else 0 end)`,
      })
      .from(partners)
      .where(inArray(partners.projectId, projectIds));

    const row = stats[0];
    return {
      totalPartners: row?.total ?? 0,
      activePartners: row?.active ?? 0,
      pendingPartners: row?.pending ?? 0,
    };
  }
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
