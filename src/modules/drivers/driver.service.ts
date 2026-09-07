import type { PrismaClient, CycleType } from '@prisma/client';
import { notFound } from '../../utils/errors';

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
}

export interface DriverCreateInput {
  externalEldId?: string | null;
  name: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
}

export interface DriverUpdateInput {
  name?: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
  status?: string;
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
    const row = await this.prisma.driver.create({
      data: {
        tenantId,
        externalEldId: input.externalEldId ?? null,
        name: input.name,
        licenseNumber: input.licenseNumber ?? null,
        homeTerminalTz: input.homeTerminalTz ?? 'America/Toronto',
        cycleType: input.cycleType ?? 'CYCLE_1',
      },
    });
    return this.map(row);
  }

  async update(tenantId: string, driverId: string, input: DriverUpdateInput): Promise<DriverRow> {
    const existing = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!existing) throw notFound('driver not found');
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
      ...(input.homeTerminalTz !== undefined ? { homeTerminalTz: input.homeTerminalTz } : {}),
      ...(input.cycleType !== undefined ? { cycleType: input.cycleType } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
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
