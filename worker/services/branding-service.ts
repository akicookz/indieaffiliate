import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  projectBranding,
  projects,
  type ProjectBrandingRow,
  type NewProjectBrandingRow,
} from "../db";

export interface AvatarSlot {
  image: string | null;
  initials: string | null;
}

export interface FaqItem {
  q: string;
  a: string;
}

export type BrandingPublic = Omit<
  ProjectBrandingRow,
  "socialProofAvatars" | "faqs"
> & {
  socialProofAvatars: AvatarSlot[] | null;
  faqs: FaqItem[] | null;
};

function decodeAvatars(raw: string | null | undefined): AvatarSlot[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .slice(0, 5)
      .map((s: unknown) => {
        const slot = (s ?? {}) as Record<string, unknown>;
        return {
          image: typeof slot.image === "string" ? slot.image : null,
          initials: typeof slot.initials === "string" ? slot.initials : null,
        };
      });
  } catch {
    return null;
  }
}

function decodeFaqs(raw: string | null | undefined): FaqItem[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .slice(0, 8)
      .map((s: unknown) => {
        const item = (s ?? {}) as Record<string, unknown>;
        return {
          q: typeof item.q === "string" ? item.q : "",
          a: typeof item.a === "string" ? item.a : "",
        };
      })
      .filter((it) => it.q && it.a);
  } catch {
    return null;
  }
}

function hydrate(row: ProjectBrandingRow): BrandingPublic {
  return {
    ...row,
    socialProofAvatars: decodeAvatars(row.socialProofAvatars),
    faqs: decodeFaqs(row.faqs),
  };
}

export class BrandingService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getByProjectId(projectId: string): Promise<BrandingPublic | null> {
    const rows = await this.db
      .select()
      .from(projectBranding)
      .where(eq(projectBranding.projectId, projectId))
      .limit(1);
    return rows[0] ? hydrate(rows[0]) : null;
  }

  async getBySlug(
    slug: string,
  ): Promise<{ branding: BrandingPublic; projectName: string } | null> {
    const rows = await this.db
      .select({
        branding: projectBranding,
        projectName: projects.name,
      })
      .from(projects)
      .innerJoin(projectBranding, eq(projects.id, projectBranding.projectId))
      .where(eq(projects.slug, slug))
      .limit(1);

    if (rows.length === 0) return null;
    return {
      branding: hydrate(rows[0].branding),
      projectName: rows[0].projectName,
    };
  }

  async upsert(
    projectId: string,
    data: Partial<
      Omit<
        NewProjectBrandingRow,
        | "id"
        | "projectId"
        | "createdAt"
        | "updatedAt"
        | "socialProofAvatars"
        | "faqs"
      >
    > & {
      socialProofAvatars?: AvatarSlot[] | null;
      faqs?: FaqItem[] | null;
    },
  ): Promise<BrandingPublic> {
    const { socialProofAvatars, faqs, ...rest } = data;
    const dbData: Partial<NewProjectBrandingRow> = { ...rest };
    if (socialProofAvatars !== undefined) {
      dbData.socialProofAvatars = socialProofAvatars
        ? JSON.stringify(socialProofAvatars)
        : null;
    }
    if (faqs !== undefined) {
      dbData.faqs = faqs ? JSON.stringify(faqs) : null;
    }

    const existing = await this.getByProjectId(projectId);

    if (existing) {
      await this.db
        .update(projectBranding)
        .set(dbData)
        .where(eq(projectBranding.projectId, projectId));
      return (await this.getByProjectId(projectId))!;
    }

    const id = crypto.randomUUID();
    const row: NewProjectBrandingRow = {
      id,
      projectId,
      ...dbData,
    };
    await this.db.insert(projectBranding).values(row);
    return (await this.getByProjectId(projectId))!;
  }
}
