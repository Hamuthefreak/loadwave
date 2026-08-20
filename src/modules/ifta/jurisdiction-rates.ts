import { d, type Decimal } from '../../utils/decimal';

/**
 * Reference fuel tax rates (CAD $/L) used in IFTA quarterly computations.
 * Rates vary by province/state and by period; these are working defaults that
 * can be overridden per tenant via the IFTA_JURISDICTION_RATES env JSON.
 * A carrier is expected to load the accepted rates for the filing quarter
 * (matching their jurisdiction's published IFTA rate tables).
 */
export const DEFAULT_IFTA_RATES: Record<string, string> = {
  QC: '0.197',
  ON: '0.143',
  NS: '0.155',
  NB: '0.159',
  PE: '0.135',
  NL: '0.163',
  AB: '0.133',
  BC: '0.143',
  MB: '0.143',
  SK: '0.132',
  YT: '0.114',
  NT: '0.226',
  NU: '0.213',
  NY: '0.185',
  VT: '0.36',
  ME: '0.32',
  PA: '0.647',
  OH: '0.28',
  MI: '0.277',
  IL: '0.454',
  CA: '0.278',
  TX: '0.20',
};

export function resolveRates(envRates?: string | null): Record<string, string> {
  let override: Record<string, string> = {};
  if (envRates) {
    try {
      const parsed = JSON.parse(envRates) as Record<string, unknown>;
      override = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch {
      // Ignore malformed override and fall back to defaults.
    }
  }
  return { ...DEFAULT_IFTA_RATES, ...override };
}

export function rateOf(rates: Record<string, string>, code: string): Decimal {
  return d(rates[code] ?? 0);
}
