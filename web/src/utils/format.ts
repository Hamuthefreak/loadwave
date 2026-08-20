const REGIONS: Record<string, string> = {
  QC: 'Québec',
  ON: 'Ontario',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland & Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  PE: 'P.E.I.',
  SK: 'Saskatchewan',
  YT: 'Yukon',
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export function regionLabel(code: string): string {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return '—';
  return REGIONS[c] ?? c;
}

export function countryFlag(country: string): string {
  return (country ?? '').toUpperCase() === 'US' ? 'US' : 'CA';
}

export function laneLabel(
  originCountry: string,
  originRegion: string,
  destinationCountry: string,
  destinationRegion: string,
): string {
  const from = `${regionLabel(originRegion)} (${countryFlag(originCountry)})`;
  const to = `${regionLabel(destinationRegion)} (${countryFlag(destinationCountry)})`;
  return `${from} → ${to}`;
}

export function money(amount: string | number | null | undefined, currency = 'CAD'): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '—';
  const cur = ['CAD', 'USD'].includes(currency) ? currency : 'CAD';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

export function moneyShort(amount: string | number | null | undefined, currency = 'CAD'): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '—';
  const cur = ['CAD', 'USD'].includes(currency) ? currency : 'CAD';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: cur,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

export function num(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString('en-CA') : '—';
}

export function num1(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}

export function km(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('en-CA')} km`;
}

export function miles(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v * 0.621371).toLocaleString('en-CA')} mi`;
}

export function perMile(rate: string | number | null | undefined, kmValue: string | number | null | undefined): string | null {
  const r = Number(rate ?? 0);
  const k = Number(kmValue ?? 0);
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(k) || k <= 0) return null;
  const perKm = r / k;
  const perMile = perKm / 0.621371;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(perMile);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(iso);
}

export function currencyOf(code: string | null | undefined): 'CAD' | 'USD' {
  return (code ?? '').toUpperCase() === 'USD' ? 'USD' : 'CAD';
}
