import { d, type Decimal } from '../../utils/decimal';

export interface JurisdictionTotals {
  jurisdictionCode: string;
  totalKm: Decimal;
  taxableKm: Decimal;
  litresPurchased: Decimal;
}

export interface IftaSummaryRow {
  tenantId: string;
  quarter: string;
  assetId: string | null;
  fuelType: string;
  jurisdictionCode: string;
  totalKm: Decimal;
  taxableKm: Decimal;
  litresPurchased: Decimal;
  litresConsumed: Decimal;
  averageConsumption: Decimal;
  netLitres: Decimal;
  jurisdictionRate: Decimal;
  netTaxDueBase: Decimal;
}

export interface ComputeOptions {
  tenantId: string;
  quarter: string;
  assetId: string | null;
  fuelType?: string;
}

/**
 * Average fleet consumption in L/km (IFTA uses the fleet average per fuel type):
 *   total litres purchased / total kilometres travelled
 */
export function fleetAverageConsumption(totals: JurisdictionTotals[]): Decimal {
  let totalKm = d(0);
  let totalLitres = d(0);
  for (const t of totals) {
    totalKm = totalKm.plus(t.totalKm);
    totalLitres = totalLitres.plus(t.litresPurchased);
  }
  return totalKm.gt(0) ? totalLitres.dividedBy(totalKm) : d(0);
}

export function netLitresFor(
  totalKm: Decimal,
  litresPurchased: Decimal,
  averageConsumption: Decimal,
): Decimal {
  return totalKm.times(averageConsumption).minus(litresPurchased);
}

export function netTaxDue(netLitres: Decimal, jurisdictionRate: Decimal): Decimal {
  return netLitres.times(jurisdictionRate);
}

/**
 * Computes the per-jurisdiction quarterly summary rows for one asset (or the
 * fleet when assetId is null). Matches the QC CAZ-510 and Ontario IFTA
 * quarterly schedule structure: total km + taxable km, litres purchased and
 * estimated litres consumed per jurisdiction, and net tax due.
 */
export function computeQuarterSummaries(
  totals: JurisdictionTotals[],
  rates: Record<string, string | number | Decimal>,
  opts: ComputeOptions,
): IftaSummaryRow[] {
  const averageConsumption = fleetAverageConsumption(totals);
  const fuelType = opts.fuelType ?? 'DSL';

  return totals.map((t) => {
    const litresConsumed = t.totalKm.times(averageConsumption);
    const litres = {
      jurisdictionCode: t.jurisdictionCode,
      totalKm: t.totalKm,
      taxableKm: t.taxableKm,
      litresPurchased: t.litresPurchased,
      litresConsumed,
      averageConsumption,
      netLitres: netLitresFor(t.totalKm, t.litresPurchased, averageConsumption),
    };
    const rate = d(rates[t.jurisdictionCode] ?? 0);
    return {
      tenantId: opts.tenantId,
      quarter: opts.quarter,
      assetId: opts.assetId,
      fuelType,
      jurisdictionCode: t.jurisdictionCode,
      totalKm: litres.totalKm,
      taxableKm: litres.taxableKm,
      litresPurchased: litres.litresPurchased,
      litresConsumed: litres.litresConsumed,
      averageConsumption,
      netLitres: litres.netLitres,
      jurisdictionRate: rate,
      netTaxDueBase: netTaxDue(litres.netLitres, rate),
    };
  });
}
