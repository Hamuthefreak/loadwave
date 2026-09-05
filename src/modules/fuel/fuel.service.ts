import type { PrismaClient, Prisma } from '@prisma/client';
import { d, toDb, type Decimal } from '../../utils/decimal';
import { quarterOf, quarterRange, type Quarter } from '../../utils/quarters';
import { badRequest } from '../../utils/errors';
import { EVENTS, FuelTransactionImported } from '../../events/domain-events';
import type { EventBus } from '../../events/event-bus';
import { normalizeVolumeLitres } from '../eld/eld.policy';
import type { FxService } from './fx.service';

export interface FuelTransactionInput {
  tenantId: string;
  assetId?: string | null;
  driverId?: string | null;
  occurredAt: Date | string;
  jurisdictionCode: string;
  locationLat?: number | null;
  locationLon?: number | null;
  volumeLitres?: Decimal | string | number | null;
  originalVolume?: Decimal | string | number | null;
  originalVolumeUnit?: 'L' | 'GAL' | string | null;
  transactionCurrency: 'CAD' | 'USD';
  amountTransaction: Decimal | string | number;
  exchangeRateToBase?: Decimal | string | number | null;
  taxGstRate?: Decimal | string | number | null;
  taxHstRate?: Decimal | string | number | null;
  taxQstRate?: Decimal | string | number | null;
  taxGstAmount?: Decimal | string | number | null;
  taxHstAmount?: Decimal | string | number | null;
  taxQstAmount?: Decimal | string | number | null;
  fuelType?: string;
  sourceEventId?: string | null;
}

export interface FuelTransactionRow {
  id: string;
  tenantId: string;
  assetId: string | null;
  driverId: string | null;
  occurredAt: string;
  jurisdictionCode: string;
  volumeLitres: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  transactionCurrency: string;
  amountTransaction: string;
  exchangeRateToBase: string;
  amountBase: string;
  sourceEventId: string | null;
}

export interface FuelAggregateRow {
  jurisdictionCode: string;
  litres: number;
  transactionCount: number;
}

export interface FuelPeriodFilter {
  tenantId: string;
  assetId?: string | null;
  start: Date;
  windowEnd: Date;
}

export interface FuelService {
  importOne(input: FuelTransactionInput): Promise<FuelTransactionRow>;
  importMany(inputs: FuelTransactionInput[]): Promise<FuelTransactionRow[]>;
  list(tenantId: string, filters?: { quarter?: Quarter }): Promise<FuelTransactionRow[]>;
  // Cab-side logging: a driver's own recent fuel transactions.
  listForDriver(tenantId: string, driverId: string, limit?: number): Promise<FuelTransactionRow[]>;
  // The unit (tractor) currently assigned to the driver's active trip, if any.
  resolveDriverAssetId(tenantId: string, driverId: string): Promise<string | null>;
  aggregateByJurisdiction(filter: FuelPeriodFilter): Promise<FuelAggregateRow[]>;
}

interface PersistRow {
  id: string;
  tenantId: string;
  assetId: string | null;
  driverId: string | null;
  occurredAt: Date;
  jurisdictionCode: string;
  locationLat: number | null;
  locationLon: number | null;
  volumeLitres: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  transactionCurrency: string;
  amountTransaction: string;
  exchangeRateToBase: string;
  amountBase: string;
  taxGstRate: string | null;
  taxHstRate: string | null;
  taxQstRate: string | null;
  taxGstAmount: string | null;
  taxHstAmount: string | null;
  taxQstAmount: string | null;
  fuelType: string | null;
  sourceEventId: string | null;
}

interface FuelDbRow extends PersistRow {
  occurredAt: Date;
}

interface FuelAggregateDbRow {
  jurisdictionCode: string;
  litres: string | number;
  transactionCount: number;
}

export class PrismaFuelService implements FuelService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
    private readonly fx: FxService,
  ) {}

  private map(row: FuelDbRow): FuelTransactionRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      assetId: row.assetId,
      driverId: row.driverId,
      occurredAt: row.occurredAt.toISOString(),
      jurisdictionCode: row.jurisdictionCode,
      volumeLitres: row.volumeLitres ?? '0',
      originalVolume: row.originalVolume,
      originalVolumeUnit: row.originalVolumeUnit,
      transactionCurrency: row.transactionCurrency,
      amountTransaction: row.amountTransaction,
      exchangeRateToBase: row.exchangeRateToBase,
      amountBase: row.amountBase,
      sourceEventId: row.sourceEventId,
    };
  }

  private async normalize(input: FuelTransactionInput): Promise<Omit<PersistRow, 'id'>> {
    const occurredAt = new Date(input.occurredAt);
    if (!input.amountTransaction) {
      throw badRequest('amountTransaction is required for a fuel transaction');
    }
    const { volumeLitres, originalVolume, originalVolumeUnit } = normalizeVolumeLitres(
      input.originalVolume ?? input.volumeLitres,
      input.originalVolumeUnit,
    );
    if (!volumeLitres) {
      throw badRequest('fuel transaction requires a volume (volumeLitres or originalVolume)');
    }
    const volumeLitresStr = String(volumeLitres);

    const amountTransaction = d(input.amountTransaction);
    const quarter = quarterOf(occurredAt);
    let exchangeRateToBase = input.exchangeRateToBase ? d(input.exchangeRateToBase) : d(1);

    if (input.transactionCurrency.toUpperCase() !== 'CAD') {
      exchangeRateToBase =
        (input.exchangeRateToBase ? d(input.exchangeRateToBase) : null) ??
        (await this.fx.getRateForQuarter(
          input.tenantId,
          input.transactionCurrency,
          'CAD',
          quarter,
          occurredAt,
        )) ??
        d(1);
    }

    const amountBase = amountTransaction.times(exchangeRateToBase);

    const opt = (v: Decimal | string | number | null | undefined): string | null =>
      v === null || v === undefined || v === '' ? null : toDb(d(v as Decimal | string | number));

    return {
      tenantId: input.tenantId,
      assetId: input.assetId ?? null,
      driverId: input.driverId ?? null,
      occurredAt,
      jurisdictionCode: input.jurisdictionCode,
      locationLat: input.locationLat ?? null,
      locationLon: input.locationLon ?? null,
      volumeLitres: volumeLitresStr,
      originalVolume: originalVolume ?? null,
      originalVolumeUnit: originalVolumeUnit ?? null,
      transactionCurrency: input.transactionCurrency,
      amountTransaction: toDb(amountTransaction),
      exchangeRateToBase: toDb(exchangeRateToBase),
      amountBase: toDb(amountBase),
      taxGstRate: opt(input.taxGstRate),
      taxHstRate: opt(input.taxHstRate),
      taxQstRate: opt(input.taxQstRate),
      taxGstAmount: opt(input.taxGstAmount),
      taxHstAmount: opt(input.taxHstAmount),
      taxQstAmount: opt(input.taxQstAmount),
      fuelType: input.fuelType ?? 'DSL',
      sourceEventId: input.sourceEventId ?? null,
    };
  }

  async importOne(input: FuelTransactionInput): Promise<FuelTransactionRow> {
    const [row] = await this.importMany([input]);
    return row;
  }

  async importMany(inputs: FuelTransactionInput[]): Promise<FuelTransactionRow[]> {
    if (!inputs.length) return [];
    const rows: Prisma.FuelTransactionCreateManyInput[] = [];
    for (const input of inputs) {
      rows.push(await this.normalize(input));
    }
    const created = await this.prisma.fuelTransaction.createManyAndReturn({
      data: rows,
      skipDuplicates: true,
    });

    for (const row of created) {
      await this.bus.publish(
        EVENTS.FUEL_TRANSACTION_IMPORTED,
        new FuelTransactionImported({
          tenantId: row.tenantId,
          fuelTransactionId: row.id,
          assetId: row.assetId,
          quarter: quarterOf(row.occurredAt),
          jurisdictionCode: row.jurisdictionCode,
        }).payload,
      );
    }
    return (created as unknown as FuelDbRow[]).map((r) => this.map(r));
  }

  async list(tenantId: string, filters?: { quarter?: Quarter }): Promise<FuelTransactionRow[]> {
    const range = filters?.quarter ? quarterRange(filters.quarter) : null;
    const rows = await this.prisma.fuelTransaction.findMany({
      where: {
        tenantId,
        ...(range ? { occurredAt: { gte: range.start, lt: range.end } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.map(r as unknown as FuelDbRow));
  }

  async listForDriver(tenantId: string, driverId: string, limit = 20): Promise<FuelTransactionRow[]> {
    const rows = await this.prisma.fuelTransaction.findMany({
      where: { tenantId, driverId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.map(r as unknown as FuelDbRow));
  }

  async resolveDriverAssetId(tenantId: string, driverId: string): Promise<string | null> {
    const load = await this.prisma.load.findFirst({
      where: {
        tenantId,
        assigneeDriverId: driverId,
        status: { in: ['ASSIGNED', 'IN_TRANSIT'] },
        assigneeAssetId: { not: null },
      },
      orderBy: { assignedAt: 'desc' },
      select: { assigneeAssetId: true },
    });
    return (load?.assigneeAssetId as string | null) ?? null;
  }

  async aggregateByJurisdiction(filter: FuelPeriodFilter): Promise<FuelAggregateRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<FuelAggregateDbRow[]>(
      `SELECT "jurisdictionCode",
              COALESCE(SUM("volumeLitres"), 0)::numeric(20,4) AS litres,
              COUNT(*)::int AS "transactionCount"
       FROM "FuelTransaction"
       WHERE "tenantId" = $1
         AND ($2::text IS NULL OR "assetId" = $2)
         AND "occurredAt" >= $3 AND "occurredAt" < $4
       GROUP BY 1 ORDER BY 1`,
      filter.tenantId,
      filter.assetId ?? null,
      filter.start.toISOString(),
      filter.windowEnd.toISOString(),
    );
    return rows.map((r) => ({
      jurisdictionCode: r.jurisdictionCode,
      litres: Number(r.litres),
      transactionCount: r.transactionCount ?? 0,
    }));
  }
}
