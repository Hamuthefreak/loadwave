import { LoadBoardService } from '../../src/modules/board/board.service';
import type { BoardLoadRow, LaneRateAverage, LoadBoardStore } from '../../src/modules/board/board.store';
import type { ViewerPositionStore } from '../../src/modules/board/position.store';
import type { ViewerPosition } from '../../src/modules/board/board.earning';
import { KM_PER_MILE } from '../../src/modules/board/board.earning';

/**
 * The board is the most-opened page in the product and it is now assembled from
 * four sources that can each fail on their own: the loads, the viewer's
 * position, the trust panel and the lane benchmark. These tests pin the rule
 * that matters — an enrichment that cannot be computed leaves the field absent
 * and the board intact, because a board that 500s is worse than a board without
 * a dollar figure on it.
 *
 * They also pin the one performance decision in the deadhead work: the alert
 * sweep must not scan the public set for backhauls it never reads.
 */

const MONTREAL = { lat: 45.5019, lon: -73.5674 };
const TORONTO = { lat: 43.6532, lon: -79.3832 };

function row(over: Partial<BoardLoadRow> = {}): BoardLoadRow {
  return {
    id: 'load-a',
    tenantId: 'tenant-other',
    postedByTenantName: 'Northline Partners',
    postedByMcNumber: null,
    postedByUsdotNumber: null,
    externalLoadboardId: null,
    originCountry: 'CA',
    originRegion: 'QC',
    originLocality: 'Montréal',
    originLat: MONTREAL.lat,
    originLon: MONTREAL.lon,
    destinationCountry: 'CA',
    destinationRegion: 'ON',
    destinationLocality: 'Toronto',
    destinationLat: TORONTO.lat,
    destinationLon: TORONTO.lon,
    distanceKmEstimate: '540',
    equipmentType: 'DRY_VAN',
    pickupDate: null,
    deliveryDate: null,
    pickupFlexible: false,
    weightKg: '18000',
    commodity: 'Retail goods',
    hazmat: false,
    temperatureMin: null,
    temperatureMax: null,
    teamRequired: false,
    detentionRate: null,
    accessorials: null,
    stopCount: 1,
    freightCurrency: 'CAD',
    freightAmountTransaction: '1950',
    freightAmountBase: '1950',
    isInternational: false,
    status: 'OPEN',
    marketplaceStatus: 'PUBLIC',
    bookedByTenantId: null,
    bookedAt: null,
    createdAt: new Date('2026-10-01T12:00:00Z').toISOString(),
    ...over,
  };
}

function storeWith(rows: BoardLoadRow[], over: Partial<LoadBoardStore> = {}): LoadBoardStore {
  const empty: LaneRateAverage[] = [];
  return {
    findPublic: async () => rows,
    findOwned: async () => [],
    findById: async () => null,
    claim: async () => false,
    makePublic: async () => false,
    laneRateAverages: async () => empty,
    ...over,
  };
}

/** Only the two methods the service touches; the rest of GeoService is unused here. */
const geo = {} as unknown as ConstructorParameters<typeof LoadBoardService>[1];

function positionStore(
  result: ViewerPosition | null | (() => Promise<never>),
): ViewerPositionStore {
  return {
    viewerPosition: typeof result === 'function' ? result : async () => result,
  };
}

describe('deadhead enrichment, and what happens when it cannot run', () => {
  it('prices the empty miles from the viewer position and attributes them', async () => {
    const service = new LoadBoardService(storeWith([row()]), geo, undefined, positionStore({
      point: { lat: 45.422, lon: -75.697 }, // Ottawa: the delivery of the trip in progress
      source: 'ACTIVE_LOAD',
      place: 'Ottawa, ON',
      at: '2026-10-08T16:00:00.000Z',
    }));

    const [priced] = await service.listPublic('tenant-demo', {});
    expect(priced.deadheadKm).toBeCloseTo(166, 0); // Ottawa -> Montréal, great circle
    expect(priced.grossPerMile).toBeCloseTo(1950 / (540 * KM_PER_MILE), 6);
    expect(priced.netPerMile).toBeCloseTo(
      1950 / ((540 + (priced.deadheadKm ?? 0)) * KM_PER_MILE),
      6,
    );
    expect(priced.netPerMile).toBeLessThan(priced.grossPerMile as number);
    expect(priced.positionSource).toBe('ACTIVE_LOAD');
    expect(priced.positionPlace).toBe('Ottawa, ON');
  });

  it('still lists loads when the position lookup throws', async () => {
    const service = new LoadBoardService(
      storeWith([row()]),
      geo,
      undefined,
      positionStore(async () => {
        throw new Error('route point table is not reachable');
      }),
    );

    const rows = await service.listPublic('tenant-demo', {});
    expect(rows).toHaveLength(1);
    expect(rows[0].grossPerMile).not.toBeNull();
    expect(rows[0].deadheadKm).toBeNull();
    expect(rows[0].netPerMile).toBeNull();
    expect(rows[0].positionSource).toBeNull();
    expect(rows[0].positionPlace).toBeNull();
  });

  it('works with no position store wired at all, as every board did before this existed', async () => {
    const service = new LoadBoardService(storeWith([row()]), geo);
    const rows = await service.listPublic('tenant-demo', {});
    expect(rows[0].grossPerMile).not.toBeNull();
    expect(rows[0].netPerMile).toBeNull();
  });

  it('leaves the net figure null when the load carries no distance to weigh it against', async () => {
    const service = new LoadBoardService(storeWith([row({ distanceKmEstimate: null })]), geo);
    const rows = await service.listPublic('tenant-demo', {});
    expect(rows[0].grossPerMile).toBeNull();
    expect(rows[0].netPerMile).toBeNull();
    expect(rows[0].deadheadKm).toBeNull();
  });

  it('survives a broken lane benchmark and a broken trust panel', async () => {
    const service = new LoadBoardService(
      storeWith([row()], {
        laneRateAverages: async () => {
          throw new Error('lane stats are down');
        },
      }),
      geo,
      // TrustService is only touched when supplied; a throwing one must not blank the board.
      { signalsFor: async () => { throw new Error('trust is down'); } } as never,
      positionStore(null),
    );

    const rows = await service.listPublic('tenant-demo', {});
    expect(rows).toHaveLength(1);
    expect(rows[0].netPerMile).toBeNull();
  });
});

describe('backhauls on the board, and never in the alert sweep', () => {
  // A factory, not a constant: the service stamps its enrichment onto the rows
  // it is handed, so shared fixtures would carry one test's answer into the next.
  const pair = (): BoardLoadRow[] => [
    row({ id: 'leg-a' }), // Montréal -> Toronto, delivers where leg-b picks up
    row({
      id: 'leg-b',
      originRegion: 'ON',
      originLocality: 'Toronto',
      originLat: TORONTO.lat,
      originLon: TORONTO.lon,
      destinationRegion: 'QC',
      destinationLocality: 'Montréal',
      destinationLat: MONTREAL.lat,
      destinationLon: MONTREAL.lon,
      freightAmountBase: '1450',
      freightAmountTransaction: '1450',
    }),
  ];

  it('pairs each load with the backhaul near its delivery', async () => {
    const service = new LoadBoardService(storeWith(pair()), geo);
    const rows = await service.listPublic('tenant-demo', {});
    const a = rows.find((r) => r.id === 'leg-a');
    expect(a?.topRoundTrips).toHaveLength(1);
    expect(a?.topRoundTrips?.[0].id).toBe('leg-b');
    expect(a?.topRoundTrips?.[0].deadheadKm).toBeCloseTo(0, 3);
  });

  it('skips the pairing entirely when the caller does not read it', async () => {
    const service = new LoadBoardService(storeWith(pair()), geo);
    const rows = await service.listPublic('tenant-demo', {}, { roundTrips: false });
    // Undefined, not an empty array: the column was never built, so nothing
    // scanned the public set to build it.
    expect(rows.every((r) => r.topRoundTrips === undefined)).toBe(true);
  });

  it('spends nothing on pairing when the load has no delivery coordinate', async () => {
    const service = new LoadBoardService(
      storeWith([row({ id: 'leg-a', destinationLat: null, destinationLon: null }), pair()[1]]),
      geo,
    );
    const rows = await service.listPublic('tenant-demo', {});
    expect(rows.find((r) => r.id === 'leg-a')?.topRoundTrips).toEqual([]);
  });
});
