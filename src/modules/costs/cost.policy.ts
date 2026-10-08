import { KM_PER_MILE } from '../board/board.earning';

/**
 * What a truck costs to run, per mile.
 *
 * The point of this module is not the arithmetic — that is a division. The point
 * is that a cost per mile is only as honest as its list of omissions, so the
 * omissions are part of the return type rather than a footnote on a screen
 * somebody may not read. Maintenance has no model in this product (see
 * GAP_ANALYSIS 2.6) and no toll feed exists, so both are always declared as
 * excluded; when they are built, they move out of that list and into the total,
 * and the number on screen is allowed to change.
 *
 * Pure and dependency-free so the figures can be unit-tested exactly.
 */

/**
 * Cost buckets this product deliberately does not know about yet. Named in the
 * response so the screen can say what the figure leaves out: a cost per mile
 * that quietly omits a third of the cost is worse than no figure at all.
 */
export const EXCLUDED_COSTS = ['MAINTENANCE', 'TOLLS'] as const;
export type ExcludedCost = (typeof EXCLUDED_COSTS)[number];

/**
 * Loaded kilometres are derived, not stored: a `RouteSegment` carries a
 * distance and a time but no "was I loaded" flag, so a segment counts as loaded
 * only while a load was actually assigned to that unit. It is an approximation
 * of the truth — a truck running home empty under an assignment counts as
 * loaded — and the response says so rather than presenting it as measured.
 */
export type MileageBasis = 'ASSIGNMENT_WINDOW';

export interface CostBuckets {
  /** Fuel bought for the unit, in base currency. */
  fuel: number;
  /** Declared fixed cost (truck payment, insurance, permits) for the window. */
  fixed: number;
}

export interface CostInput extends CostBuckets {
  loadedKm: number;
  emptyKm: number;
  /** Detention recovered in the window — revenue, never part of the cost. */
  detentionRecovered?: number;
  detentionMinutes?: number;
  currency?: string;
}

export interface CostPerMile {
  currency: string;
  buckets: CostBuckets;
  totalCost: number;
  loadedKm: number;
  emptyKm: number;
  totalKm: number;
  /** Whole cost of running the unit over every kilometre it moved. */
  costPerMile: number | null;
  /**
   * Whole cost over *loaded* kilometres only. This is the number a rate has to
   * beat, and the reason a carrier runs one at all.
   */
  costPerLoadedMile: number | null;
  /** Share of kilometres run empty. Rising means the board is being used badly. */
  emptyRatio: number | null;
  /** Revenue, kept visibly apart from cost. */
  detentionRecovered: number;
  detentionMinutes: number;
  excludedCosts: ExcludedCost[];
  mileageBasis: MileageBasis;
}

function clean(n: number | undefined | null): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Declared daily fixed cost (in cents) over a window of days, in base currency. */
export function fixedCostFor(centsPerDay: number | null | undefined, days: number): number {
  if (centsPerDay === null || centsPerDay === undefined) return 0;
  const cents = Number(centsPerDay);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return (cents / 100) * Math.max(0, days);
}

/** Number of whole days between two instants, with a same-day window counting as one. */
export function daysBetween(from: Date, to: Date): number {
  const ms = Math.max(0, to.getTime() - from.getTime());
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) || 1);
}

/**
 * A run of kilometres is loaded while a load was assigned to the unit. Windows
 * are `[assignedAt, deliveredAt]`; an open window (no delivery yet) runs to now.
 */
export interface AssignmentWindow {
  assignedAt: Date;
  deliveredAt: Date | null;
}

export interface MileageSegment {
  startTime: Date;
  distanceKm: number;
}

export interface Mileage {
  loadedKm: number;
  emptyKm: number;
}

export function classifyMileage(
  segments: readonly MileageSegment[],
  windows: readonly AssignmentWindow[],
): Mileage {
  let loadedKm = 0;
  let emptyKm = 0;
  for (const segment of segments) {
    const km = Number(segment.distanceKm);
    if (!Number.isFinite(km) || km <= 0) continue;
    const at = segment.startTime.getTime();
    const loaded = windows.some((w) => {
      const start = w.assignedAt.getTime();
      const end = w.deliveredAt ? w.deliveredAt.getTime() : Number.POSITIVE_INFINITY;
      return at >= start && at <= end;
    });
    if (loaded) loadedKm += km;
    else emptyKm += km;
  }
  return { loadedKm, emptyKm };
}

export function buildCostPerMile(input: CostInput): CostPerMile {
  const fuel = clean(input.fuel);
  const fixed = clean(input.fixed);
  const loadedKm = clean(input.loadedKm);
  const emptyKm = clean(input.emptyKm);
  const totalKm = loadedKm + emptyKm;
  const totalCost = fuel + fixed;

  const per = (km: number): number | null => (km > 0 ? totalCost / (km * KM_PER_MILE) : null);

  return {
    currency: input.currency ?? 'CAD',
    buckets: { fuel, fixed },
    totalCost,
    loadedKm,
    emptyKm,
    totalKm,
    costPerMile: per(totalKm),
    costPerLoadedMile: per(loadedKm),
    emptyRatio: totalKm > 0 ? emptyKm / totalKm : null,
    detentionRecovered: clean(input.detentionRecovered),
    detentionMinutes: Math.max(0, Number(input.detentionMinutes ?? 0) || 0),
    excludedCosts: [...EXCLUDED_COSTS],
    mileageBasis: 'ASSIGNMENT_WINDOW',
  };
}

/**
 * Cost per mile across a fleet: every bucket summed, every kilometre summed.
 * Averaging per-unit figures would weight a truck that ran 40 km the same as one
 * that ran 4,000.
 */
export function rollUp(units: readonly CostPerMile[]): CostPerMile {
  return buildCostPerMile({
    fuel: units.reduce((a, u) => a + u.buckets.fuel, 0),
    fixed: units.reduce((a, u) => a + u.buckets.fixed, 0),
    loadedKm: units.reduce((a, u) => a + u.loadedKm, 0),
    emptyKm: units.reduce((a, u) => a + u.emptyKm, 0),
    detentionRecovered: units.reduce((a, u) => a + u.detentionRecovered, 0),
    detentionMinutes: units.reduce((a, u) => a + u.detentionMinutes, 0),
    currency: units[0]?.currency ?? 'CAD',
  });
}

/**
 * Money left on the table by never starting the clock: hours a truck actually
 * stood at a dock that nobody billed at the load's detention rate.
 *
 * Reported as a range is tempting and dishonest; reported as a single number it
 * needs its assumption stated, so the caller passes the rate it used and the
 * screen prints it.
 */
export function unclaimedDetention(minutes: number, ratePerHour: number | null): number | null {
  if (ratePerHour === null || ratePerHour <= 0 || minutes <= 0) return null;
  return (minutes / 60) * ratePerHour;
}
