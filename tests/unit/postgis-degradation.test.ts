/**
 * Route geometry is an enhancement, not a dependency: a server whose database
 * lacks PostGIS must still accept ELD batches and compute IFTA summaries (with
 * fuel-only figures) instead of throwing. Production ran without PostGIS for
 * its whole life, so this is the state the ingest path actually meets.
 */
import {
  PostgisRouteGeometryService,
  isMissingPostgisError,
} from '../../src/modules/postgis/postgis.service';
import type { PrismaClient } from '@prisma/client';

/** The Prisma error Postgres returns when CREATE EXTENSION / ST_* is missing. */
const missingPostgis = () => {
  const err = new Error('Raw query failed. Code: `0A000`. Message: `extension "postgis" is not available`');
  return Object.assign(err, {
    code: 'P2010',
    meta: {
      code: '0A000',
      message:
        'ERROR: extension "postgis" is not available\nDETAIL: Could not open extension control file ".../postgis.control": No such file or directory.',
    },
  });
};

function serviceWith(fail: () => unknown) {
  const tx = {
    $executeRawUnsafe: jest.fn(fail),
    $queryRawUnsafe: jest.fn(fail),
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRawUnsafe: jest.fn(async () => []),
  } as unknown as PrismaClient;
  return { service: new PostgisRouteGeometryService(prisma), prisma };
}

const window = { tenantId: 't1', assetId: 'a1', start: new Date('2026-01-01'), windowEnd: new Date('2026-01-02') };

describe('isMissingPostgisError', () => {
  it('recognises the missing-extension codes and messages', () => {
    expect(isMissingPostgisError(missingPostgis())).toBe(true);
    expect(isMissingPostgisError({ meta: { code: '42704', message: 'type "geometry" does not exist' } })).toBe(true);
    expect(
      isMissingPostgisError({
        meta: { code: '42883', message: 'function st_makeline(geometry[]) does not exist' },
      }),
    ).toBe(true);
  });

  it('does not blame PostGIS for an ordinary SQL bug', () => {
    // 42883 with no ST_/postgis in the message is our own broken SQL — it must
    // surface, not be swallowed as "PostGIS missing". This is the shape of the
    // ROUND(double precision, int) error that made segmentation silently
    // return zero segments.
    expect(
      isMissingPostgisError({
        meta: { code: '42883', message: 'ERROR: function round(double precision, integer) does not exist' },
      }),
    ).toBe(false);
  });

  it('does not swallow unrelated database errors', () => {
    expect(isMissingPostgisError(new Error('connection refused'))).toBe(false);
    expect(isMissingPostgisError({ meta: { code: '23505' } })).toBe(false);
    expect(isMissingPostgisError({ meta: { code: '42883' } })).toBe(false);
    expect(isMissingPostgisError(undefined)).toBe(false);
  });
});

describe('PostgisRouteGeometryService without PostGIS', () => {
  it('returns zero segments instead of failing the ELD batch', async () => {
    const { service } = serviceWith(() => {
      throw missingPostgis();
    });

    await expect(service.buildSegmentsForPeriod({ ...window, gapMinutes: 15 })).resolves.toBe(0);
    expect(service.isPostgisMissing).toBe(true);
  });

  it('stops querying once the extension is known to be absent', async () => {
    const { service, prisma } = serviceWith(() => {
      throw missingPostgis();
    });

    await service.buildSegmentsForPeriod(window);
    const before = (prisma.$transaction as unknown as jest.Mock).mock.calls.length;
    await service.buildSegmentsForPeriod(window);

    expect((prisma.$transaction as unknown as jest.Mock).mock.calls.length).toBe(before);
  });

  it('reports no distances instead of throwing during IFTA totals', async () => {
    const { service } = serviceWith(() => {
      throw missingPostgis();
    });
    await service.buildSegmentsForPeriod(window);

    await expect(service.aggregateDistanceByJurisdiction(window)).resolves.toEqual([]);
    await expect(service.hasSegmentsInPeriod(window)).resolves.toBe(false);
  });

  it('still surfaces real database errors', async () => {
    const { service } = serviceWith(() => {
      throw new Error('deadlock detected');
    });

    await expect(service.buildSegmentsForPeriod(window)).rejects.toThrow('deadlock detected');
    expect(service.isPostgisMissing).toBe(false);
  });
});
