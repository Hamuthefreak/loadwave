import {
  buildCostPerMile,
  classifyMileage,
  daysBetween,
  EXCLUDED_COSTS,
  fixedCostFor,
  rollUp,
  unclaimedDetention,
} from '../../src/modules/costs/cost.policy';
import { KM_PER_MILE } from '../../src/modules/board/board.earning';

const day = (iso: string): Date => new Date(iso);

describe('declared fixed cost', () => {
  it('turns cents per day into base currency over a window', () => {
    expect(fixedCostFor(5000, 30)).toBeCloseTo(1500, 6);
    expect(fixedCostFor(1000, 1)).toBeCloseTo(10, 6);
  });

  it('counts nothing when the owner has declared nothing', () => {
    expect(fixedCostFor(null, 30)).toBe(0);
    expect(fixedCostFor(0, 30)).toBe(0);
    expect(fixedCostFor(-100, 30)).toBe(0);
  });

  it('counts a same-day window as one day, never zero', () => {
    const from = day('2026-10-01T00:00:00Z');
    expect(daysBetween(from, day('2026-10-01T23:00:00Z'))).toBe(1);
    expect(daysBetween(from, day('2026-10-31T00:00:00Z'))).toBe(30);
  });
});

describe('loaded versus empty kilometres', () => {
  const windows = [{ assignedAt: day('2026-10-02T08:00:00Z'), deliveredAt: day('2026-10-02T20:00:00Z') }];

  it('counts a run as loaded while a load was assigned to the unit', () => {
    const mileage = classifyMileage(
      [
        { startTime: day('2026-10-02T10:00:00Z'), distanceKm: 400 }, // loaded
        { startTime: day('2026-10-03T09:00:00Z'), distanceKm: 120 }, // after delivery: empty
      ],
      windows,
    );
    expect(mileage).toEqual({ loadedKm: 400, emptyKm: 120 });
  });

  it('keeps an open assignment loaded — the truck is on it right now', () => {
    const mileage = classifyMileage(
      [{ startTime: day('2026-10-05T12:00:00Z'), distanceKm: 250 }],
      [{ assignedAt: day('2026-10-04T08:00:00Z'), deliveredAt: null }],
    );
    expect(mileage).toEqual({ loadedKm: 250, emptyKm: 0 });
  });

  it('calls every kilometre empty when nothing was ever assigned', () => {
    const mileage = classifyMileage(
      [{ startTime: day('2026-10-02T10:00:00Z'), distanceKm: 400 }],
      [],
    );
    expect(mileage).toEqual({ loadedKm: 0, emptyKm: 400 });
  });

  it('ignores segments with no usable distance', () => {
    const mileage = classifyMileage(
      [
        { startTime: day('2026-10-02T10:00:00Z'), distanceKm: 0 },
        { startTime: day('2026-10-02T11:00:00Z'), distanceKm: Number.NaN },
        { startTime: day('2026-10-02T12:00:00Z'), distanceKm: 50 },
      ],
      windows,
    );
    expect(mileage).toEqual({ loadedKm: 50, emptyKm: 0 });
  });
});

describe('cost per mile', () => {
  it('adds the buckets and divides over every mile the unit moved', () => {
    const cost = buildCostPerMile({ fuel: 1000, fixed: 500, loadedKm: 800, emptyKm: 200 });
    expect(cost.totalCost).toBe(1500);
    expect(cost.totalKm).toBe(1000);
    expect(cost.costPerMile).toBeCloseTo(1500 / (1000 * KM_PER_MILE), 6);
    // Loaded miles only makes the same cost look worse — which is the point.
    expect(cost.costPerLoadedMile).toBeCloseTo(1500 / (800 * KM_PER_MILE), 6);
    expect(cost.costPerLoadedMile).toBeGreaterThan(cost.costPerMile as number);
    expect(cost.emptyRatio).toBeCloseTo(0.2, 6);
  });

  it('states what the figure leaves out, always', () => {
    const cost = buildCostPerMile({ fuel: 100, fixed: 0, loadedKm: 100, emptyKm: 0 });
    expect(cost.excludedCosts).toEqual([...EXCLUDED_COSTS]);
    expect(cost.excludedCosts).toContain('MAINTENANCE');
    expect(cost.excludedCosts).toContain('TOLLS');
    expect(cost.mileageBasis).toBe('ASSIGNMENT_WINDOW');
  });

  it('reports cost without inventing a per-mile figure when the truck did not move', () => {
    const cost = buildCostPerMile({ fuel: 400, fixed: 300, loadedKm: 0, emptyKm: 0 });
    expect(cost.totalCost).toBe(700);
    expect(cost.costPerMile).toBeNull();
    expect(cost.costPerLoadedMile).toBeNull();
    expect(cost.emptyRatio).toBeNull();
  });

  it('reports no cost per loaded mile when every kilometre was empty', () => {
    const cost = buildCostPerMile({ fuel: 900, fixed: 0, loadedKm: 0, emptyKm: 600 });
    expect(cost.costPerMile).not.toBeNull();
    expect(cost.costPerLoadedMile).toBeNull();
    expect(cost.emptyRatio).toBe(1);
  });

  it('keeps detention recovered out of the cost and visible beside it', () => {
    const cost = buildCostPerMile({
      fuel: 100,
      fixed: 0,
      loadedKm: 500,
      emptyKm: 0,
      detentionRecovered: 275,
      detentionMinutes: 90,
    });
    expect(cost.totalCost).toBe(100);
    expect(cost.detentionRecovered).toBe(275);
    expect(cost.detentionMinutes).toBe(90);
  });

  it('ignores negative and non-numeric inputs rather than subtracting cost', () => {
    const cost = buildCostPerMile({
      fuel: -50,
      fixed: Number.NaN,
      loadedKm: -10,
      emptyKm: 0,
    });
    expect(cost.totalCost).toBe(0);
    expect(cost.totalKm).toBe(0);
  });
});

describe('fleet roll-up', () => {
  it('sums buckets and kilometres instead of averaging the units', () => {
    // A truck that ran 10,000 km cheaply and one that ran 100 km expensively:
    // averaging their per-mile figures would weight them the same.
    const busy = buildCostPerMile({ fuel: 10_000, fixed: 0, loadedKm: 10_000, emptyKm: 0 });
    const idle = buildCostPerMile({ fuel: 1_000, fixed: 0, loadedKm: 100, emptyKm: 0 });
    const meanOfMeans = ((busy.costPerMile as number) + (idle.costPerMile as number)) / 2;
    const fleet = rollUp([busy, idle]);
    expect(fleet.buckets.fuel).toBe(11_000);
    expect(fleet.loadedKm).toBe(10_100);
    expect(fleet.costPerMile).toBeCloseTo(11_000 / (10_100 * KM_PER_MILE), 6);
    expect(fleet.costPerMile).toBeLessThan(meanOfMeans);
  });

  it('answers an empty fleet without dividing by zero', () => {
    const fleet = rollUp([]);
    expect(fleet.totalCost).toBe(0);
    expect(fleet.costPerMile).toBeNull();
    expect(fleet.detentionMinutes).toBe(0);
  });
});

describe('unclaimed detention', () => {
  it('prices hours nobody billed at the load rate', () => {
    expect(unclaimedDetention(90, 110)).toBeCloseTo(165, 6);
  });

  it('says nothing when there is no rate to price against', () => {
    expect(unclaimedDetention(90, null)).toBeNull();
    expect(unclaimedDetention(90, 0)).toBeNull();
    expect(unclaimedDetention(0, 110)).toBeNull();
  });
});
