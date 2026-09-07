/**
 * Pure mapping from a driver's last fuel stop to form defaults, so the
 * fuel modal (and tests) share one source of truth. Lives in the backend
 * src so the root tsconfig/jest can cover it.
 */

export interface FuelStopRow {
  volumeLitres: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  transactionCurrency: string;
  jurisdictionCode: string;
  amountTransaction?: string | null;
}

export interface FuelPrefill {
  jurisdiction: string;
  currency: 'CAD' | 'USD';
  unit: 'L' | 'GAL';
  /** Volume in the preferred unit (gallons are converted from litres). */
  volume: string;
  /** Total paid on the last stop (only populated for "repeat last stop"). */
  amount: string;
}

export const LITRES_PER_GAL = 3.78541;

/** Round to one decimal without floating-point noise. */
function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Map the last fuel stop to prefill values.
 *
 * Normal open: jurisdiction / currency / unit are restored but volume is
 * left blank — each fill differs. With `withAmounts` (the "repeat last
 * stop" chip), the previous volume and total are copied too.
 */
export function mapLastStopToPrefill(
  last: FuelStopRow | null | undefined,
  withAmounts = false,
): FuelPrefill | null {
  if (!last) return null;

  const gal = last.originalVolumeUnit === 'GAL';
  const volumeLitres = Number(last.volumeLitres || 0);

  return {
    jurisdiction: last.jurisdictionCode || 'QC',
    currency: last.transactionCurrency === 'USD' ? 'USD' : 'CAD',
    unit: gal ? 'GAL' : 'L',
    volume: withAmounts ? (gal ? round1(volumeLitres / LITRES_PER_GAL) : round1(volumeLitres)) : '',
    amount: withAmounts ? (last.amountTransaction ? round1(Number(last.amountTransaction)) : '') : '',
  };
}

/**
 * Most frequent jurisdiction/unit combo across the recent stops (newest
 * wins ties), falling back to the newest stop when the history is too
 * short or evenly split. Used so the modal opens where the driver most
 * often fuels, not just where they last did.
 */
export function mostCommonStopPrefill(
  stops: FuelStopRow[] | null | undefined,
): FuelPrefill | null {
  if (!stops || stops.length === 0) return null;
  if (stops.length === 1) return mapLastStopToPrefill(stops[0]);

  const counts = new Map<string, { count: number; newestIdx: number; stop: FuelStopRow }>();
  stops.forEach((stop, i) => {
    const key = `${stop.jurisdictionCode || 'QC'}|${stop.originalVolumeUnit === 'GAL' ? 'GAL' : 'L'}`;
    const cur = counts.get(key);
    if (cur) {
      cur.count += 1;
      if (i < cur.newestIdx) cur.newestIdx = i;
    } else {
      counts.set(key, { count: 1, newestIdx: i, stop });
    }
  });

  let best: { count: number; newestIdx: number; stop: FuelStopRow } | null = null;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.newestIdx < best.newestIdx)
    ) {
      best = entry;
    }
  }
  return best ? mapLastStopToPrefill(best.stop) : mapLastStopToPrefill(stops[0]);
}

/**
 * IFTA nudge: true when the last `min` stops are all in the same
 * jurisdiction — worth telling the driver to plan cheaper fuel states.
 */
export function sameJurisdictionStreak(
  stops: FuelStopRow[] | null | undefined,
  min = 3,
): string | null {
  if (!stops || stops.length < min) return null;
  const recent = stops.slice(0, min);
  const first = recent[0]?.jurisdictionCode;
  if (!first) return null;
  return recent.every((s) => s.jurisdictionCode === first) ? first : null;
}