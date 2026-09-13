import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { runRecurrenceSweep } from '../../src/modules/recurring/recurring.service';

type Row = Record<string, unknown>;

/**
 * Minimal in-memory stand-in for the three Prisma calls the sweep makes, so a
 * test can run a whole month of weekly occurrences and count what the tenant
 * would actually see on their board.
 */
function fakePrisma(rows: Row[]) {
  let seq = 0;
  const api = {
    load: {
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: { nextRecurrenceAt?: { lte: Date }; recurringDays?: { not: null } };
          take?: number;
        }) => {
          const lte = where.nextRecurrenceAt?.lte ?? null;
          // Prisma's `{ not: null }` means IS NOT NULL.
          const wantScheduled = where.recurringDays != null && 'not' in where.recurringDays;
          return rows
            .filter((r) => (wantScheduled ? r.recurringDays != null : true))
            .filter((r) => {
              if (!lte) return true;
              const next = r.nextRecurrenceAt as Date | null | undefined;
              return next != null && next.getTime() <= lte.getTime();
            })
            .sort(
              (a, b) =>
                ((a.nextRecurrenceAt as Date | null)?.getTime() ?? 0) -
                ((b.nextRecurrenceAt as Date | null)?.getTime() ?? 0),
            )
            .slice(0, take ?? 100);
        },
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row: Row = { id: `clone-${++seq}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
  return { prisma: api as unknown as PrismaClient, api, rows };
}

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as unknown as Logger;
// A load posted Monday 2026-09-07 repeating every Monday is next due the 14th.
const NEXT = new Date('2026-09-14T13:00:00Z');

/** A load posted Monday 2026-09-07 that repeats every Monday. */
function weeklySource(nextRecurrenceAt: Date, id = 'src'): Row {
  return {
    id,
    tenantId: 't1',
    originCountry: 'CA',
    originRegion: 'ON',
    destinationCountry: 'CA',
    destinationRegion: 'QC',
    originLocality: null,
    destinationLocality: null,
    originLat: null,
    originLon: null,
    destinationLat: null,
    destinationLon: null,
    equipmentType: 'DRY_VAN',
    pickupDate: new Date('2026-09-07T13:00:00Z'),
    deliveryDate: new Date('2026-09-07T21:00:00Z'),
    pickupFlexible: false,
    distanceKmEstimate: null,
    weightKg: null,
    commodity: null,
    hazmat: false,
    temperatureMin: null,
    temperatureMax: null,
    teamRequired: false,
    detentionRate: null,
    accessorials: null,
    stopCount: 1,
    freightCurrency: 'CAD',
    freightAmountTransaction: null,
    freightAmountBase: null,
    exchangeRateToBase: null,
    isInternational: false,
    isContinuousInboundOutbound: false,
    interliningPartner: null,
    recurringDays: '1',
    nextRecurrenceAt,
  };
}

describe('recurrence sweep', () => {
  it('adds one load per occurrence instead of doubling the board', async () => {
    const { prisma, rows } = fakePrisma([weeklySource(new Date(NEXT))]);

    // Four consecutive Mondays: 2, 3, 4, 5 loads on the board.
    for (let week = 0; week < 4; week++) {
      await runRecurrenceSweep(prisma, logger, new Date(NEXT.getTime() + week * 7 * 86_400_000));
      // Before the fix each clone carried the schedule and spawned its own
      // clone, so this grew 2 → 4 → 8 → 16.
      expect(rows).toHaveLength(week + 2);
    }

    // Only the original stays on the schedule; every clone is a one-off.
    expect(rows.filter((r) => r.recurringDays != null)).toHaveLength(1);
  });

  it('clones a single occurrence with no schedule of its own', async () => {
    const { prisma, api } = fakePrisma([weeklySource(new Date(NEXT))]);

    await runRecurrenceSweep(prisma, logger, new Date(NEXT));

    expect(api.load.create).toHaveBeenCalledTimes(1);
    const data = api.load.create.mock.calls[0][0].data as Row;
    expect(data.recurringDays).toBeNull();
    expect(data.nextRecurrenceAt).toBeNull();
    // Same lane and freight, but no assignment and no history.
    expect(data.originRegion).toBe('ON');
    expect(data.destinationRegion).toBe('QC');
    expect(data.tenantId).toBe('t1');
    // Pickup lands on the fire date with the original lead time preserved.
    expect((data.pickupDate as Date).toISOString()).toBe('2026-09-14T13:00:00.000Z');
    expect((data.deliveryDate as Date).toISOString()).toBe('2026-09-14T21:00:00.000Z');
  });

  it('advances the source even when a clone fails, so it cannot re-fire in a loop', async () => {
    const { prisma, api, rows } = fakePrisma([weeklySource(new Date(NEXT))]);
    api.load.create.mockRejectedValueOnce(new Error('boom'));

    await runRecurrenceSweep(prisma, logger, new Date(NEXT));

    expect(api.load.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    const src = rows[0];
    expect((src.nextRecurrenceAt as Date).getTime()).toBeGreaterThan(NEXT.getTime());
    expect(logger.warn).toHaveBeenCalled();
  });
});
