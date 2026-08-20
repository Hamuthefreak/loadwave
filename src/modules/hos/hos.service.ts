import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import { evaluateCycle, type CycleComputed, type CycleType, type HosSegment } from './hos.policy';

export interface HosStatusRow {
  tenantId: string;
  driverId: string;
  status: string;
  segments: number;
}

export interface HosService {
  getStatus(tenantId: string, driverId: string, asOf?: Date): Promise<CycleComputed & HosStatusRow>;
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
}
