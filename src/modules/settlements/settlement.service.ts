import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import {
  buildStatement,
  DEFAULT_TIMEZONE,
  kmToMiles,
  payProfileOf,
  rollupStatements,
  safeTimezone,
  yearToDatePeriod,
  type PayLoadInput,
  type SettlementPeriod,
  type Statement,
} from './settlement.policy';

/**
 * Distances are stored to four decimal places of a kilometre and converted
 * here. Rounding to a tenth of a mile before pricing is deliberate: it is the
 * precision dispatch quotes and the driver checks against their own log, and
 * the difference is a few cents on a 500-mile run.
 */
function milesFromKm(km: unknown): number | null {
  if (km == null) return null;
  const value = Number(km);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(kmToMiles(value) * 10) / 10;
}

export interface SettlementTotalsView {
  drivers: number;
  payableDrivers: number;
  loads: number;
  unpricedLoads: number;
  miles: number;
  detentionHours: number;
  revenueCents: number;
  payCents: number;
  detentionCents: number;
  totalPayCents: number;
  marginCents: number;
  effectivePayPerMileCents: number | null;
}

export interface SettlementOverview {
  period: { from: string; to: string; label: string };
  drivers: Statement[];
  totals: SettlementTotalsView;
}

export interface SettlementService {
  /** The whole fleet for one pay period — what a payroll run reads off. */
  overview(tenantId: string, period: SettlementPeriod): Promise<SettlementOverview>;
  /** One driver's statement, for the ops drill-down. */
  forDriver(tenantId: string, driverId: string, period: SettlementPeriod): Promise<Statement>;
  /** What the driver themselves sees: this period plus the year to date. */
  forSelf(
    tenantId: string,
    driverId: string,
    period: SettlementPeriod,
  ): Promise<{ period: { from: string; to: string; label: string }; statement: Statement; yearToDate: Statement }>;
  /** The home terminal a driver's pay week is cut against. */
  driverTimezone(tenantId: string, driverId: string): Promise<string>;
  /** Fleet default: the home terminal most of the drivers share. */
  tenantTimezone(tenantId: string): Promise<string>;
}

export class PrismaSettlementService implements SettlementService {
  constructor(private readonly prisma: PrismaClient) {}

  private async driversOf(tenantId: string, only?: string) {
    return this.prisma.driver.findMany({
      where: { tenantId, ...(only ? { id: only } : {}) },
      select: { id: true, name: true, homeTerminalTz: true, payModel: true, payRate: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Delivered work in the window, priced from the driver's own profile. */
  private async loadInputs(
    tenantId: string,
    driverIds: string[],
    period: SettlementPeriod,
  ): Promise<Map<string, { loads: PayLoadInput[]; openDetention: number }>> {
    const byDriver = new Map(driverIds.map((id) => [id, { loads: [] as PayLoadInput[], openDetention: 0 }]));
    if (driverIds.length === 0) return byDriver;

    const loads = await this.prisma.load.findMany({
      where: {
        tenantId,
        assigneeDriverId: { in: driverIds },
        status: { in: ['DELIVERED', 'INVOICED'] },
        deliveredAt: { gte: period.from, lt: period.to },
      },
      select: {
        id: true,
        externalLoadboardId: true,
        originRegion: true,
        destinationRegion: true,
        deliveredAt: true,
        distanceKmEstimate: true,
        freightAmountBase: true,
        detentionRate: true,
        assigneeDriverId: true,
        detentions: { select: { startedAt: true, endedAt: true, ratePerHour: true } },
      },
      orderBy: { deliveredAt: 'asc' },
    });

    for (const load of loads) {
      const key = load.assigneeDriverId;
      if (!key) continue;
      const bucket = byDriver.get(key);
      if (!bucket) continue;

      // Only closed detention is payable: you cannot settle time that has not
      // stopped yet. An open timer is counted so the statement can say so
      // rather than quietly underpaying.
      let hours = 0;
      let rate: number | null = load.detentionRate == null ? null : Number(load.detentionRate);
      for (const entry of load.detentions) {
        if (!entry.endedAt) {
          bucket.openDetention += 1;
          continue;
        }
        const ms = Math.max(0, entry.endedAt.getTime() - entry.startedAt.getTime());
        hours += ms / 3_600_000;
        if (entry.ratePerHour != null) rate = Number(entry.ratePerHour);
      }

      bucket.loads.push({
        id: load.id,
        reference: load.externalLoadboardId ?? load.id.slice(0, 8).toUpperCase(),
        originRegion: load.originRegion,
        destinationRegion: load.destinationRegion,
        deliveredAt: load.deliveredAt,
        distanceMiles: milesFromKm(load.distanceKmEstimate),
        revenueBase: load.freightAmountBase == null ? null : Number(load.freightAmountBase),
        detentionHours: Math.round(hours * 100) / 100,
        detentionRate: rate,
      });
    }
    return byDriver;
  }

  private async statementsFor(
    tenantId: string,
    period: SettlementPeriod,
    only?: string,
  ): Promise<Statement[]> {
    const drivers = await this.driversOf(tenantId, only);
    const byDriver = await this.loadInputs(tenantId, drivers.map((d) => d.id), period);

    return drivers.map((driver) => {
      const bucket = byDriver.get(driver.id) ?? { loads: [], openDetention: 0 };
      const statement = buildStatement({
        driverId: driver.id,
        driverName: driver.name,
        profile: payProfileOf(driver.payModel, driver.payRate),
        loads: bucket.loads,
        from: period.from,
        to: period.to,
        label: period.label,
      });
      const openCount = bucket.openDetention;
      if (openCount > 0) {
        statement.notes.push(
          `${openCount} load${openCount === 1 ? ' has' : 's have'} a detention timer still running — those hours are not included until it is stopped.`,
        );
      }
      return statement;
    });
  }

  async driverTimezone(tenantId: string, driverId: string): Promise<string> {
    const row = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId },
      select: { homeTerminalTz: true },
    });
    return safeTimezone(row?.homeTerminalTz);
  }

  /**
   * No tenant-level timezone column exists, so the fleet's pay week follows the
   * home terminal most of its drivers share. A carrier with one terminal (the
   * common case) gets that terminal exactly.
   */
  async tenantTimezone(tenantId: string): Promise<string> {
    const rows = await this.prisma.driver.groupBy({
      by: ['homeTerminalTz'],
      where: { tenantId },
      _count: { _all: true },
    });
    if (rows.length === 0) return DEFAULT_TIMEZONE;
    const [top] = [...rows].sort((a, b) => b._count._all - a._count._all);
    return safeTimezone(top.homeTerminalTz);
  }

  async overview(tenantId: string, period: SettlementPeriod): Promise<SettlementOverview> {
    const drivers = await this.statementsFor(tenantId, period);
    // Biggest cheque first: it is the one a payroll run reconciles by hand.
    drivers.sort((a, b) => b.totals.totalPayCents - a.totals.totalPayCents);
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
      drivers,
      totals: rollupStatements(drivers),
    };
  }

  async forDriver(tenantId: string, driverId: string, period: SettlementPeriod): Promise<Statement> {
    const found = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId }, select: { id: true } });
    if (!found) throw notFound('driver not found');
    const [statement] = await this.statementsFor(tenantId, period, driverId);
    return statement;
  }

  async forSelf(tenantId: string, driverId: string, period: SettlementPeriod) {
    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId },
      select: { id: true, homeTerminalTz: true },
    });
    if (!driver) throw notFound('driver not found');

    // Year-to-date is anchored on the same home terminal as the week, so the
    // two figures can never disagree about which year a late-December run
    // belongs to.
    const [statement] = await this.statementsFor(tenantId, period, driverId);
    const [yearToDate] = await this.statementsFor(tenantId, yearToDatePeriod(new Date(), driver.homeTerminalTz), driverId);
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
      statement,
      yearToDate,
    };
  }
}
