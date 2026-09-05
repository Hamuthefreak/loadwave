import type { PrismaClient } from '@prisma/client';
import { EventBus } from '../../src/events/event-bus';
import { PrismaFuelService } from '../../src/modules/fuel/fuel.service';
import type { FxService } from '../../src/modules/fuel/fx.service';

function buildService(overrides: {
  load?: ReturnType<typeof jest.fn>;
  fuelRows?: Array<Record<string, unknown>>;
}) {
  const prisma = {
    load: {
      findFirst: overrides.load ?? jest.fn(async () => null),
    },
    fuelTransaction: {
      findMany: jest.fn(async () => overrides.fuelRows ?? []),
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
