/**
 * Payroll variance — why this week's number differs from the driver's norm.
 *
 * A settlement statement answers "what is owed". It does not answer the question
 * the owner actually asks on Monday: *this is $400 more than usual, why?* — and
 * the books cannot say, because every load on the page looks like every other
 * load. Somebody ends up comparing two printouts by hand.
 *
 * This module is the answer, and the honesty of it is the point. A variance has
 * three causes and they are separated rather than blended: the driver carried a
 * different number of loads (volume), the loads paid differently per load
 * (rate), or the waiting time paid differently (detention). The three are
 * computed so they sum *exactly* to the change — an accountant checking the page
 * with a calculator must arrive at the same number, and a decomposition that is
 * off by a cent is a decomposition nobody will trust again.
 *
 * Loads are then ranked by how far they moved the week, and each one is labelled
 * with a cause. Nothing is invented: a load is only called "below your normal
 * lane rate" when there is a real trailing average on that lane behind the
 * claim, and estimates (what a load that could not be priced would have been
 * worth) are marked as estimates in the copy and in the field name.
 *
 * Pure by design — no clock, no database — so the arithmetic, the thresholds and
 * the parity between the components and the total are unit-tested rather than
 * eyeballed on a live statement.
 */

import type { Statement, StatementLine } from './settlement.policy';

/**
 * A lane is only a comparison once the driver has actually run it twice. One
 * previous load is an anecdote: it would turn an unusual week into a permanent
 * "normal" for that lane, and every later load would read as a deviation from it.
 */
export const MIN_LANE_SAMPLES = 2;

/**
 * How far off a lane has to be, in cents per mile, before it is worth a
 * conversation. Fuel moves a lane's economics by a few cents week to week, and a
 * report that flags ±2¢ is a report that is ignored by the third week.
 */
export const LANE_BAND_PER_MILE_CENTS = 6;

/** Waiting has to be a real share of the load before it explains anything. */
export const DETENTION_SHARE = 0.25;
export const DETENTION_MIN_HOURS = 2;

/** Enough flagged loads to explain the week; the rest are counted, not listed. */
export const MAX_LISTED_SHIFTS = 6;

/** How many trailing weeks the report reaches back over when asked for nothing. */
export const DEFAULT_HISTORY_WEEKS = 4;
export const MAX_HISTORY_WEEKS = 12;

/**
 * The smallest trailing average worth expressing a percentage against.
 *
 * A new driver with one short week behind them turns a normal $650 week into
 * "+1612%", which is arithmetically true and reads as a broken page. Below this
 * floor the change is still reported in money — the figure an owner acts on —
 * and the percentage is simply not claimed.
 */
export const MIN_PERCENT_BASE_CENTS = 10_000;

export type ShiftReason =
  | 'UNPRICED'
  | 'NO_DISTANCE'
  | 'LANE_BELOW'
  | 'LANE_ABOVE'
  | 'DETENTION_UNPAID'
  | 'DETENTION_HEAVY';

/** Which way the load moved the week's number. */
export type ShiftDirection = 'UP' | 'DOWN';

export interface LoadShift {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  /** What the load paid this week, in cents. */
  payCents: number;
  /** How that was worked out — the same basis string as the statement. */
  basis: string;
  reason: ShiftReason;
  direction: ShiftDirection;
  /** One line, in the owner's language: what happened. */
  headline: string;
  /** The arithmetic behind the headline, so it can be checked. */
  detail: string;
  /** How much this load moved the week, always positive. Ranking uses this. */
  impactCents: number;
  /** True when impactCents was inferred from this driver's own history. */
  estimated: boolean;
  payPerMileCents: number | null;
  laneAveragePerMileCents: number | null;
}

export interface VarianceComponents {
  /** What the change in load count is worth at the driver's normal pay per load. */
  volumeCents: number;
  /** Everything left after volume and detention: the loads themselves paying differently. */
  rateCents: number;
  detentionCents: number;
  /** Always equal to the current total minus the trailing average. */
  totalCents: number;
}

export interface VarianceWeek {
  label: string;
  totalPayCents: number;
  loads: number;
  miles: number;
  detentionCents: number;
}

export interface TrailingBasis {
  /** How many weeks were asked for. */
  weeks: number;
  /** How many of them the driver actually worked — the average is over these. */
  activeWeeks: number;
  averageTotalPayCents: number;
  averageLoads: number;
  averageMiles: number;
  /** Null when the driver has no paid history to average. */
  averagePayPerLoadCents: number | null;
  averagePayPerMileCents: number | null;
  /** Average detention per *active* week, so a week off does not halve it. */
  averageDetentionCents: number;
  /** Average detention cents per hour actually logged, or null with none. */
  detentionPerHourCents: number | null;
  weeks_detail: VarianceWeek[];
}

export interface DriverVariance {
  driverId: string;
  driverName: string;
  payLabel: string;
  period: { from: string; to: string; label: string };
  current: {
    totalPayCents: number;
    payCents: number;
    detentionCents: number;
    loads: number;
    miles: number;
    unpricedLoads: number;
    payPerMileCents: number | null;
    payPerLoadCents: number | null;
  };
  basis: TrailingBasis;
  components: VarianceComponents;
  /** Percentage change against the trailing average, null with no basis. */
  percentChange: number | null;
  /** Flagged loads, biggest movers first. */
  shifts: LoadShift[];
  /** Flagged loads left out of `shifts` by the listing cap. */
  shiftsOmitted: number;
}

export interface VarianceReport {
  period: { from: string; to: string; label: string };
  weeks: number;
  drivers: DriverVariance[];
  totals: {
    currentPayCents: number;
    trailingAverageCents: number;
    changeCents: number;
    flaggedLoads: number;
    /** Drivers on payroll but with nothing to compare against yet. */
    withoutBasis: number;
  };
  /** Drivers who keep their own revenue, so payroll variance does not apply. */
  offPayroll: number;
  notes: string[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/** Per-mile pay for one line, or null when it is not a per-mile question. */
export function linePerMileCents(line: StatementLine): number | null {
  const miles = line.miles ?? 0;
  if (miles <= 0) return null;
  return Math.round((line.baseCents + line.detentionCents) / miles);
}

interface LaneNorm {
  perMileCents: number;
  samples: number;
  totalCents: number;
  miles: number;
}

/**
 * Trailing per-mile norms per lane, from history only.
 *
 * Detention is included in the numerator because it is part of what that lane
 * actually put in the driver's pocket; excluding it would make a lane that
 * reliably detains look generous on the haul and then flag every detention.
 */
export function laneNorms(historyLines: readonly StatementLine[]): Map<string, LaneNorm> {
  const acc = new Map<string, { totalCents: number; miles: number; samples: number }>();
  for (const line of historyLines) {
    const miles = line.miles ?? 0;
    if (miles <= 0 || !line.priced) continue;
    const bucket = acc.get(line.lane) ?? { totalCents: 0, miles: 0, samples: 0 };
    bucket.totalCents += line.baseCents + line.detentionCents;
    bucket.miles += miles;
    bucket.samples += 1;
    acc.set(line.lane, bucket);
  }
  const norms = new Map<string, LaneNorm>();
  for (const [lane, b] of acc) {
    if (b.samples < MIN_LANE_SAMPLES || b.miles <= 0) continue;
    norms.set(lane, {
      perMileCents: Math.round(b.totalCents / b.miles),
      samples: b.samples,
      totalCents: b.totalCents,
      miles: b.miles,
    });
  }
  return norms;
}

/** The trailing average a driver's current week is measured against. */
export function trailingBasis(history: readonly Statement[], weeks: number): TrailingBasis {
  const worked = history.filter((s) => s.totals.loads > 0);
  const totals = history.map((s) => s.totals);
  const totalMiles = worked.reduce((a, s) => a + s.totals.miles, 0);

  // Pay per load is averaged over the *active* weeks only. A week off would
  // otherwise drag the norm down and make a normal week look like a windfall.
  const payPerLoad = worked
    .filter((s) => s.totals.loads > 0)
    .map((s) => s.totals.payCents / s.totals.loads);

  // The per-hour figure is drawn from the lines, not the totals: a statement
  // counts hours it never paid for, and dividing paid cents by unpaid hours would
  // report a rate of $0/h as if it were one. Only hours that actually settled
  // have a rate to quote.
  let paidDetentionHours = 0;
  let paidDetentionCents = 0;
  for (const statement of worked) {
    for (const line of statement.lines) {
      if (line.detentionCents > 0 && line.detentionHours > 0) {
        paidDetentionHours += line.detentionHours;
        paidDetentionCents += line.detentionCents;
      }
    }
  }

  return {
    weeks,
    activeWeeks: worked.length,
    averageTotalPayCents: Math.round(mean(totals.map((t) => t.totalPayCents))),
    averageLoads: mean(totals.map((t) => t.loads)),
    averageMiles: Math.round(mean(totals.map((t) => t.miles)) * 10) / 10,
    averagePayPerLoadCents: payPerLoad.length > 0 ? Math.round(mean(payPerLoad)) : null,
    averagePayPerMileCents:
      totalMiles > 0
        ? Math.round(worked.reduce((a, s) => a + s.totals.totalPayCents, 0) / totalMiles)
        : null,
    averageDetentionCents: Math.round(mean(worked.map((s) => s.totals.detentionCents))),
    detentionPerHourCents:
      paidDetentionHours > 0 ? Math.round(paidDetentionCents / paidDetentionHours) : null,
    weeks_detail: history.map((s) => ({
      label: s.period.label,
      totalPayCents: s.totals.totalPayCents,
      loads: s.totals.loads,
      miles: s.totals.miles,
      detentionCents: s.totals.detentionCents,
    })),
  };
}

/**
 * Split the change into volume, rate and detention so the parts sum exactly.
 *
 * Volume is valued at the driver's *normal* pay per load, which is what makes
 * the three additive rather than merely illustrative: rate is then defined as
 * whatever volume and detention do not explain, so there is no residual term and
 * no rounding slop to apologise for.
 */
export function decompose(
  current: Statement,
  basis: TrailingBasis,
): VarianceComponents {
  const currentPay = current.totals.payCents;
  const currentDetention = current.totals.detentionCents;
  const loads = current.totals.loads;

  // The trailing average total already has detention inside it, so the haul
  // figure it is compared against has to have detention taken back out.
  const baseHaul = basis.averageTotalPayCents - basis.averageDetentionCents;
  const baseLoads = basis.averageLoads;
  const basePerLoad = baseLoads > 0 ? baseHaul / baseLoads : 0;

  const volumeCents = Math.round((loads - baseLoads) * basePerLoad);
  const totalCents = currentPay + currentDetention - basis.averageTotalPayCents;
  const detentionCents = currentDetention - basis.averageDetentionCents;

  return {
    volumeCents,
    // Defined as the remainder: current haul pay, minus what volume explains,
    // minus the haul pay the normal week carried.
    rateCents: currentPay - volumeCents - baseHaul,
    detentionCents,
    totalCents,
  };
}

function linePayPerMileDetail(line: StatementLine, norm: LaneNorm): string {
  const miles = line.miles ?? 0;
  const actual = linePerMileCents(line) ?? 0;
  const delta = actual - norm.perMileCents;
  const money = Math.abs(Math.round((delta * miles) / 100));
  return `${line.lane} has averaged ${norm.perMileCents}¢/mi across ${norm.samples} loads for you; this one paid ${actual}¢/mi over ${Math.round(miles)} mi — about $${money} ${delta < 0 ? 'light' : 'better'}.`;
}

/**
 * The loads that moved the week, biggest first.
 *
 * A load is flagged only when there is a defensible reason and a defensible
 * size, and each flag carries its own arithmetic so the reader does not have to
 * take the label on faith.
 */
export function shiftFlags(
  currentLines: readonly StatementLine[],
  historyLines: readonly StatementLine[],
  basis: TrailingBasis,
): LoadShift[] {
  const norms = laneNorms(historyLines);
  const shifts: LoadShift[] = [];

  for (const line of currentLines) {
    const miles = line.miles ?? 0;
    const perMile = linePerMileCents(line);

    // Nothing paid at all: the only question is whether we can say why.
    if (!line.priced && line.baseCents === 0 && line.detentionCents === 0) {
      const noDistance = miles <= 0;
      shifts.push({
        loadId: line.loadId,
        reference: line.reference,
        lane: line.lane,
        deliveredAt: line.deliveredAt,
        payCents: line.totalCents,
        basis: line.basis,
        reason: noDistance ? 'NO_DISTANCE' : 'UNPRICED',
        direction: 'DOWN',
        headline: noDistance ? 'No mileage, so no pay' : 'Could not be priced',
        detail: noDistance
          ? basis.averagePayPerLoadCents == null
            ? 'The loadboard gave no distance for this load, so per-mile pay works out to nothing.'
            : `The loadboard gave no distance, so per-mile pay works out to nothing — your other loads average about $${(basis.averagePayPerLoadCents / 100).toFixed(0)} each.`
          : `This load could not be priced against your pay profile (${line.basis.toLowerCase()}).`,
        impactCents: basis.averagePayPerLoadCents ?? 0,
        estimated: basis.averagePayPerLoadCents != null,
        payPerMileCents: perMile,
        laneAveragePerMileCents: norms.get(line.lane)?.perMileCents ?? null,
      });
      continue;
    }

    // Waiting hours that paid nothing: a rate was never set on the load.
    if (line.detentionHours > 0 && line.detentionCents === 0) {
      const perHour = basis.detentionPerHourCents;
      const impact = perHour == null ? 0 : Math.round(line.detentionHours * perHour);
      shifts.push({
        loadId: line.loadId,
        reference: line.reference,
        lane: line.lane,
        deliveredAt: line.deliveredAt,
        payCents: line.totalCents,
        basis: line.basis,
        reason: 'DETENTION_UNPAID',
        direction: 'DOWN',
        headline: 'Waiting time paid nothing',
        detail:
          perHour == null
            ? `${line.detentionHours.toFixed(1)} h of waiting is logged with no hourly rate on the load, so it pays nothing. Your other loads have not set a rate either, so there is nothing to estimate from.`
            : `${line.detentionHours.toFixed(1)} h of waiting is logged with no hourly rate on the load, so it pays nothing — your other loads work out at about $${(perHour / 100).toFixed(0)}/h.`,
        impactCents: impact,
        estimated: perHour != null,
        payPerMileCents: perMile,
        laneAveragePerMileCents: norms.get(line.lane)?.perMileCents ?? null,
      });
      continue;
    }

    const norm = norms.get(line.lane);
    if (norm && miles > 0 && perMile != null) {
      const delta = perMile - norm.perMileCents;
      // Cents: the deviation per mile, over the miles actually run.
      const impact = Math.abs(Math.round(delta * miles));
      if (Math.abs(delta) >= LANE_BAND_PER_MILE_CENTS && impact > 0) {
        shifts.push({
          loadId: line.loadId,
          reference: line.reference,
          lane: line.lane,
          deliveredAt: line.deliveredAt,
          payCents: line.totalCents,
          basis: line.basis,
          reason: delta < 0 ? 'LANE_BELOW' : 'LANE_ABOVE',
          direction: delta < 0 ? 'DOWN' : 'UP',
          headline:
            delta < 0 ? 'Below your normal rate on this lane' : 'Above your normal rate on this lane',
          detail: linePayPerMileDetail(line, norm),
          impactCents: impact,
          estimated: false,
          payPerMileCents: perMile,
          laneAveragePerMileCents: norm.perMileCents,
        });
      }
    }

    const share = line.totalCents > 0 ? line.detentionCents / line.totalCents : 0;
    if (line.detentionCents > 0 && line.detentionHours >= DETENTION_MIN_HOURS && share >= DETENTION_SHARE) {
      const excess = line.detentionCents - basis.averageDetentionCents;
      if (excess > 0) {
        shifts.push({
          loadId: line.loadId,
          reference: line.reference,
          lane: line.lane,
          deliveredAt: line.deliveredAt,
          payCents: line.totalCents,
          basis: line.basis,
          reason: 'DETENTION_HEAVY',
          direction: 'UP',
          headline: 'Waiting paid more than usual',
          detail: `${line.detentionHours.toFixed(1)} h of detention paid $${(line.detentionCents / 100).toFixed(2)} on this load (${line.detentionBasis ?? 'rate set on the load'}); your trailing weeks average $${(basis.averageDetentionCents / 100).toFixed(2)} of detention a week.`,
          impactCents: excess,
          estimated: false,
          payPerMileCents: perMile,
          // Left null: this flag is about waiting time, so carrying a lane rate
          // would suggest the claim rests on a comparison it does not make.
          laneAveragePerMileCents: null,
        });
      }
    }
  }

  // Biggest movers first; ties broken by reference so the order is stable
  // between renders rather than dependent on query order.
  return shifts.sort((a, b) => b.impactCents - a.impactCents || a.reference.localeCompare(b.reference));
}

/** Assemble one driver's row. Kept here so the service stays a data fetcher. */
export function driverVariance(input: {
  current: Statement;
  history: readonly Statement[];
  weeks: number;
}): DriverVariance {
  const { current } = input;
  const basis = trailingBasis(input.history, input.weeks);
  const historyLines = input.history.flatMap((s) => s.lines);
  const all = shiftFlags(current.lines, historyLines, basis);
  const shifts = all.slice(0, MAX_LISTED_SHIFTS);
  const components = decompose(current, basis);

  return {
    driverId: current.driverId,
    driverName: current.driverName,
    payLabel: current.payLabel,
    period: current.period,
    current: {
      totalPayCents: current.totals.totalPayCents,
      payCents: current.totals.payCents,
      detentionCents: current.totals.detentionCents,
      loads: current.totals.loads,
      miles: current.totals.miles,
      unpricedLoads: current.totals.unpricedLoads,
      payPerMileCents: current.totals.effectivePayPerMileCents,
      payPerLoadCents:
        current.totals.loads > 0
          ? Math.round(current.totals.totalPayCents / current.totals.loads)
          : null,
    },
    basis,
    components,
    percentChange:
      basis.averageTotalPayCents >= MIN_PERCENT_BASE_CENTS
        ? Math.round((components.totalCents / basis.averageTotalPayCents) * 1000) / 10
        : null,
    shifts,
    shiftsOmitted: all.length - shifts.length,
  };
}

/** One line summarising a driver's week, for the list view and notifications. */
export function varianceHeadline(row: DriverVariance): string {
  if (row.basis.activeWeeks === 0) {
    return row.current.loads === 0
      ? 'No delivered loads in this period and no trailing weeks to compare against.'
      : 'First week with a comparison — no trailing weeks to measure against yet.';
  }
  const direction = row.components.totalCents >= 0 ? 'up' : 'down';
  const percent = row.percentChange == null ? null : Math.abs(row.percentChange);
  const money = `$${(Math.abs(row.components.totalCents) / 100).toFixed(2)}`;
  const window = row.basis.activeWeeks === 1 ? 'week' : `${row.basis.activeWeeks} weeks`;
  if (percent == null) return `${money} ${direction} on the trailing ${window}.`;
  if (percent < 1) return 'In line with the trailing weeks.';
  return `${money} ${direction} (${percent.toFixed(1)}%) on the trailing ${window}.`;
}
