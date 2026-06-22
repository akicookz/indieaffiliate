import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  commissions,
  commissionPrograms,
  coupons,
  couponRedemptions,
  partners,
  projectBranding,
  type CommissionProgramRow,
  type CouponRow,
} from "../db";

export type ProgramType = "recurring" | "lifetime" | "one-time";
export type PayoutCadence = "monthly_day" | "monthly_ordinal" | "weekly";

export interface NewCommissionProgramInput {
  code: string;
  name: string;
  type: ProgramType;
  rate: number;
  durationMonths?: number | null;
  flatAmount?: number | null;
  description?: string | null;
  minPayout?: number;
  isDefault?: boolean;
  payoutCadence?: PayoutCadence | null;
  payoutDayOfMonth?: number | null;
  payoutDayOfWeek?: number | null;
  payoutOrdinal?: number | null;
}

export type UpdateCommissionProgramInput = Partial<NewCommissionProgramInput>;

export interface ProgramWithStats extends CommissionProgramRow {
  partners: number;
  gtvMonth: number;
}

interface CommissionProgramStatRow {
  programId: string | null;
  amount: number;
  rate: number;
  mrr: number | null;
  status: "pending" | "approved" | "paid" | "rejected";
  eventDate: Date | null;
  createdAt: Date;
}

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function estimateCommissionRevenue(row: CommissionProgramStatRow): number {
  if (row.rate > 0) return row.amount / row.rate;
  return row.mrr ?? 0;
}

export class CommissionProgramService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getById(
    projectId: string,
    id: string,
  ): Promise<CommissionProgramRow | null> {
    const rows = await this.db
      .select()
      .from(commissionPrograms)
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          eq(commissionPrograms.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(projectId: string): Promise<ProgramWithStats[]> {
    const rows = await this.db
      .select()
      .from(commissionPrograms)
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          isNull(commissionPrograms.archivedAt),
        ),
      )
      .orderBy(desc(commissionPrograms.createdAt));

    if (rows.length === 0) return [];

    const brandingRows = await this.db
      .select({
        defaultProgramId: projectBranding.defaultCommissionProgramId,
      })
      .from(projectBranding)
      .where(eq(projectBranding.projectId, projectId))
      .limit(1);
    const defaultProgramId = brandingRows[0]?.defaultProgramId ?? null;

    const partnerRows = await this.db
      .select({
        programId: partners.commissionProgramId,
      })
      .from(partners)
      .where(eq(partners.projectId, projectId));
    const partnerCounts = new Map<string, number>();
    for (const partner of partnerRows) {
      const programId = partner.programId ?? defaultProgramId;
      if (!programId) continue;
      partnerCounts.set(programId, (partnerCounts.get(programId) ?? 0) + 1);
    }

    const monthStart = currentMonthStart().getTime();
    const commissionRows = await this.db
      .select({
        programId: commissions.commissionProgramId,
        amount: commissions.amount,
        rate: commissions.rate,
        mrr: commissions.mrr,
        status: commissions.status,
        eventDate: commissions.eventDate,
        createdAt: commissions.createdAt,
      })
      .from(commissions)
      .where(eq(commissions.projectId, projectId));
    const gtvByProgram = new Map<string, number>();
    for (const commission of commissionRows) {
      if (!commission.programId || commission.status === "rejected") continue;
      const occurredAt = commission.eventDate ?? commission.createdAt;
      if (occurredAt.getTime() < monthStart) continue;
      const revenue = estimateCommissionRevenue(commission);
      gtvByProgram.set(
        commission.programId,
        (gtvByProgram.get(commission.programId) ?? 0) + revenue,
      );
    }

    return rows.map((program) => ({
      ...program,
      partners: partnerCounts.get(program.id) ?? 0,
      gtvMonth: Math.round((gtvByProgram.get(program.id) ?? 0) * 100) / 100,
    }));
  }

  async create(
    projectId: string,
    input: NewCommissionProgramInput,
  ): Promise<CommissionProgramRow> {
    const id = crypto.randomUUID();
    const row = {
      id,
      projectId,
      code: input.code,
      name: input.name,
      type: input.type,
      rate: input.rate,
      durationMonths: input.durationMonths ?? null,
      flatAmount: input.flatAmount ?? null,
      description: input.description ?? null,
      minPayout: input.minPayout ?? 50,
      isDefault: input.isDefault ?? false,
      payoutCadence: input.payoutCadence ?? null,
      payoutDayOfMonth: input.payoutDayOfMonth ?? null,
      payoutDayOfWeek: input.payoutDayOfWeek ?? null,
      payoutOrdinal: input.payoutOrdinal ?? null,
    };
    await this.db.insert(commissionPrograms).values(row);
    const inserted = await this.db
      .select()
      .from(commissionPrograms)
      .where(eq(commissionPrograms.id, id))
      .limit(1);
    return inserted[0];
  }

  async update(
    projectId: string,
    id: string,
    input: UpdateCommissionProgramInput,
  ): Promise<CommissionProgramRow | null> {
    const updates: Record<string, unknown> = {};
    if (input.code !== undefined) updates.code = input.code;
    if (input.name !== undefined) updates.name = input.name;
    if (input.type !== undefined) updates.type = input.type;
    if (input.rate !== undefined) updates.rate = input.rate;
    if (input.durationMonths !== undefined)
      updates.durationMonths = input.durationMonths;
    if (input.flatAmount !== undefined) updates.flatAmount = input.flatAmount;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.minPayout !== undefined) updates.minPayout = input.minPayout;
    if (input.isDefault !== undefined) updates.isDefault = input.isDefault;
    if (input.payoutCadence !== undefined)
      updates.payoutCadence = input.payoutCadence;
    if (input.payoutDayOfMonth !== undefined)
      updates.payoutDayOfMonth = input.payoutDayOfMonth;
    if (input.payoutDayOfWeek !== undefined)
      updates.payoutDayOfWeek = input.payoutDayOfWeek;
    if (input.payoutOrdinal !== undefined)
      updates.payoutOrdinal = input.payoutOrdinal;

    if (Object.keys(updates).length === 0) {
      const rows = await this.db
        .select()
        .from(commissionPrograms)
        .where(
          and(
            eq(commissionPrograms.projectId, projectId),
            eq(commissionPrograms.id, id),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }

    await this.db
      .update(commissionPrograms)
      .set(updates)
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          eq(commissionPrograms.id, id),
        ),
      );

    const rows = await this.db
      .select()
      .from(commissionPrograms)
      .where(eq(commissionPrograms.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async archive(projectId: string, id: string): Promise<void> {
    await this.db
      .update(commissionPrograms)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(commissionPrograms.projectId, projectId),
          eq(commissionPrograms.id, id),
        ),
      );
  }
}

export interface NewCouponInput {
  code: string;
  partnerId: string;
  commissionProgramId?: string | null;
  customerDiscount?: string | null;
  stripeCoupon?: string | null;
}

export interface CouponWithPartner extends CouponRow {
  partnerName: string;
  partnerEmail: string;
}

export class CouponService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async list(projectId: string): Promise<CouponWithPartner[]> {
    const rows = await this.db
      .select({
        coupon: coupons,
        partnerName: partners.name,
        partnerEmail: partners.email,
      })
      .from(coupons)
      .innerJoin(partners, eq(coupons.partnerId, partners.id))
      .where(eq(coupons.projectId, projectId))
      .orderBy(desc(coupons.createdAt));

    return rows.map((r) => ({
      ...r.coupon,
      partnerName: r.partnerName,
      partnerEmail: r.partnerEmail,
    }));
  }

  async create(
    projectId: string,
    input: NewCouponInput,
  ): Promise<CouponRow> {
    const id = crypto.randomUUID();
    await this.db.insert(coupons).values({
      id,
      projectId,
      partnerId: input.partnerId,
      commissionProgramId: input.commissionProgramId ?? null,
      code: input.code,
      customerDiscount: input.customerDiscount ?? null,
      stripeCoupon: input.stripeCoupon ?? null,
    });
    const rows = await this.db
      .select()
      .from(coupons)
      .where(eq(coupons.id, id))
      .limit(1);
    return rows[0];
  }

  async delete(projectId: string, id: string): Promise<void> {
    await this.db
      .delete(coupons)
      .where(and(eq(coupons.projectId, projectId), eq(coupons.id, id)));
  }

  async incrementRedemption(
    projectId: string,
    code: string,
    mrrAdded = 0,
  ): Promise<void> {
    await this.recordAttribution(projectId, code, crypto.randomUUID(), mrrAdded);
  }

  async recordAttribution(
    projectId: string,
    code: string,
    externalRedemptionId: string,
    amount = 0,
  ): Promise<void> {
    const couponRows = await this.db
      .select({ id: coupons.id })
      .from(coupons)
      .where(and(eq(coupons.projectId, projectId), eq(coupons.code, code)))
      .limit(1);
    const coupon = couponRows[0];
    if (!coupon) return;

    await this.db
      .update(coupons)
      .set({
        mrrAttributed: sql`${coupons.mrrAttributed} + ${amount}`,
      })
      .where(eq(coupons.id, coupon.id));

    const existing = await this.db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, coupon.id),
          eq(couponRedemptions.externalRedemptionId, externalRedemptionId),
        ),
      )
      .limit(1);
    if (existing[0]) return;

    await this.db.insert(couponRedemptions).values({
      id: crypto.randomUUID(),
      projectId,
      couponId: coupon.id,
      externalRedemptionId,
      amount,
    });
    await this.db
      .update(coupons)
      .set({
        redemptions: sql`${coupons.redemptions} + 1`,
      })
      .where(eq(coupons.id, coupon.id));
  }
}
