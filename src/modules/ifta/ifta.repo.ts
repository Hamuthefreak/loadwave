import type { PrismaClient } from '@prisma/client';
import { d, toDb, type Decimal } from '../../utils/decimal';
import type { RouteGeometryService } from '../postgis/postgis.service';
import type { FuelService } from '../fuel/fuel.service';
import type { JurisdictionTotals, IftaSummaryRow } from './ifta.policy';

export interface IftaPeriod {
  tenantId: string;
  assetId: string | null;
  start: Date;
  end: Date;
}

export interface IftaSummaryView {
  id: string;
  tenantId: string;
  quarter: string;
  assetId: string | null;
  fuelType: string;
  jurisdictionCode: string;
  totalKm: string;
  taxableKm: string;
  litresPurchased: string;
  litresConsumed: string;
  averageConsumption: string;
  netLitres: string;
  jurisdictionRate: string;
  netTaxDueBase: string;
  status: string;
}

export interface IftaRepo {
  getTotals(input: IftaPeriod): Promise<JurisdictionTotals[]>;
  hasRoutePoints(input: IftaPeriod): Promise<boolean>;
  hasFuel(input: IftaPeriod): Promise<boolean>;
  hasSegmentsInPeriod(input: IftaPeriod): Promise<boolean>;
  ensureSegments(input: IftaPeriod): Promise<void>;
  persistSummaries(rows: IftaSummaryRow[]): Promise<number>;
  listSummaries(
    tenantId: string,
    filters?: { quarter?: string; assetId?: string; status?: string },
  ): Promise<IftaSummaryView[]>;
}

interface SummaryDbRow {
  id: string;
  tenantId: string;
  quarter: string;
  assetId: string | null;
  fuelType: string;
  jurisdictionCode: string;
  totalKm: Decimal;
  taxableKm: Decimal;
  litresPurchased: Decimal;
  litresConsumed: Decimal;
  averageConsumption: Decimal;
  netLitres: Decimal;
  jurisdictionRate: Decimal;
  netTaxDueBase: Decimal;
  status: string;
}

interface CountRow {
  cnt: number;
}

export class PrismaIftaRepo implements IftaRepo {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geometry: RouteGeometryService,
    private readonly fuel: FuelService,
  ) {}

  async getTotals(input: IftaPeriod): Promise<JurisdictionTotals[]> {
    const kmRows = await this.geometry.aggregateDistanceByJurisdiction({
      tenantId: input.tenantId,
      assetId: input.assetId,
      start: input.start,
      windowEnd: input.end,
    });
    const fuelRows = await this.fuel.aggregateByJurisdiction({
      tenantId: input.tenantId,
      assetId: input.assetId,
      start: input.start,
      windowEnd: input.end,
    });

    const byCode = new Map<string, JurisdictionTotals>();
    for (const km of kmRows) {
      byCode.set(km.jurisdictionCode, {
        jurisdictionCode: km.jurisdictionCode,
        totalKm: d(km.totalKm),
        taxableKm: d(km.totalKm),
        litresPurchased: d(0),
      });
    }
    for (const fr of fuelRows) {
      const existing = byCode.get(fr.jurisdictionCode);
      if (existing) {
        existing.litresPurchased = existing.litresPurchased.plus(d(fr.litres));
      } else {
        byCode.set(fr.jurisdictionCode, {
          jurisdictionCode: fr.jurisdictionCode,
          totalKm: d(0),
          taxableKm: d(0),
          litresPurchased: d(fr.litres),
        });
      }
    }
    return [...byCode.values()].sort((a, b) => a.jurisdictionCode.localeCompare(b.jurisdictionCode));
  }

  async hasRoutePoints(input: IftaPeriod): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::int AS cnt FROM "RoutePoint"
        WHERE "tenantId" = $1
          AND ($2::text IS NULL OR "assetId" = $2)
          AND "occurredAt" >= $3 AND "occurredAt" < $4`,
      input.tenantId,
      input.assetId,
      input.start.toISOString(),
      input.end.toISOString(),
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  async hasFuel(input: IftaPeriod): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::int AS cnt FROM "FuelTransaction"
        WHERE "tenantId" = $1
          AND ($2::text IS NULL OR "assetId" = $2)
          AND "occurredAt" >= $3 AND "occurredAt" < $4`,
      input.tenantId,
      input.assetId,
      input.start.toISOString(),
      input.end.toISOString(),
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  async hasSegmentsInPeriod(input: IftaPeriod): Promise<boolean> {
    return this.geometry.hasSegmentsInPeriod({
      tenantId: input.tenantId,
      assetId: input.assetId,
      start: input.start,
      windowEnd: input.end,
    });
  }

  async ensureSegments(input: IftaPeriod): Promise<void> {
    const has = await this.geometry.hasSegmentsInPeriod({
      tenantId: input.tenantId,
      assetId: input.assetId,
      start: input.start,
      windowEnd: input.end,
    });
    if (has) return;
    await this.geometry.buildSegmentsForPeriod({
      tenantId: input.tenantId,
      assetId: input.assetId,
      start: input.start,
      windowEnd: input.end,
      gapMinutes: 15,
    });
  }

  async persistSummaries(rows: IftaSummaryRow[]): Promise<number> {
    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const where = {
          tenantId: row.tenantId,
          quarter: row.quarter,
          assetId: row.assetId,
          fuelType: row.fuelType,
          jurisdictionCode: row.jurisdictionCode,
        };
        const existing = await tx.iftaQuarterSummary.findFirst({ where });
        if (existing) {
          await tx.iftaQuarterSummary.update({
            where: { id: existing.id },
            data: {
              totalKm: toDb(row.totalKm),
              taxableKm: toDb(row.taxableKm),
              litresPurchased: toDb(row.litresPurchased),
              litresConsumed: toDb(row.litresConsumed),
              averageConsumption: toDb(row.averageConsumption),
              netLitres: toDb(row.netLitres),
              jurisdictionRate: toDb(row.jurisdictionRate),
              netTaxDueBase: toDb(row.netTaxDueBase),
              status: 'DRAFT',
            },
          });
        } else {
          await tx.iftaQuarterSummary.create({
            data: {
              ...where,
              totalKm: toDb(row.totalKm),
              taxableKm: toDb(row.taxableKm),
              litresPurchased: toDb(row.litresPurchased),
              litresConsumed: toDb(row.litresConsumed),
              averageConsumption: toDb(row.averageConsumption),
              netLitres: toDb(row.netLitres),
              jurisdictionRate: toDb(row.jurisdictionRate),
              netTaxDueBase: toDb(row.netTaxDueBase),
              status: 'DRAFT',
            },
          });
          created += 1;
        }
      }
    });
    return created;
  }

  async listSummaries(
    tenantId: string,
    filters?: { quarter?: string; assetId?: string; status?: string },
  ): Promise<IftaSummaryView[]> {
    const rows = await this.prisma.iftaQuarterSummary.findMany({
      where: {
        tenantId,
        ...(filters?.quarter ? { quarter: filters.quarter } : {}),
        ...(filters?.assetId ? { assetId: filters.assetId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: [{ quarter: 'desc' }, { jurisdictionCode: 'asc' }],
      take: 500,
    });
    return (rows as unknown as SummaryDbRow[]).map((r) => this.mapView(r));
  }

  private mapView(row: SummaryDbRow): IftaSummaryView {
    return {
      id: row.id,
      tenantId: row.tenantId,
      quarter: row.quarter,
      assetId: row.assetId,
      fuelType: row.fuelType,
      jurisdictionCode: row.jurisdictionCode,
      totalKm: toDb(d(row.totalKm)),
      taxableKm: toDb(d(row.taxableKm)),
      litresPurchased: toDb(d(row.litresPurchased)),
      litresConsumed: toDb(d(row.litresConsumed)),
      averageConsumption: toDb(d(row.averageConsumption)),
      netLitres: toDb(d(row.netLitres)),
      jurisdictionRate: toDb(d(row.jurisdictionRate)),
      netTaxDueBase: toDb(d(row.netTaxDueBase)),
      status: row.status,
    };
  }
}
