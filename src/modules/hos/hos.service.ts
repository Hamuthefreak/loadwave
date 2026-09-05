import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import { evaluateCycle, type CycleComputed, type CycleType, type HosSegment } from './hos.policy';

export interface HosStatusRow {
  tenantId: string;
  driverId: string;
  status: string;
  segments: number;
}

export interface HosOverviewRow {
  driverId: string;
  cycleType: CycleType;
  onDutyHours7: number;
  remaining7: number | null;
  limit7: number | null;
  onDutyHours14: number;
  remaining14: number | null;
  limit14: number | null;
  has24hOffIn14: boolean;
  resetRequiresHours: number;
  warnings: string[];
  violations: string[];
}

export interface HosService {
  getStatus(tenantId: string, driverId: string, asOf?: Date): Promise<CycleComputed & HosStatusRow>;
  // Batched cycle snapshot for every driver in the fleet (Drivers page pills).
  overview(tenantId: string, asOf?: Date): Promise<HosOverviewRow[]>;
}

const DAY = 24 * 3_600_000;

export class PrismaHosService implements HosService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStatus(
    tenantId: string,
    driverId: string,
    asOf: Date = new Date(),
  ): Promise<CycleComputed & HosStatusRow> {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!driver) throw notFound('driver not found');

    const since = new Date(asOf.getTime() - 14 * DAY);
    const logs = await this.prisma.hosLog.findMany({
      where: { tenantId, driverId, startTime: { gte: since } },
      orderBy: { startTime: 'asc' },
    });

    const segments: HosSegment[] = logs.map((l) => ({
      startTime: l.startTime,
      endTime: l.endTime,
      dutyStatus: l.dutyStatus,
    }));

    const cycle = evaluateCycle(driver.cycleType as CycleType, segments, asOf);
    return {
      ...cycle,
      tenantId,
      driverId,
      status: driver.status,
      segments: segments.length,
    };
  }

  async overview(tenantId: string, asOf: Date = new Date()): Promise<HosOverviewRow[]> {
    const drivers = await this.prisma.driver.findMany({
      where: { tenantId },
      select: { id: true, cycleType: true },
    });
    if (drivers.length === 0) return [];

    const since = new Date(asOf.getTime() - 14 * DAY);
    const logs = await this.prisma.hosLog.findMany({
      where: {
        tenantId,
        driverId: { in: drivers.map((d) => d.id) },
        startTime: { gte: since },
      },
      select: { driverId: true, startTime: true, endTime: true, dutyStatus: true },
      orderBy: { startTime: 'asc' },
    });

    const byDriver = new Map<string, HosSegment[]>();
    for (const l of logs) {
      const list = byDriver.get(l.driverId) ?? [];
      list.push({ startTime: l.startTime, endTime: l.endTime, dutyStatus: l.dutyStatus });
      byDriver.set(l.driverId, list);
    }

    return drivers.map((d) => {
      const cycle = evaluateCycle(d.cycleType as CycleType, byDriver.get(d.id) ?? [], asOf);
      return {
        driverId: d.id,
        cycleType: cycle.cycleType,
        onDutyHours7: cycle.onDutyHours7,
        remaining7: cycle.remaining7,
        limit7: cycle.limit7,
        onDutyHours14: cycle.onDutyHours14,
        remaining14: cycle.remaining14,
        limit14: cycle.limit14,
        has24hOffIn14: cycle.has24hOffIn14,
        resetRequiresHours: cycle.resetRequiresHours,
        warnings: cycle.warnings,
        violations: cycle.violations,
      };
    });
  }
}
