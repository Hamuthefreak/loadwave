/**
 * Where Loadwave is allowed to be used.
 *
 * The product files under Canadian and US rules today, but it is open to
 * visitors from Europe as well — hence the wider allow-list than the
 * jurisdictions the signup form offers. Anything outside these two regions
 * gets a plain "not available in your country" screen instead of a form that
 * cannot be completed.
 *
 * The `checked` flag matters: a lookup that fails must not lock anyone out.
 * Unknown reads as available so an outage at the geo provider does not take
 * the product down for every visitor.
 */

export type AvailabilityRegion = 'north-america' | 'europe' | null;

export const UNAVAILABLE_MESSAGE = 'LoadWave is not currently available in your country.';

const NORTH_AMERICA = new Set(['CA', 'US', 'MX']);

/**
 * Europe, including the EEA, the UK, the Balkans and the microstates. Russia
 * and Turkey are included geographically; a product decision to exclude them
 * is a one-line change here.
 */
const EUROPE = new Set([
  'AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE',
  'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU',
  'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME',
  'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ',
  'SK', 'SM', 'TR', 'UA', 'VA', 'XK',
]);

export const AVAILABLE_COUNTRIES: ReadonlySet<string> = new Set([...NORTH_AMERICA, ...EUROPE]);

export interface Availability {
  /** ISO 3166-1 alpha-2 code, or null when the lookup could not tell. */
  country: string | null;
  region: AvailabilityRegion;
  available: boolean;
  /** False when no country was resolved, which is deliberately fail-open. */
  checked: boolean;
}

export function availabilityFor(country: string | null | undefined): Availability {
  const code = (country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return { country: null, region: null, available: true, checked: false };
  }
  const region: AvailabilityRegion = NORTH_AMERICA.has(code)
    ? 'north-america'
    : EUROPE.has(code)
      ? 'europe'
      : null;
  return { country: code, region, available: region !== null, checked: true };
}
