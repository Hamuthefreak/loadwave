import { Prisma, type PrismaClient } from '@prisma/client';
import type { LoadService } from '../../src/modules/invoicing/load.service';
import { PrismaInvoiceService } from '../../src/modules/invoicing/invoice.service';

const baseLoad = {
  id: 'load-1',
  tenantId: 't1',
  originCountry: 'CA',
  originRegion: 'QC',
  destinationCountry: 'US',
  destinationRegion: 'NY',
  isInternational: true,
  isContinuousInboundOutbound: false,
  interliningPartner: null,
  freightCurrency: 'USD',
  freightAmountTransaction: '700.000000',
  exchangeRateToBase: '1.35000000',
};

function buildService(options: { loadStatus?: string; duplicate?: boolean } = {}) {
  const create = jest.fn(async (_args: { data: Record<string, unknown> }) => {
    if (options.duplicate) {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      });
      throw err;
    }
    return {
      id: 'inv-1',
      tenantId: 't1',
      customerId: 'Acme',
      loadId: 'load-1',
      issueDate: new Date('2026-09-05T12:00:00Z'),
      dueDate: new Date('2026-10-05T12:00:00Z'),
      currencyTransaction: 'USD',
      subtotalTransaction: '700.000000',
      subtotalBase: '945.000000',
      exchangeRateToBase: '1.35000000',
      gstRate: null,
      hstRate: null,
      qstRate: null,
      gstAmountTransaction: null,
      hstAmountTransaction: null,
      qstAmountTransaction: null,
      totalTransaction: '700.000000',
      totalBase: '945.000000',
      zeroRated: false,
      taxExemptReason: null,
      paidAt: null,
      paidAmountTransaction: null,
      paidAmountBase: null,
    };
  });
  const prisma = {
    invoice: { create },
    // Detention is summed into the subtotal — none in these fixtures.
    detentionEntry: { findMany: jest.fn(async () => []) },
  } as unknown as Pick<PrismaClient, 'invoice' | 'detentionEntry'>;
  const loads = {
    get: jest.fn(async () => ({ ...baseLoad, status: options.loadStatus ?? 'DELIVERED' })),
  } as unknown as LoadService;
  const svc = new PrismaInvoiceService(prisma as unknown as PrismaClient, loads);
  return { svc, create, loads };
}

describe('PrismaInvoiceService.createForLoad', () => {
  it('refuses to invoice a load that has not been delivered', async () => {
    for (const status of ['OPEN', 'ASSIGNED', 'IN_TRANSIT']) {
      const { svc } = buildService({ loadStatus: status });
      await expect(
        svc.createForLoad({ tenantId: 't1', customerId: 'Acme', loadId: 'load-1' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('creates an invoice for a delivered load', async () => {
    const { svc, create } = buildService({ loadStatus: 'DELIVERED' });
    const row = await svc.createForLoad({ tenantId: 't1', customerId: 'Acme', loadId: 'load-1' });
    expect(row.id).toBe('inv-1');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.loadId).toBe('load-1');
  });

  it('maps a unique-constraint violation to a clean duplicate-invoice conflict', async () => {
    const { svc } = buildService({ loadStatus: 'DELIVERED', duplicate: true });
    await expect(
      svc.createForLoad({ tenantId: 't1', customerId: 'Acme', loadId: 'load-1' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
