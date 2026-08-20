import type { PrismaClient } from '@prisma/client';
import { d, toDb, type Decimal } from '../../utils/decimal';
import { badRequest, notFound } from '../../utils/errors';
import { quarterRange, type Quarter } from '../../utils/quarters';
import type { LoadService } from './load.service';
import { determineTax } from './tax.policy';
import type { TaxExemptReason } from './tax.constants';

export interface InvoiceCreateInput {
  tenantId: string;
  customerId: string;
  loadId?: string | null;
  issueDate?: Date | string;
  dueDate?: Date | string;
  currencyTransaction?: 'CAD' | 'USD';
  subtotalTransaction?: Decimal | string | number;
  exchangeRateToBase?: Decimal | string | number | null;
}

export interface InvoiceRow {
  id: string;
  tenantId: string;
  customerId: string;
  loadId: string | null;
  issueDate: string;
  dueDate: string;
  currencyTransaction: string;
  subtotalTransaction: string;
  subtotalBase: string;
  exchangeRateToBase: string;
  gstRate: string | null;
  hstRate: string | null;
  qstRate: string | null;
  gstAmountTransaction: string | null;
  hstAmountTransaction: string | null;
  qstAmountTransaction: string | null;
  totalTransaction: string;
  totalBase: string;
  zeroRated: boolean;
  taxExemptReason: TaxExemptReason | null;
}

export interface InvoiceService {
  createForLoad(input: InvoiceCreateInput): Promise<InvoiceRow>;
  get(tenantId: string, invoiceId: string): Promise<InvoiceRow>;
  list(tenantId: string, filters?: { quarter?: Quarter }): Promise<InvoiceRow[]>;
}

interface InvoiceDbRow {
  id: string;
  tenantId: string;
  customerId: string;
  loadId: string | null;
  issueDate: Date;
  dueDate: Date;
  currencyTransaction: string;
  subtotalTransaction: Decimal;
  subtotalBase: Decimal;
  exchangeRateToBase: Decimal;
  gstRate: Decimal | null;
  hstRate: Decimal | null;
  qstRate: Decimal | null;
  gstAmountTransaction: Decimal | null;
  hstAmountTransaction: Decimal | null;
  qstAmountTransaction: Decimal | null;
  totalTransaction: Decimal;
  totalBase: Decimal;
  zeroRated: boolean;
  taxExemptReason: TaxExemptReason | null;
}

export class PrismaInvoiceService implements InvoiceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly loads: LoadService,
  ) {}

  private map(row: InvoiceDbRow): InvoiceRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      loadId: row.loadId,
      issueDate: row.issueDate.toISOString(),
      dueDate: row.dueDate.toISOString(),
      currencyTransaction: row.currencyTransaction,
      subtotalTransaction: toDb(d(row.subtotalTransaction)),
      subtotalBase: toDb(d(row.subtotalBase)),
      exchangeRateToBase: toDb(d(row.exchangeRateToBase)),
      gstRate: row.gstRate ? toDb(d(row.gstRate)) : null,
      hstRate: row.hstRate ? toDb(d(row.hstRate)) : null,
      qstRate: row.qstRate ? toDb(d(row.qstRate)) : null,
      gstAmountTransaction: row.gstAmountTransaction ? toDb(d(row.gstAmountTransaction)) : null,
      hstAmountTransaction: row.hstAmountTransaction ? toDb(d(row.hstAmountTransaction)) : null,
      qstAmountTransaction: row.qstAmountTransaction ? toDb(d(row.qstAmountTransaction)) : null,
      totalTransaction: toDb(d(row.totalTransaction)),
      totalBase: toDb(d(row.totalBase)),
      zeroRated: row.zeroRated,
      taxExemptReason: row.taxExemptReason,
    };
  }

  async createForLoad(input: InvoiceCreateInput): Promise<InvoiceRow> {
    if (!input.loadId) throw badRequest('loadId is required to invoice a load');
    const load = await this.loads.get(input.tenantId, input.loadId);

    const tax = determineTax({
      originCountry: load.originCountry,
      originRegion: load.originRegion,
      destinationCountry: load.destinationCountry,
      destinationRegion: load.destinationRegion,
      isInternational: load.isInternational,
      isContinuousInboundOutbound: load.isContinuousInboundOutbound,
      interliningPartner: load.interliningPartner,
    });

    const exchangeRateToBase = input.exchangeRateToBase
      ? d(input.exchangeRateToBase)
      : d(load.exchangeRateToBase);
    const currencyTransaction = input.currencyTransaction ?? load.freightCurrency ?? 'CAD';
    const subtotalTransaction = input.subtotalTransaction
      ? d(input.subtotalTransaction)
      : load.freightAmountTransaction
        ? d(load.freightAmountTransaction)
        : d(0);

    const gstAmountTransaction = subtotalTransaction.times(tax.gstRate);
    const hstAmountTransaction = subtotalTransaction.times(tax.hstRate);
    const qstAmountTransaction = subtotalTransaction.times(tax.qstRate);
    const totalTransaction = subtotalTransaction
      .plus(gstAmountTransaction)
      .plus(hstAmountTransaction)
      .plus(qstAmountTransaction);

    const subtotalBase = subtotalTransaction.times(exchangeRateToBase);
    const totalBase = subtotalTransaction
      .plus(gstAmountTransaction)
      .plus(hstAmountTransaction)
      .plus(qstAmountTransaction)
      .times(exchangeRateToBase);

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const dueDate = input.dueDate
      ? new Date(input.dueDate)
      : new Date(issueDate.getTime() + 30 * 24 * 3_600_000);

    const row = await this.prisma.invoice.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        loadId: input.loadId,
        issueDate,
        dueDate,
        currencyTransaction,
        subtotalTransaction: toDb(subtotalTransaction),
        subtotalBase: toDb(subtotalBase),
        exchangeRateToBase: toDb(exchangeRateToBase),
        gstRate: tax.zeroRated ? null : toDb(tax.gstRate),
        hstRate: tax.zeroRated ? null : toDb(tax.hstRate),
        qstRate: tax.zeroRated ? null : toDb(tax.qstRate),
        gstAmountTransaction: tax.zeroRated ? null : toDb(gstAmountTransaction),
        hstAmountTransaction: tax.zeroRated ? null : toDb(hstAmountTransaction),
        qstAmountTransaction: tax.zeroRated ? null : toDb(qstAmountTransaction),
        totalTransaction: toDb(totalTransaction),
        totalBase: toDb(totalBase),
        zeroRated: tax.zeroRated,
        taxExemptReason: (tax.taxExemptReason as TaxExemptReason | null) ?? null,
      },
    });

    return this.map(row as InvoiceDbRow);
  }

  async get(tenantId: string, invoiceId: string): Promise<InvoiceRow> {
    const row = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!row) throw notFound('invoice not found');
    return this.map(row as InvoiceDbRow);
  }

  async list(tenantId: string, filters?: { quarter?: Quarter }): Promise<InvoiceRow[]> {
    const range = filters?.quarter ? quarterRange(filters.quarter) : null;
    const rows = await this.prisma.invoice.findMany({
      where: { tenantId, ...(range ? { issueDate: { gte: range.start, lt: range.end } } : {}) },
      orderBy: { issueDate: 'desc' },
      take: 200,
    });
    return (rows as InvoiceDbRow[]).map((r) => this.map(r));
  }
}
