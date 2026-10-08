import {
  KM_PER_MILE,
  earning,
  loadAmount,
  miles,
  ratePerMile,
  roundTrips,
  ROUND_TRIP_MAX,
  type RoundTripCandidate,
  type ViewerPosition,
} from '../../src/modules/board/board.earning';

/**
 * The board is the most-opened page in the product and had no tests at all, so
 * these are the first. The bar is the same one the card itself has to meet: a
 * figure appears only when the arithmetic behind it is complete, and every
 * missing input makes it disappear rather than default to zero.
 */

const MONTREAL = { lat: 45.5019, lon: -73.5674 };
const TORONTO = { lat: 43.6532, lon: -79.3832 };
const OTTAWA = { lat: 45.4215, lon: -75.6972 };
const MISSISSAUGA = { lat: 43.589, lon: -79.6441 };
const OAKVILLE = { lat: 43.4675, lon: -79.6877 };

const at = (point: { lat: number; lon: number }, source: ViewerPosition['source'] = 'LAST_POSITION'): ViewerPosition => ({
  point,
  source,
  place: 'Ontario',
  at: '2026-10-05T12:00:00.000Z',
});

describe('distance and rate arithmetic', () => {
  it('converts kilometres to miles with the factor the lane benchmark uses', () => {
    expect(KM_PER_MILE).toBeCloseTo(0.621371, 6);
    expect(miles(100)).toBeCloseTo(62.1371, 4);
  });

  it('computes dollars per mile', () => {
    expect(ratePerMile(1000, 500)).toBeCloseTo(1000 / (500 * 0.621371), 6);
  });

  it('refuses a rate on zero or negative distance', () => {
    expect(ratePerMile(1000, 0)).toBeNull();
    expect(ratePerMile(1000, -5)).toBeNull();
    expect(ratePerMile(1000, null)).toBeNull();
    expect(ratePerMile(null, 500)).toBeNull();
  });

  it('prefers the base-currency amount and falls back to the transaction one', () => {
    expect(loadAmount({ freightAmountBase: '2400.00', freightAmountTransaction: '1700.00' })).toBe(2400);
    expect(loadAmount({ freightAmountBase: null, freightAmountTransaction: '1700.00' })).toBe(1700);
    expect(loadAmount({ freightAmountBase: '0', freightAmountTransaction: '0' })).toBeNull();
    expect(loadAmount({})).toBeNull();
  });
});

describe('earning on a load', () => {
  const row = {
    distanceKmEstimate: '500',
    freightAmountBase: '2000.00',
    originLat: MONTREAL.lat,
    originLon: MONTREAL.lon,
    destinationLat: TORONTO.lat,
    destinationLon: TORONTO.lon,
  };

  it('shows the loaded rate and no deadhead when we have no position', () => {
    const e = earning(row, null);
    expect(e.grossPerMile).toBeCloseTo(2000 / (500 * 0.621371), 6);
    expect(e.deadheadKm).toBeNull();
    expect(e.netPerMile).toBeNull();
    expect(e.positionSource).toBeNull();
  });

  it('subtracts the empty kilometres to the pickup and attributes them', () => {
    const e = earning(row, at(OTTAWA, 'ACTIVE_LOAD'));
    expect(e.deadheadKm).toBeCloseTo(166, 0); // Ottawa -> Montreal, great circle
    expect(e.netPerMile).toBeLessThan(e.grossPerMile as number);
    expect(e.netPerMile).toBeCloseTo(2000 / (Number(row.distanceKmEstimate) * 0.621371 + (e.deadheadKm as number) * 0.621371), 6);
    expect(e.positionSource).toBe('ACTIVE_LOAD');
  });

  it('leaves the net figure null when the load carries no pickup coordinate', () => {
    const noCoords = { ...row, originLat: null, originLon: null };
    const e = earning(noCoords, at(OTTAWA));
    expect(e.grossPerMile).not.toBeNull();
    expect(e.deadheadKm).toBeNull();
    expect(e.netPerMile).toBeNull();
  });

  it('leaves both rates null when the distance is unknown', () => {
    const e = earning({ ...row, distanceKmEstimate: null }, at(OTTAWA));
    expect(e.grossPerMile).toBeNull();
    expect(e.netPerMile).toBeNull();
  });

  it('shows no deadhead rather than a zero when the load has no distance to weigh it against', () => {
    const e = earning({ ...row, distanceKmEstimate: '0' }, at(OTTAWA));
    expect(e.deadheadKm).toBeNull();
    expect(e.netPerMile).toBeNull();
  });

  it('returns the gross rate unchanged when the pickup is where we already are', () => {
    const e = earning(row, at(MONTREAL));
    expect(e.deadheadKm).toBeCloseTo(0, 6);
    expect(e.netPerMile).toBeCloseTo(e.grossPerMile as number, 6);
  });
});

describe('round trips', () => {
  const row: RoundTripCandidate = {
    id: 'load-a',
    originRegion: 'QC',
    destinationRegion: 'ON',
    originLocality: 'Montréal',
    destinationLocality: 'Toronto',
    equipmentType: 'DRY_VAN',
    freightCurrency: 'CAD',
    distanceKmEstimate: '500',
    freightAmountBase: '2000.00',
    originLat: MONTREAL.lat,
    originLon: MONTREAL.lon,
    destinationLat: TORONTO.lat,
    destinationLon: TORONTO.lon,
    deliveryDate: '2026-10-06T16:00:00.000Z',
    pickupDate: '2026-10-05T08:00:00.000Z',
  };

  const candidate = (over: Partial<RoundTripCandidate> & { id: string }): RoundTripCandidate => ({
    originRegion: 'ON',
    destinationRegion: 'QC',
    originLocality: 'Mississauga',
    destinationLocality: 'Montréal',
    equipmentType: 'DRY_VAN',
    freightCurrency: 'CAD',
    distanceKmEstimate: '540',
    freightAmountBase: '1700.00',
    originLat: MISSISSAUGA.lat,
    originLon: MISSISSAUGA.lon,
    destinationLat: MONTREAL.lat,
    destinationLon: MONTREAL.lon,
    pickupDate: '2026-10-07T08:00:00.000Z',
    ...over,
  });

  it('finds a load that picks up near where we deliver', () => {
    const options = roundTrips(row, [row, candidate({ id: 'load-b' })]);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe('load-b');
    expect(options[0].deadheadKm).toBeCloseTo(22, 0); // Toronto -> Mississauga
    expect(options[0].netPerMile).toBeLessThan(options[0].grossPerMile as number);
  });

  it('never pairs a load with itself', () => {
    expect(roundTrips(row, [row])).toEqual([]);
  });

  it('drops a load whose pickup is nowhere near our delivery', () => {
    // A Montreal pickup is 500 km from the Toronto delivery.
    const far = candidate({ id: 'load-far', originLat: MONTREAL.lat, originLon: MONTREAL.lon });
    expect(roundTrips(row, [far])).toEqual([]);
  });

  it('returns nothing when this load has no delivery coordinate to pair from', () => {
    expect(roundTrips({ ...row, destinationLat: null, destinationLon: null }, [candidate({ id: 'b' })])).toEqual([]);
  });

  it('drops a candidate that cannot be picked up after we deliver', () => {
    const impossible = candidate({ id: 'too-early', pickupDate: '2026-10-01T08:00:00.000Z' });
    expect(roundTrips(row, [impossible])).toEqual([]);
  });

  it('still pairs when either side is missing a date', () => {
    const noDates = candidate({ id: 'undated', pickupDate: null });
    expect(roundTrips(row, [noDates]).map((o) => o.id)).toEqual(['undated']);
    const undatedRow = { ...row, deliveryDate: null };
    expect(roundTrips(undatedRow, [candidate({ id: 'c' })]).map((o) => o.id)).toEqual(['c']);
  });

  it('drops candidates with no distance or no amount rather than ranking a partial figure', () => {
    const noKm = candidate({ id: 'no-km', distanceKmEstimate: null });
    const noMoney = candidate({ id: 'no-money', freightAmountBase: null, freightAmountTransaction: null });
    const noCoords = candidate({ id: 'no-coords', originLat: null, originLon: null });
    expect(roundTrips(row, [noKm, noMoney, noCoords])).toEqual([]);
  });

  it('ranks by what the second leg earns per mile, empty hop included', () => {
    const near = candidate({ id: 'near', freightAmountBase: '1250.00' }); // 22 km hop
    const slightlyFarther = candidate({
      id: 'farther',
      originLat: OAKVILLE.lat,
      originLon: OAKVILLE.lon,
      freightAmountBase: '1250.00',
    }); // 32 km hop, same money: the empty kilometres decide it
    const options = roundTrips(row, [slightlyFarther, near]);
    expect(options.map((o) => o.id)).toEqual(['near', 'farther']);
    expect(options[0].netPerMile).toBeGreaterThan(options[1].netPerMile as number);
  });

  it('prefers the trailer we are pulling without excluding the others', () => {
    const reefer = candidate({ id: 'reefer', equipmentType: 'REEFER', freightAmountBase: '3000.00' });
    const van = candidate({ id: 'van', equipmentType: 'DRY_VAN', freightAmountBase: '1500.00' });
    const options = roundTrips(row, [reefer, van]);
    // The reefer pays twice as much per mile but does not fit the trailer.
    expect(options.map((o) => o.id)).toEqual(['van', 'reefer']);
    expect(options.find((o) => o.id === 'van')?.sameEquipment).toBe(true);
    expect(options.find((o) => o.id === 'reefer')?.sameEquipment).toBe(false);
  });

  it('reports a null gross rate when a candidate has no loaded distance', () => {
    const options = roundTrips(row, [candidate({ id: 'x', distanceKmEstimate: null })]);
    expect(options).toEqual([]);
  });

  it('caps the list and stays deterministic', () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      candidate({ id: `load-${i}`, freightAmountBase: String(1000 + i * 50) }),
    );
    const first = roundTrips(row, pool);
    expect(first).toHaveLength(ROUND_TRIP_MAX);
    expect(first.map((o) => o.id)).toEqual(roundTrips(row, [...pool].reverse()).map((o) => o.id));
  });

  it('takes an explicit radius and equipment preference', () => {
    const far = candidate({ id: 'ottawa', originLat: OTTAWA.lat, originLon: OTTAWA.lon, equipmentType: 'FLATBED' });
    expect(roundTrips(row, [far])).toEqual([]); // 350 km: outside the default radius
    const options = roundTrips(row, [far], { radiusKm: 400, equipmentType: 'FLATBED', max: 1 });
    expect(options.map((o) => o.id)).toEqual(['ottawa']);
    expect(options[0].sameEquipment).toBe(true);
  });
});
