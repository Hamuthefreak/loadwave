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

export interface HosDaySegment {
  dutyStatus: string;
  startTime: string;
  endTime: string | null;
}

export interface HosDayRow {
  /** Local calendar date in the driver's home-terminal timezone. */
  date: string;
  onDutyMinutes: number;
  offDutyMinutes: number;
  segments: HosDaySegment[];
}

export interface HosDailyLogRow {
  driverId: string;
  timezone: string;
  days: HosDayRow[];
}

export interface HosService {
  getStatus(tenantId: string, driverId: string, asOf?: Date): Promise<CycleComputed & HosStatusRow>;
  // Batched cycle snapshot for every driver in the fleet (Drivers page pills).
  overview(tenantId: string, asOf?: Date): Promise<HosOverviewRow[]>;
  // Per-day duty log for the driver dashboard (last `days` calendar days in
  // the driver's home timezone).
  dailyLog(tenantId: string, driverId: string, days?: number, asOf?: Date): Promise<HosDailyLogRow>;
}

const DAY = 24 * 3_600_000;

const ON_DUTY_STATUSES = new Set(['ON_DUTY_NOT_DRIVING', 'DRIVING']);

/** "YYYY-MM-DD" for a moment, rendered in the given IANA timezone. */
function localDate(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** UTC midnight (ms) of a local calendar date in the given timezone. */
function dayAnchor(tz: string, at: Date): number {
  const [y, m, d] = localDate(tz, at).split('-').map(Number);
  // Offset of the tz at local noon (DST-safe); local midnight in UTC = that
  // date at 00:00 local, expressed as a UTC instant.
  const offset = tzOffsetMs(tz, new Date(Date.UTC(y, m - 1, d, 12)));
  return Date.UTC(y, m - 1, d) - offset;
}

/** Offset (ms) of the given IANA timezone at a moment, east of UTC. */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - at.getTime();
}

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

  async dailyLog(tenantId: string, driverId: string, days = 7, asOf: Date = new Date()): Promise<HosDailyLogRow> {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!driver) throw notFound('driver not found');

    const tz = driver.homeTerminalTz;
    const now = asOf;
    const anchor = dayAnchor(tz, now);
    const from = new Date(anchor - (days - 1) * DAY);

    const logs = await this.prisma.hosLog.findMany({
      where: { tenantId, driverId, startTime: { gte: from } },
      orderBy: { startTime: 'asc' },
    });

    const dayRows: HosDayRow[] = [];
    // Newest calendar day first, like a logbook read top-to-bottom.
    for (let i = 0; i < days; i++) {
      const dayStart = anchor - i * DAY;
      const dayEnd = dayStart + DAY;
      let onDutyMinutes = 0;
      let offDutyMinutes = 0;
      const segments: HosDaySegment[] = [];

      for (const l of logs) {
        const stillOpen = l.endTime === null;
        const segStart = l.startTime.getTime();
        const segEnd = stillOpen ? now.getTime() : (l.endTime as Date).getTime();
        const overlapStart = Math.max(segStart, dayStart);
        const overlapEnd = Math.min(segEnd, dayEnd);
        if (overlapEnd <= overlapStart) continue;
        const minutes = (overlapEnd - overlapStart) / 60_000;
        if (ON_DUTY_STATUSES.has(l.dutyStatus)) onDutyMinutes += minutes;
        else offDutyMinutes += minutes;
        if (segStart < dayEnd && segEnd > dayStart) {
          segments.push({
            dutyStatus: l.dutyStatus,
            startTime: new Date(Math.max(segStart, dayStart)).toISOString(),
            // An in-progress segment stays open; a segment running past
            // midnight is clamped to the day it started.
            endTime: stillOpen || segEnd >= dayEnd ? null : new Date(segEnd).toISOString(),
          });
        }
      }

      // dayStart is UTC-midnight of the local date, so formatting it in the
      // driver's timezone yields exactly that local calendar date.
      dayRows.push({
        date: localDate(tz, new Date(dayStart)),
        onDutyMinutes: Math.round(onDutyMinutes),
        offDutyMinutes: Math.round(offDutyMinutes),
        segments,
      });
    }

    return { driverId, timezone: tz, days: dayRows };
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
