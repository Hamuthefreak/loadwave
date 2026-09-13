import type { PrismaClient, CycleType } from '@prisma/client';
import { badRequest, notFound } from '../../utils/errors';
import { isPayModel, isValidTimezone } from '../settlements/settlement.policy';

/**
 * An unrecognised zone would otherwise reach `Intl.DateTimeFormat` at HOS and
 * payroll time and throw, so it is rejected where the dispatcher can fix it.
 */
function assertTimezone(tz: string | undefined): void {
  if (tz !== undefined && !isValidTimezone(tz)) {
    throw badRequest(`unknown timezone "${tz}" — use an IANA name such as America/Toronto`);
  }
}

export interface DriverRow {
  id: string;
  tenantId: string;
  externalEldId: string | null;
  name: string;
  licenseNumber: string | null;
  homeTerminalTz: string;
  cycleType: CycleType;
  status: string;
  createdAt: string;
  /** PER_MILE | PERCENT_REVENUE | FLAT_PER_LOAD, or null for an owner-operator. */
  payModel: string | null;
  payRate: number | null;
}

export interface DriverCreateInput {
  externalEldId?: string | null;
  name: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
  payModel?: string | null;
  payRate?: number | null;
}

export interface DriverUpdateInput {
  name?: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
  status?: string;
  payModel?: string | null;
  payRate?: number | null;
}

export interface DriverScorecard {
  driverId: string;
  deliveredCount: number;
  onTimeCount: number;
  onTimePct: number | null;
  litresLogged: number;
  fuelSpendBase: number;
  detentionMinutes: number;
  lastDeliveredAt: string | null;
}

export interface DriverService {
  list(tenantId: string): Promise<DriverRow[]>;
  get(tenantId: string, driverId: string): Promise<DriverRow>;
  create(tenantId: string, input: DriverCreateInput): Promise<DriverRow>;
  update(tenantId: string, driverId: string, input: DriverUpdateInput): Promise<DriverRow>;
  /** Performance snapshot (last 180 days) for the ops Drivers page. */
  scorecards(tenantId: string): Promise<DriverScorecard[]>;
}

/**
 * A pay profile is all-or-nothing. Passing `null` for the model is how a carrier
 * says "this driver is an owner-operator who keeps the revenue" — a legitimate
 * state, and different from a half-filled form.
 */
export function assertPayProfile(
  model: string | null,
  rate: number | null,
  previousModel: string | null,
): { payModel: string | null; payRate: number | null } {
  if (model == null) {
    if (rate == null) return { payModel: null, payRate: null };
    // A rate with no model: keep the model already on file when there is one.
    if (previousModel && isPayModel(previousModel)) return { payModel: previousModel, payRate: rate };
    throw badRequest('a pay model is required when a pay rate is set');
  }
  if (!isPayModel(model)) throw badRequest('unknown pay model');
  if (rate == null) throw badRequest('a pay rate is required when a pay model is set');
  if (!Number.isFinite(rate) || rate < 0) throw badRequest('the pay rate must be zero or more');
  if (model === 'PERCENT_REVENUE' && rate > 100) throw badRequest('a revenue share cannot exceed 100%');
  return { payModel: model, payRate: rate };
}

export class PrismaDriverService implements DriverService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: {
    id: string;
    tenantId: string;
    externalEldId: string | null;
    name: string;
    licenseNumber: string | null;
    homeTerminalTz: string;
    cycleType: CycleType;
    status: string;
    createdAt: Date;
    payModel: string | null;
    payRate: unknown;
  }): DriverRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      externalEldId: row.externalEldId,
      name: row.name,
      licenseNumber: row.licenseNumber,
      homeTerminalTz: row.homeTerminalTz,
      cycleType: row.cycleType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      payModel: row.payModel,
      payRate: row.payRate == null ? null : Number(row.payRate),
    };
  }

  async list(tenantId: string): Promise<DriverRow[]> {
    const rows = await this.prisma.driver.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.map(r));
  }

  async scorecards(tenantId: string): Promise<DriverScorecard[]> {
    const drivers = await this.prisma.driver.findMany({
      where: { tenantId },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const ids = drivers.map((d) => d.id);
    if (ids.length === 0) return [];

    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const [delivered, fuel, detentions] = await Promise.all([
      this.prisma.load.findMany({
        where: { tenantId, assigneeDriverId: { in: ids }, status: { in: ['DELIVERED', 'INVOICED'] }, deliveredAt: { gte: since } },
        select: { assigneeDriverId: true, deliveryDate: true, deliveredAt: true },
      }),
      this.prisma.fuelTransaction.groupBy({
        by: ['driverId'],
        where: { tenantId, driverId: { in: ids } },
        _sum: { volumeLitres: true, amountBase: true },
      }),
      this.prisma.detentionEntry.findMany({
        where: { tenantId, driverId: { in: ids } },
        select: { driverId: true, startedAt: true, endedAt: true },
      }),
    ]);

    const byDriver = new Map(ids.map((id) => [id, {
      deliveredCount: 0,
      onTimeCount: 0,
      lastDeliveredAt: null as string | null,
      litresLogged: 0,
      fuelSpendBase: 0,
      detentionMinutes: 0,
    }]));

    for (const l of delivered) {
      if (!l.assigneeDriverId) continue;
      const cur = byDriver.get(l.assigneeDriverId);
      if (!cur) continue;
      cur.deliveredCount += 1;
      // On time = delivered within 24h of the promised date.
      if (l.deliveryDate && l.deliveredAt && l.deliveredAt.getTime() <= l.deliveryDate.getTime() + 24 * 60 * 60 * 1000) {
        cur.onTimeCount += 1;
      }
      if (l.deliveredAt && (!cur.lastDeliveredAt || l.deliveredAt.toISOString() > cur.lastDeliveredAt)) {
        cur.lastDeliveredAt = l.deliveredAt.toISOString();
      }
    }
    for (const f of fuel) {
      if (!f.driverId) continue;
      const cur = byDriver.get(f.driverId);
      if (!cur) continue;
      cur.litresLogged = Number(f._sum.volumeLitres ?? 0);
      cur.fuelSpendBase = Number(f._sum.amountBase ?? 0);
    }
    const now = Date.now();
    for (const e of detentions) {
      if (!e.driverId) continue;
      const cur = byDriver.get(e.driverId);
      if (!cur) continue;
      cur.detentionMinutes += Math.max(0, Math.round(((e.endedAt ?? new Date(now)).getTime() - e.startedAt.getTime()) / 60_000));
    }

    return ids.map((driverId) => {
      const s = byDriver.get(driverId)!;
      return {
        driverId,
        ...s,
        onTimePct: s.deliveredCount > 0 ? Math.round((s.onTimeCount / s.deliveredCount) * 100) : null,
      };
    });
  }

  async get(tenantId: string, driverId: string): Promise<DriverRow> {
    const row = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!row) throw notFound('driver not found');
    return this.map(row);
  }

  async create(tenantId: string, input: DriverCreateInput): Promise<DriverRow> {
    assertTimezone(input.homeTerminalTz);
    const profile = assertPayProfile(input.payModel ?? null, input.payRate ?? null, null);
    const row = await this.prisma.driver.create({
      data: {
        tenantId,
        externalEldId: input.externalEldId ?? null,
        name: input.name,
        licenseNumber: input.licenseNumber ?? null,
        homeTerminalTz: input.homeTerminalTz ?? 'America/Toronto',
        cycleType: input.cycleType ?? 'CYCLE_1',
        payModel: profile.payModel,
        payRate: profile.payRate,
      },
    });
    return this.map(row);
  }

  async update(tenantId: string, driverId: string, input: DriverUpdateInput): Promise<DriverRow> {
    const existing = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!existing) throw notFound('driver not found');
    assertTimezone(input.homeTerminalTz);

    // The profile is patched as a pair: a new model keeps the stored rate, a new
    // rate keeps the stored model, and an explicit null clears both. Validated
    // after the merge so a model can never be saved without a rate (or vice
    // versa) — which would otherwise silently pay $0.00 for real hauls.
    const profileTouched = input.payModel !== undefined || input.payRate !== undefined;
    let profile: { payModel: string | null; payRate: number | null } | null = null;
    if (profileTouched) {
      const merged = assertPayProfile(
        input.payModel !== undefined ? input.payModel : existing.payModel,
        input.payRate !== undefined ? input.payRate : (existing.payRate == null ? null : Number(existing.payRate)),
        existing.payModel,
      );
      profile = merged;
    }

    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
      ...(input.homeTerminalTz !== undefined ? { homeTerminalTz: input.homeTerminalTz } : {}),
      ...(input.cycleType !== undefined ? { cycleType: input.cycleType } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(profile ? { payModel: profile.payModel, payRate: profile.payRate } : {}),
    };

    // Duty transitions are recorded on the driver's HOS log so the daily log
    // and the cycle hours card are backed by real segments: leaving ACTIVE
    // closes the current segment; entering ACTIVE opens an on-duty one.
    const statusChanged = input.status !== undefined && input.status !== existing.status;
    if (!statusChanged) {
      const row = await this.prisma.driver.update({ where: { id: driverId }, data });
      return this.map(row);
    }

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver.update({ where: { id: driverId }, data });
      const open = await tx.hosLog.findFirst({
        where: { tenantId, driverId, endTime: null },
        orderBy: { startTime: 'desc' },
      });
      if (open) {
        await tx.hosLog.update({ where: { id: open.id }, data: { endTime: now } });
      }
      await tx.hosLog.create({
        data: {
          tenantId,
          driverId,
          dutyStatus: input.status === 'ACTIVE' ? 'ON_DUTY_NOT_DRIVING' : 'OFF_DUTY',
          startTime: now,
          ingestSource: 'MANUAL',
        },
      });
      return updated;
    });
    return this.map(row);
  }
}
