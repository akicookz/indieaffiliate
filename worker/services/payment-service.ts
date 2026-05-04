import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, isNull, isNotNull, sql, desc } from "drizzle-orm";
import { payments, type PaymentRow, type NewPaymentRow } from "../db";

export type AssignedFilter = "all" | "unassigned" | "assigned" | "flagged";
export type SourceFilter = "all" | "stripe" | "csv";

export interface ListFilters {
  assigned?: AssignedFilter;
  source?: SourceFilter;
  search?: string;
}

export interface ListResult {
  payments: PaymentRow[];
  counts: {
    all: number;
    unassigned: number;
    assigned: number;
    flagged: number;
  };
}

export class PaymentService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async list(projectId: string, filters: ListFilters = {}): Promise<ListResult> {
    const conditions = [eq(payments.projectId, projectId)];
    if (filters.assigned === "unassigned") {
      conditions.push(isNull(payments.partnerId));
    } else if (filters.assigned === "assigned") {
      conditions.push(isNotNull(payments.partnerId));
    } else if (filters.assigned === "flagged") {
      conditions.push(isNotNull(payments.flagReason));
    }
    if (filters.source && filters.source !== "all") {
      conditions.push(eq(payments.source, filters.source));
    }
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(lower(${payments.customerEmail}) like ${term} OR lower(${payments.customerName}) like ${term} OR lower(${payments.externalPaymentId}) like ${term})`,
      );
    }

    const rows = await this.db
      .select()
      .from(payments)
      .where(and(...conditions))
      .orderBy(desc(payments.startedAt));

    const countRow = await this.db
      .select({
        all: sql<number>`count(*)`,
        unassigned: sql<number>`sum(case when ${payments.partnerId} is null then 1 else 0 end)`,
        assigned: sql<number>`sum(case when ${payments.partnerId} is not null then 1 else 0 end)`,
        flagged: sql<number>`sum(case when ${payments.flagReason} is not null then 1 else 0 end)`,
      })
      .from(payments)
      .where(eq(payments.projectId, projectId));

    return {
      payments: rows,
      counts: {
        all: countRow[0]?.all ?? 0,
        unassigned: countRow[0]?.unassigned ?? 0,
        assigned: countRow[0]?.assigned ?? 0,
        flagged: countRow[0]?.flagged ?? 0,
      },
    };
  }

  async getById(id: string): Promise<PaymentRow | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(
    id: string,
    updates: Partial<
      Pick<PaymentRow, "partnerId" | "flagReason">
    >,
  ): Promise<PaymentRow | null> {
    if (Object.keys(updates).length === 0) return this.getById(id);
    await this.db.update(payments).set(updates).where(eq(payments.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(payments).where(eq(payments.id, id));
  }

  /**
   * Idempotent upsert keyed on (projectId, source, externalPaymentId).
   * Returns whether the row was inserted (true) or updated (false).
   */
  async upsertFromExternal(input: {
    projectId: string;
    source: string;
    externalPaymentId: string;
    kind: "subscription" | "one_time";
    customerEmail?: string | null;
    customerName?: string | null;
    planName?: string | null;
    mrr?: number | null;
    startedAt?: Date | null;
    status?: string | null;
    // Assignment-time snapshots. Required fields when assigning a Stripe row
    // to a partner; left null for CSV imports.
    partnerId?: string | null;
    commissionProgramId?: string | null;
    programType?: "recurring" | "lifetime" | "one-time" | null;
    durationMonths?: number | null;
    rate?: number | null;
    subscriptionAnchorAt?: Date | null;
  }): Promise<{ row: PaymentRow; inserted: boolean }> {
    const existing = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.projectId, input.projectId),
          eq(payments.source, input.source),
          eq(payments.externalPaymentId, input.externalPaymentId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(payments)
        .set({
          kind: input.kind,
          customerEmail: input.customerEmail ?? existing[0].customerEmail,
          customerName: input.customerName ?? existing[0].customerName,
          planName: input.planName ?? existing[0].planName,
          mrr: input.mrr ?? existing[0].mrr,
          startedAt: input.startedAt ?? existing[0].startedAt,
          status: input.status ?? existing[0].status,
          partnerId:
            input.partnerId !== undefined ? input.partnerId : existing[0].partnerId,
          commissionProgramId:
            input.commissionProgramId !== undefined
              ? input.commissionProgramId
              : existing[0].commissionProgramId,
          programType:
            input.programType !== undefined
              ? input.programType
              : existing[0].programType,
          durationMonths:
            input.durationMonths !== undefined
              ? input.durationMonths
              : existing[0].durationMonths,
          rate: input.rate !== undefined ? input.rate : existing[0].rate,
          subscriptionAnchorAt:
            input.subscriptionAnchorAt !== undefined
              ? input.subscriptionAnchorAt
              : existing[0].subscriptionAnchorAt,
        })
        .where(eq(payments.id, existing[0].id));
      const fresh = await this.getById(existing[0].id);
      return { row: fresh!, inserted: false };
    }

    const id = crypto.randomUUID();
    const row: NewPaymentRow = {
      id,
      projectId: input.projectId,
      source: input.source,
      externalPaymentId: input.externalPaymentId,
      kind: input.kind,
      customerEmail: input.customerEmail ?? null,
      customerName: input.customerName ?? null,
      planName: input.planName ?? null,
      mrr: input.mrr ?? null,
      startedAt: input.startedAt ?? null,
      status: input.status ?? null,
      partnerId: input.partnerId ?? null,
      commissionProgramId: input.commissionProgramId ?? null,
      programType: input.programType ?? null,
      durationMonths: input.durationMonths ?? null,
      rate: input.rate ?? null,
      subscriptionAnchorAt: input.subscriptionAnchorAt ?? null,
    };
    await this.db.insert(payments).values(row);
    const fresh = await this.getById(id);
    return { row: fresh!, inserted: true };
  }

  async deleteByExternalId(
    projectId: string,
    source: string,
    externalPaymentId: string,
  ): Promise<void> {
    await this.db
      .delete(payments)
      .where(
        and(
          eq(payments.projectId, projectId),
          eq(payments.source, source),
          eq(payments.externalPaymentId, externalPaymentId),
        ),
      );
  }
}
