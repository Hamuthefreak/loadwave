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