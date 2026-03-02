import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import {
  projects,
  type ProjectRow,
  type NewProjectRow,
} from "../db";

export class ProjectService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getProjectsByUserId(userId: string): Promise<ProjectRow[]> {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId));
  }

  async getProjectById(id: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Find a project by slug (case-insensitive). For public join page. */
  async getProjectBySlug(slug: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(sql`lower(${projects.slug}) = lower(${slug})`)
      .limit(1);
    return rows[0] ?? null;
  }

  async createProject(
    data: Omit<NewProjectRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProjectRow> {
    const id = crypto.randomUUID();
    const row: NewProjectRow = { id, ...data };
    await this.db.insert(projects).values(row);
    return (await this.getProjectById(id))!;
  }

  async updateProject(
    id: string,
    userId: string,
    updates: Partial<Pick<ProjectRow, "name" | "slug" | "domain">>,
  ): Promise<ProjectRow | null> {
    // Verify ownership BEFORE applying update
    const project = await this.getProjectById(id);
    if (!project || project.userId !== userId) return null;

    await this.db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, id));

    return (await this.getProjectById(id))!;
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    const project = await this.getProjectById(id);
    if (!project || project.userId !== userId) return false;

    await this.db.delete(projects).where(eq(projects.id, id));
    return true;
  }
}
