import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import {
  projectBranding,
  projects,
  type ProjectBrandingRow,
  type NewProjectBrandingRow,
} from "../db";

export class BrandingService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getByProjectId(projectId: string): Promise<ProjectBrandingRow | null> {
    const rows = await this.db
      .select()
      .from(projectBranding)
      .where(eq(projectBranding.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getBySlug(
    slug: string,
  ): Promise<{ branding: ProjectBrandingRow; projectName: string } | null> {
    const rows = await this.db
      .select({
        branding: projectBranding,
        projectName: projects.name,
      })
      .from(projects)
      .innerJoin(projectBranding, eq(projects.id, projectBranding.projectId))
      .where(sql`lower(${projects.slug}) = lower(${slug})`)
      .limit(1);

    if (rows.length === 0) return null;
    return { branding: rows[0].branding, projectName: rows[0].projectName };
  }

  async upsert(
    projectId: string,
    data: Partial<
      Omit<NewProjectBrandingRow, "id" | "projectId" | "createdAt" | "updatedAt">
    >,
  ): Promise<ProjectBrandingRow> {
    const existing = await this.getByProjectId(projectId);

    if (existing) {
      await this.db
        .update(projectBranding)
        .set(data)
        .where(eq(projectBranding.projectId, projectId));
      return (await this.getByProjectId(projectId))!;
    }

    const id = crypto.randomUUID();
    const row: NewProjectBrandingRow = {
      id,
      projectId,
      ...data,
    };
    await this.db.insert(projectBranding).values(row);
    return (await this.getByProjectId(projectId))!;
  }
}
