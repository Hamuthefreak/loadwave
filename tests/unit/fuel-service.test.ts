import type { PrismaClient } from '@prisma/client';
import { EventBus } from '../../src/events/event-bus';
import { PrismaFuelService } from '../../src/modules/fuel/fuel.service';
import type { FxService } from '../../src/modules/fuel/fx.service';

function buildService(overrides: {
  load?: ReturnType<typeof jest.fn>;
  fuelRows?: Array<Record<string, unknown>>;
  /** What `createManyAndReturn` stores — empty means the row was already there. */
  created?: Array<Record<string, unknown>>;
  /** What a lookup by `sourceEventId` finds. */
  existing?: Record<string, unknown> | null;
}) {
  const prisma = {
    load: {
      findFirst: overrides.load ?? jest.fn(async () => null),
    },
    fuelTransaction: {
      findMany: jest.fn(async () => overrides.fuelRows ?? []),
      createManyAndReturn: jest.fn(async () => overrides.created ?? []),
      findFirst: jest.fn(async () => overrides.existing ?? null),
    },
  } as unknown as Pick<PrismaClient, 'load' | 'fuelTransaction'>;

  const fx = { getRateForQuarter: jest.fn(async () => null) } as unknown as FxService;
  return new PrismaFuelService(prisma as unknown as PrismaClient, new EventBus(), fx);
}

describe('PrismaFuelService driver helpers', () => {
  it('resolves the unit assigned to the driver’s active trip', async () => {
    const load = jest.fn(async () => ({ assigneeAssetId: 'tractor-9' }));
    const svc = buildService({ load });
    const assetId = await svc.resolveDriverAssetId('t1', 'd-marie');
    expect(assetId).toBe('tractor-9');
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          assigneeDriverId: 'd-marie',
          status: { in: ['ASSIGNED', 'IN_TRANSIT'] },
        }),
      }),
    );
  });

  it('returns null when the driver has no active trip with a unit', async () => {
    const svc = buildService({});
    expect(await svc.resolveDriverAssetId('t1', 'd-jean')).toBeNull();
  });

  it('lists only the driver’s own recent fuel transactions, newest first', async () => {
    const row = {
      id: 'f1',
      tenantId: 't1',
      assetId: null,
      driverId: 'd-marie',
      occurredAt: new Date('2026-09-04T12:00:00Z'),
      jurisdictionCode: 'QC',
      locationLat: null,
      locationLon: null,
      volumeLitres: '120',
      originalVolume: '120',
      originalVolumeUnit: 'L',
      transactionCurrency: 'CAD',
      amountTransaction: '250.00',
      exchangeRateToBase: '1',
      amountBase: '250.00',
      taxGstRate: null,
      taxHstRate: null,
      taxQstRate: null,
      taxGstAmount: null,
      taxHstAmount: null,
      taxQstAmount: null,
      fuelType: 'DSL',
      sourceEventId: null,
    };
    const svc = buildService({ fuelRows: [row] });
    const rows = await svc.listForDriver('t1', 'd-marie', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      driverId: 'd-marie',
      volumeLitres: '120',
      amountBase: '250.00',
      occurredAt: '2026-09-04T12:00:00.000Z',
    });
  });
});

/**
 * A single import is what a phone at a pump does, and the whole reason it is
 * safe to retry is that `sourceEventId` is unique per tenant: an insert that
 * stored nothing means the write already landed, not that it failed. Getting
 * this wrong in either direction is expensive — a duplicate counts the same
 * litres twice in an IFTA quarter, and a false failure tells a driver their
 * fuel was not recorded when it was.
 */
describe('PrismaFuelService single import', () => {
  const dbRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'f1',
    tenantId: 't1',
    assetId: null,
    driverId: 'd-marie',
    occurredAt: new Date('2026-10-06T14:05:00Z'),
    jurisdictionCode: 'QC',
    locationLat: null,
    locationLon: null,
    volumeLitres: '250',
    originalVolume: '250',
    originalVolumeUnit: 'L',
    transactionCurrency: 'CAD',
    amountTransaction: '320.50',
    exchangeRateToBase: '1',
    amountBase: '320.50',
    taxGstRate: null,
    taxHstRate: null,
    taxQstRate: null,
    taxGstAmount: null,
    taxHstAmount: null,
    taxQstAmount: null,
    fuelType: 'DSL',
    sourceEventId: 'cab:ref-0001',
    ...overrides,
  });

  const input = {
    tenantId: 't1',
    driverId: 'd-marie',
    occurredAt: '2026-10-06T14:05:00.000Z',
    jurisdictionCode: 'QC',
    volumeLitres: '250',
    originalVolume: '250',
    originalVolumeUnit: 'L',
    transactionCurrency: 'CAD' as const,
    amountTransaction: '320.50',
    sourceEventId: 'cab:ref-0001',
  };

  it('hands back the row it stored', async () => {
    const svc = buildService({ created: [dbRow()] });
    const row = await svc.importOne(input);
    expect(row).toMatchObject({ id: 'f1', volumeLitres: '250', occurredAt: '2026-10-06T14:05:00.000Z' });
  });

  it('hands back the row already on file when a retry stores nothing', async () => {
    // `createManyAndReturn({ skipDuplicates: true })` returns nothing for a
    // `sourceEventId` that is already there, so the retry has to find it.
    const svc = buildService({ created: [], existing: dbRow() });
    const row = await svc.importOne(input);
    expect(row).toMatchObject({ id: 'f1', sourceEventId: 'cab:ref-0001' });
  });

  it('still fails when nothing was stored and nothing is on file', async () => {
    const svc = buildService({ created: [], existing: null });
    await expect(svc.importOne(input)).rejects.toThrow(/could not be stored/i);
  });
});
