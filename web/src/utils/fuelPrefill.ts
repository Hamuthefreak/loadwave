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
  /** When it was pumped. Present on the rows the fuel endpoints return. */
  occurredAt?: string;
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
 * The fuel-jurisdiction nudge.
 *
 * The first version of this said "your last 3 fills were all in Quebec —
 * fuelling in a lower-IFTA jurisdiction could cut your quarterly tax bill".
 * Three things were wrong with it: "3" was the length of the window it looked
 * at rather than anything about the driver, no number was attached to the claim
 * so there was nothing to act on, and the advice was \*not true as stated\* —
 * under IFTA the fuel tax you are charged depends on where the miles were run,
 * not only on where the tank was filled, so buying in a cheaper jurisdiction
 * only helps if the truck is also burning that fuel somewhere cheaper.
 *
 * So this returns the facts the sentence needs, and nothing about the wording:
 * how many of the driver's most recent fills share one jurisdiction, how many
 * litres that is, what they averaged per litre, and — when the driver has
 * actually bought fuel somewhere else for less — the size of that difference.
 * A nudge that cannot be wrong is a nudge that says nothing.
 *
 * Every row is normalised to litres by the API, which is what makes a total
 * mean something across a border where one fill was in US gallons.
 */

/** How far back the streak can reach. */
export const FUEL_INSIGHT_WINDOW = 20;
/** Below this, a "streak" is a coincidence, not a pattern. */
export const FUEL_INSIGHT_MIN_FILLS = 3;
/** And below this, it is not worth a paper cut, let alone a warning. */
export const FUEL_INSIGHT_MIN_LITRES = 250;

/** A price difference under a cent a litre is noise, not a reason to detour. */
const MEANINGFUL_PER_LITRE = 0.01;

/** Half a cent a litre is the floor at which a published rate is still a rate. */
const MEANINGFUL_TAX_PER_LITRE = 0.005;

/**
 * The published IFTA rates, as `GET /api/ifta/rates` hands them over. Every
 * rate in the table shares one currency and one volume unit, which is what
 * makes a difference between two of them mean something.
 */
export interface JurisdictionRates {
  currency: string;
  volumeUnit: string;
  rates: Record<string, number | string>;
}

export interface FuelTaxInsight {
  /** The streak jurisdiction — where every litre in the streak was bought. */
  jurisdiction: string;
  /** Its published rate, per litre, in the table's currency. */
  perLitre: number;
  currency: string;
  /**
   * A jurisdiction this driver has also fuelled in that taxes less per litre,
   * with what the difference comes to on the streak's litres. Null when the
   * streak is already the cheapest place they buy — a comparison against a
   * rate they have never driven through would be advice about nothing.
   */
  lower: { jurisdiction: string; perLitre: number; difference: number; save: number } | null;
}

export interface FuelJurisdictionInsight {
  /** The jurisdiction every fill in the streak came from. */
  jurisdiction: string;
  /** How many of the driver's most recent fills it covers. */
  fills: number;
  litres: number;
  /** ISO date of the oldest fill in the streak, for "since …". */
  since: string;
  /** Average price per litre, null when the streak mixes currencies. */
  perLitre: number | null;
  currency: string | null;
  /** Where this driver has bought fuel for less, and what it would have saved. */
  cheaper: { jurisdiction: string; perLitre: number; currency: string; save: number } | null;
  /**
   * The tax half of the same question: the published IFTA rate the streak sits
   * under, against the lowest rate this driver has actually bought fuel under.
   * Null when no rate table was supplied or the streak's code is not in it.
   */
  tax: FuelTaxInsight | null;
}

interface Filled {
  jurisdiction: string;
  litres: number;
  amount: number | null;
  currency: string;
  occurredAt: string;
}

/** A row we can actually count: a jurisdiction and a volume. */
function filled(row: FuelStopRow): Filled | null {
  const litres = Number(row.volumeLitres);
  if (!row.jurisdictionCode || !Number.isFinite(litres) || litres <= 0) return null;
  const amount = row.amountTransaction == null ? NaN : Number(row.amountTransaction);
  return {
    jurisdiction: row.jurisdictionCode,
    litres,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: row.transactionCurrency || 'CAD',
    occurredAt: row.occurredAt ?? '',
  };
}

function total(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * The cheapest jurisdiction this driver has bought fuel in of late, restricted
 * to the same currency — averaging CAD and USD into one price would invent a
 * number that no receipt supports.
 */
function cheapestOther(
  rows: Filled[],
  currency: string,
  ceiling: number,
): { jurisdiction: string; perLitre: number; currency: string } | null {
  const byJurisdiction = new Map<string, { litres: number; amount: number }>();
  for (const row of rows) {
    if (row.currency !== currency || row.amount === null) continue;
    const entry = byJurisdiction.get(row.jurisdiction) ?? { litres: 0, amount: 0 };
    entry.litres += row.litres;
    entry.amount += row.amount;
    byJurisdiction.set(row.jurisdiction, entry);
  }

  let best: { jurisdiction: string; perLitre: number } | null = null;
  for (const [jurisdiction, entry] of byJurisdiction) {
    if (entry.litres <= 0) continue;
    const perLitre = entry.amount / entry.litres;
    if (perLitre > ceiling - MEANINGFUL_PER_LITRE) continue;
    if (!best || perLitre < best.perLitre) best = { jurisdiction, perLitre };
  }
  return best ? { ...best, currency } : null;
}

/** A rate, as a number, or null when the table does not carry that code. */
function rateNumber(rates: JurisdictionRates, code: string): number | null {
  const raw = rates.rates?.[code];
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The tax difference between the streak and the cheapest place this driver
 * actually buys fuel.
 *
 * The pump price and the tax are two different numbers: the price is what the
 * station charged, the rate is what the quarter is settled at, and IFTA settles
 * that on where the miles were run. So the comparison is drawn only against
 * jurisdictions already present in the driver's own history — quoting a rate
 * from a jurisdiction they have never fuelled in would be advice about a
 * different driver's route.
 */
function taxInsight(
  streakJurisdiction: string,
  litres: number,
  rows: Filled[],
  rates: JurisdictionRates | null | undefined,
): FuelTaxInsight | null {
  if (!rates) return null;
  const own = rateNumber(rates, streakJurisdiction);
  if (own === null) return null;

  const seen = new Set<string>();
  let lowest: { jurisdiction: string; perLitre: number } | null = null;
  for (const row of rows) {
    if (row.jurisdiction === streakJurisdiction || seen.has(row.jurisdiction)) continue;
    seen.add(row.jurisdiction);
    const rate = rateNumber(rates, row.jurisdiction);
    if (rate === null) continue;
    if (!lowest || rate < lowest.perLitre) lowest = { jurisdiction: row.jurisdiction, perLitre: rate };
  }

  const difference = lowest ? own - lowest.perLitre : 0;
  return {
    jurisdiction: streakJurisdiction,
    perLitre: own,
    currency: rates.currency || 'CAD',
    lower:
      lowest && difference >= MEANINGFUL_TAX_PER_LITRE
        ? {
            ...lowest,
            difference: Math.round(difference * 10000) / 10000,
            save: Math.round(difference * litres * 100) / 100,
          }
        : null,
  };
}

export function fuelJurisdictionInsight(
  stops: FuelStopRow[] | null | undefined,
  options: {
    minFills?: number;
    minLitres?: number;
    window?: number;
    /** `GET /api/ifta/rates`. Omit it and the insight simply carries no tax. */
    rates?: JurisdictionRates | null;
  } = {},
): FuelJurisdictionInsight | null {
  const minFills = options.minFills ?? FUEL_INSIGHT_MIN_FILLS;
  const minLitres = options.minLitres ?? FUEL_INSIGHT_MIN_LITRES;
  const window = options.window ?? FUEL_INSIGHT_WINDOW;

  const rows = (stops ?? []).map(filled).filter((row): row is Filled => row !== null);
  if (rows.length < minFills) return null;

  // The endpoints return newest first. Sort anyway when every row carries a
  // time, because a caller handing them over in any other order would invent a
  // streak out of a coincidence.
  if (rows.every((row) => row.occurredAt)) {
    rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  }

  const jurisdiction = rows[0]?.jurisdiction;
  if (!jurisdiction) return null;

  const streak: Filled[] = [];
  for (const row of rows) {
    if (row.jurisdiction !== jurisdiction || streak.length >= window) break;
    streak.push(row);
  }
  if (streak.length < minFills) return null;

  const litres = total(streak.map((row) => row.litres));
  if (litres < minLitres) return null;

  // One price for the streak only if it is one currency and every fill has an
  // amount: the point of quoting a number is that it is the driver's own.
  const currencies = new Set(streak.map((row) => row.currency));
  const currency = currencies.size === 1 ? (streak[0]?.currency ?? null) : null;
  const perLitre =
    currency && streak.every((row) => row.amount !== null)
      ? total(streak.map((row) => row.amount as number)) / litres
      : null;

  // Only rows *older* than the streak can be a second data point; the streak
  // cannot be its own comparison.
  const cheaper = perLitre !== null && currency ? cheapestOther(rows.slice(streak.length), currency, perLitre) : null;

  return {
    jurisdiction,
    fills: streak.length,
    litres: Math.round(litres * 10) / 10,
    since: streak[streak.length - 1]?.occurredAt ?? '',
    perLitre,
    currency,
    cheaper:
      cheaper && perLitre !== null
        ? { ...cheaper, save: Math.round((perLitre - cheaper.perLitre) * litres * 100) / 100 }
        : null,
    tax: taxInsight(jurisdiction, litres, rows, options.rates),
  };
}