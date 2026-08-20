import type { PrismaClient } from '@prisma/client';
import { d, toDb, type Decimal } from '../../utils/decimal';
import type { Quarter } from '../../utils/quarters';

export interface FxRateRow {
  id: string;
  tenantId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  quarter: string | null;
  rateDate: string;
}

export interface SetFxRateInput {
  tenantId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: Decimal | string | number;
  quarter?: Quarter | null;
  rateDate?: Date | string;
}

export interface FxService {
  setRate(input: SetFxRateInput): Promise<FxRateRow>;
  getRateForQuarter(
    tenantId: string,
    fromCurrency: string,
    toCurrency: string,
    quarter: Quarter,
    asOf?: Date,
  ): Promise<Decimal | null>;
  list(tenantId: string, fromCurrency?: string, toCurrency?: string): Promise<FxRateRow[]>;
}

interface FxRow {
  id: string;
  tenantId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string | { toString(): string };
  quarter: string | null;
  rateDate: Date;
}

export class PrismaFxService implements FxService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: FxRow): FxRateRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      rate: typeof row.rate === 'string' ? row.rate : (row.rate as { toString(): string }).toString(),
      quarter: row.quarter,
      rateDate: row.rateDate.toISOString(),
    };
  }

  async setRate(input: SetFxRateInput): Promise<FxRateRow> {
    const rateDate = input.rateDate ? new Date(input.rateDate) : new Date();
    const row = await this.prisma.fxRate.create({
      data: {
        tenantId: input.tenantId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: toDb(d(input.rate)),
        quarter: input.quarter ?? null,
        rateDate,
      },
    });
    return this.map(row);
  }

  async getRateForQuarter(
    tenantId: string,
    fromCurrency: string,
    toCurrency: string,
    _quarter: Quarter,
    asOf: Date = new Date(),
  ): Promise<Decimal | null> {
    const row = await this.prisma.fxRate.findFirst({
      where: {
        tenantId,
        fromCurrency,
        toCurrency,
        rateDate: { lte: asOf },
      },
      orderBy: { rateDate: 'desc' },
    });
    return row ? d(row.rate) : null;
  }

  async list(tenantId: string, fromCurrency?: string, toCurrency?: string): Promise<FxRateRow[]> {
    const rows = await this.prisma.fxRate.findMany({
      where: {
        tenantId,
        ...(fromCurrency ? { fromCurrency } : {}),
        ...(toCurrency ? { toCurrency } : {}),
      },
      orderBy: { rateDate: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.map(r));
  }
}
