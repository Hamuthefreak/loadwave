/**
 * Driver settlements — pure policy. No database, no clock, no rounding by luck.
 *
 * Every load board stops at the revenue side: it tells a carrier what a load
 * pays, and nothing about what the driver who hauls it earns. That gap is why
 * owner-operators and small fleets still run payroll in a spreadsheet, and why
 * drivers ask dispatch "what am I on track for this week?" and get a guess.
 *
 * This module is the rulebook for the other half of the money: given a pay
 * profile and a set of delivered loads, what does the driver earn for a period.
 *
 * Two decisions are deliberate and worth stating, because they are where this
 * kind of code usually lies to people about money:
 *
 *   1. All arithmetic is in integer cents. Dollars are never accumulated as
 *      floats, so a 40-load week cannot drift by a cent against the driver's own
 *      tally — which is the first thing a driver checks.
 *   2. Statements are derived, never stored. A rate change or a corrected
 *      delivery date re-prices the period correctly instead of leaving a stale
 *      snapshot of pay that nobody can reconcile.
 *
 * Detention is priced from the tenant's own rate on the entry, and a period is
 * bounded to the driver's home-terminal timezone — a driver who drops a trailer
 * at 20:30 should see it in that evening's week, not next week's.
 */

/** How a driver is paid. A null profile means they keep the revenue (owner-operator). */
export type PayModel = 'PER_MILE' | 'PERCENT_REVENUE' | 'FLAT_PER_LOAD';

export const PAY_MODELS: readonly PayModel[] = ['PER_MILE', 'PERCENT_REVENUE', 'FLAT_PER_LOAD'];

export interface PayProfile {
  payModel: PayModel;
  /** Dollars per mile, percent of load revenue (0–100), or dollars per load. */
  payRate: number;
}

const KM_PER_MILE = 1.609344;

/** Loads are stored in km; drivers are paid per mile. */
export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

export function isPayModel(raw: unknown): raw is PayModel {
  return typeof raw === 'string' && (PAY_MODELS as readonly string[]).includes(raw);
}

/**
 * Prisma hands back a Decimal object for every numeric column, and a Decimal is
 * not a JS number — `typeof` reports "object" and a naive check silently reads
 * the stored rate as missing, which would show every driver as unpriced. This
 * coerces anything numeric-shaped (number, numeric string, Decimal) and treats
 * everything else as absent.
 */
export function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object') {
    const decimal = value as { toNumber?: () => number; toString: () => string };
    const n = typeof decimal.toNumber === 'function' ? decimal.toNumber() : Number(String(decimal));
    return Number.isFinite(n) ? n : null;
  }
  return null; // booleans, functions, symbols — not money
}

/** A stored profile only counts when both halves are present and sane. */
export function payProfileOf(payModel: string | null | undefined, payRate: unknown): PayProfile | null {
  if (!isPayModel(payModel)) return null;
  const rate = toNumber(payRate);
  if (rate == null || rate < 0) return null;
  return { payModel, payRate: rate };
}

export function payRateLabel(profile: PayProfile | null): string {
  if (!profile) return 'Owner-operator — keeps the revenue';
  if (profile.payModel === 'PER_MILE') return `$${profile.payRate.toFixed(2)} / mi`;
  if (profile.payModel === 'PERCENT_REVENUE') return `${profile.payRate}% of revenue`;
  return `$${profile.payRate.toFixed(2)} per load`;
}

/** What a single delivered load pays. */
export interface PayLoadInput {
  id: string;
  reference: string | null;
  originRegion: string;
  destinationRegion: string;
  deliveredAt: Date | string | null;
  /** Loaded distance in miles, or null when the loadboard gave no estimate. */
  distanceMiles: number | null;
  /** Load revenue in the tenant's base currency. */
  revenueBase: number | null;
  /** Detention already logged against the load, in hours. */
  detentionHours: number;
  /** The tenant's detention rate for this load, dollars per hour. */
  detentionRate: number | null;
}

export interface StatementLine {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  revenueCents: number | null;
  /** How the pay amount was worked out, shown next to it so it is checkable. */
  basis: string;
  baseCents: number;
  detentionHours: number;
  detentionBasis: string | null;
  detentionCents: number;
  totalCents: number;
  /** False when the load could not be priced (no profile, or no distance/revenue). */
  priced: boolean;
}

export interface StatementTotals {
  loads: number;
  unpricedLoads: number;
  miles: number;
  detentionHours: number;
  revenueCents: number;
  payCents: number;
  detentionCents: number;
  totalPayCents: number;
  /** Revenue minus driver pay — what the load left behind. */
  marginCents: number;
  /** Effective pay per mile across the period, or null with no miles. */
  effectivePayPerMileCents: number | null;
}

export interface Statement {
  driverId: string;
  driverName: string;
  period: { from: string; to: string; label: string };
  payModel: PayModel | null;
  payRate: number | null;
  payLabel: string;
  lines: StatementLine[];
  totals: StatementTotals;
  /** Caveats shown to the user, so an unpriced load is explained rather than hidden. */
  notes: string[];
}

const round2 = (dollars: number): number => Math.round(dollars * 100);

function payForLoad(profile: PayProfile | null, load: PayLoadInput): { cents: number; basis: string; priced: boolean } {
  if (!profile) return { cents: 0, basis: 'No pay profile', priced: false };

  if (profile.payModel === 'PER_MILE') {
    if (load.distanceMiles == null) return { cents: 0, basis: 'Distance unknown', priced: false };
    const miles = load.distanceMiles;
    return {
      cents: round2(miles * profile.payRate),
      basis: `${formatMiles(miles)} mi × $${profile.payRate.toFixed(2)}/mi`,
      priced: true,
    };
  }

  if (profile.payModel === 'PERCENT_REVENUE') {
    if (load.revenueBase == null) return { cents: 0, basis: 'Revenue unknown', priced: false };
    return {
      cents: round2((load.revenueBase * profile.payRate) / 100),
      basis: `${formatMoney(load.revenueBase)} × ${profile.payRate}%`,
      priced: true,
    };
  }

  return { cents: round2(profile.payRate), basis: `Flat $${profile.payRate.toFixed(2)}`, priced: true };
}

function detentionForLoad(
  profile: PayProfile | null,
  load: PayLoadInput,
): { cents: number; hours: number; basis: string | null; note: string | null } {
  const hours = Math.max(0, load.detentionHours);
  if (hours <= 0) return { cents: 0, hours: 0, basis: null, note: null };
  const label = `${hours.toFixed(1)} h detention`;

  // An owner-operator keeps the freight revenue, so time spent waiting is
  // already theirs — paying it again as "driver pay" would inflate the payroll
  // run with money nobody owes. The hours are still reported.
  if (!profile) return { cents: 0, hours, basis: `${label} — owner-operator`, note: null };

  if (load.detentionRate == null) {
    // We know the time but not the rate. Report the hours and say so, rather
    // than silently paying nothing or inventing a rate.
    return { cents: 0, hours, basis: `${label} — no rate set`, note: label };
  }
  const cents = round2(hours * load.detentionRate);
  return { cents, hours, basis: `${label} × $${load.detentionRate.toFixed(2)}/h`, note: null };
}

export function statementLine(profile: PayProfile | null, load: PayLoadInput): StatementLine {
  const pay = payForLoad(profile, load);
  const detention = detentionForLoad(profile, load);
  const deliveredAt = toDate(load.deliveredAt);
  return {
    loadId: load.id,
    reference: load.reference ?? load.id.slice(0, 8).toUpperCase(),
    lane: `${load.originRegion} → ${load.destinationRegion}`,
    deliveredAt: (deliveredAt ?? new Date(0)).toISOString(),
    miles: load.distanceMiles,
    revenueCents: load.revenueBase == null ? null : round2(load.revenueBase),
    basis: pay.basis,
    baseCents: pay.cents,
    detentionHours: detention.hours,
    detentionBasis: detention.basis,
    detentionCents: detention.cents,
    totalCents: pay.cents + detention.cents,
    priced: pay.priced,
  };
}

/**
 * Build one driver's statement for a period. `from` inclusive, `to` exclusive —
 * so consecutive periods tile without double-paying a Sunday-night delivery.
 * Loads are expected to be already scoped to the driver and to delivered
 * status; the period filter is applied here so the pure function owns the
 * boundary rule.
 */
export function buildStatement(input: {
  driverId: string;
  driverName: string;
  profile: PayProfile | null;
  loads: readonly PayLoadInput[];
  from: Date;
  to: Date;
  label: string;
}): Statement {
  const inPeriod = input.loads
    .filter((load) => {
      const at = toDate(load.deliveredAt);
      return at != null && at.getTime() >= input.from.getTime() && at.getTime() < input.to.getTime();
    })
    .sort((a, b) => (toDate(a.deliveredAt) as Date).getTime() - (toDate(b.deliveredAt) as Date).getTime());

  const lines = inPeriod.map((load) => statementLine(input.profile, load));

  let miles = 0;
  let revenueCents = 0;
  let payCents = 0;
  let detentionCents = 0;
  let detentionHours = 0;
  let unpricedLoads = 0;

  for (const line of lines) {
    if (line.miles != null) miles += line.miles;
    if (line.revenueCents != null) revenueCents += line.revenueCents;
    payCents += line.baseCents;
    detentionCents += line.detentionCents;
    detentionHours += line.detentionHours;
    if (!line.priced) unpricedLoads += 1;
  }

  const totalPayCents = payCents + detentionCents;
  const notes: string[] = [];

  if (!input.profile && lines.length > 0) {
    notes.push('No pay profile on this driver — they are treated as an owner-operator keeping the revenue, so no pay is owed.');
  }
  // The generic unpriced warning would be noise next to the owner-operator
  // note, which already explains why every line reads $0.00.
  if (unpricedLoads > 0 && input.profile) {
    notes.push(
      `${unpricedLoads} delivered load${unpricedLoads === 1 ? '' : 's'} could not be priced and ${unpricedLoads === 1 ? 'is' : 'are'} shown at $0.00.`,
    );
  }
  const detainedWithoutRate = lines.filter((l) => l.detentionHours > 0 && l.detentionCents === 0).length;
  if (detainedWithoutRate > 0) {
    notes.push(`${detainedWithoutRate} load${detainedWithoutRate === 1 ? '' : 's'} logged detention with no hourly rate set — hours shown, unpaid.`);
  }

  return {
    driverId: input.driverId,
    driverName: input.driverName,
    period: { from: input.from.toISOString(), to: input.to.toISOString(), label: input.label },
    payModel: input.profile?.payModel ?? null,
    payRate: input.profile?.payRate ?? null,
    payLabel: payRateLabel(input.profile),
    lines,
    totals: {
      loads: lines.length,
      unpricedLoads,
      miles: Math.round(miles * 10) / 10,
      detentionHours: Math.round(detentionHours * 10) / 10,
      revenueCents,
      payCents,
      detentionCents,
      totalPayCents,
      marginCents: revenueCents - totalPayCents,
      effectivePayPerMileCents: miles > 0 ? Math.round(totalPayCents / miles) : null,
    },
    notes,
  };
}

/** Roll several statements into a fleet-wide payroll total. */
export function rollupStatements(statements: readonly Statement[]): StatementTotals & { drivers: number; payableDrivers: number } {
  const totals = statements.reduce<StatementTotals>(
    (acc, s) => ({
      loads: acc.loads + s.totals.loads,
      unpricedLoads: acc.unpricedLoads + s.totals.unpricedLoads,
      miles: Math.round((acc.miles + s.totals.miles) * 10) / 10,
      detentionHours: Math.round((acc.detentionHours + s.totals.detentionHours) * 10) / 10,
      revenueCents: acc.revenueCents + s.totals.revenueCents,
      payCents: acc.payCents + s.totals.payCents,
      detentionCents: acc.detentionCents + s.totals.detentionCents,
      totalPayCents: acc.totalPayCents + s.totals.totalPayCents,
      marginCents: acc.marginCents + s.totals.marginCents,
      effectivePayPerMileCents: null,
    }),
    {
      loads: 0, unpricedLoads: 0, miles: 0, detentionHours: 0, revenueCents: 0,
      payCents: 0, detentionCents: 0, totalPayCents: 0, marginCents: 0, effectivePayPerMileCents: null,
    },
  );
  return {
    ...totals,
    effectivePayPerMileCents: totals.miles > 0 ? Math.round(totals.totalPayCents / totals.miles) : null,
    drivers: statements.length,
    payableDrivers: statements.filter((s) => s.totals.totalPayCents > 0).length,
  };
}

/* ------------------------------------------------------------------ *
 * Period maths — a pay week belongs to the driver's home terminal,
 * not to the server's idea of midnight.
 * ------------------------------------------------------------------ */

export interface SettlementPeriod {
  from: Date;
  to: Date;
  label: string;
}

const MS_DAY = 86_400_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Home terminal for a carrier that never set one — the seeded Driver default. */
export const DEFAULT_TIMEZONE = 'America/Toronto';

/**
 * `homeTerminalTz` is free text a dispatcher typed, and `Intl.DateTimeFormat`
 * throws a RangeError on an unknown zone. Every period calculation funnels
 * through here so a typo in a driver's profile can never break payroll maths or
 * the HOS day boundary — it falls back to the fleet default instead.
 */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** True when the string is a timezone this runtime can actually resolve. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(tz),
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Some ICU builds render midnight as "24" under hour12:false.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Offset of `tz` from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * A wall-clock moment in `tz` as a real instant. Two passes: the first lands
 * near the answer, the second settles it when the first guess crossed a DST
 * boundary, which is the only case a single pass gets wrong.
 */
export function zonedTime(year: number, month: number, day: number, tz: string, hour = 0, minute = 0): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const once = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), tz);
  const twice = wallAsUtc - zoneOffsetMs(new Date(once), tz);
  return new Date(twice);
}

function weekdayLabel(from: Date, to: Date, tz: string): string {
  const zone = safeTimezone(tz);
  const fmt = (d: Date): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, month: 'short', day: 'numeric' }).format(d);
  const endInclusive = new Date(to.getTime() - MS_DAY);
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric' }).format(endInclusive);
  return `${fmt(from)} – ${fmt(endInclusive)}, ${year}`;
}

/**
 * Monday-to-Sunday week containing `now`, in the driver's timezone.
 * `offsetWeeks` walks backwards (−1 is last week) so history is reachable.
 */
export function settlementPeriod(now: Date, tz: string, offsetWeeks = 0): SettlementPeriod {
  const p = zonedParts(now, tz);
  const isoWeekday = p.weekday === 0 ? 7 : p.weekday; // Mon = 1 … Sun = 7
  const back = -offsetWeeks * 7 - (isoWeekday - 1);
  const from = zonedTime(p.year, p.month, p.day + back, tz);
  const to = zonedTime(p.year, p.month, p.day + back + 7, tz);
  return { from, to, label: weekdayLabel(from, to, tz) };
}

/** A calendar-year total, for the "year to date" figure a driver asks about. */
export function yearToDatePeriod(now: Date, tz: string): SettlementPeriod {
  const p = zonedParts(now, tz);
  const from = zonedTime(p.year, 1, 1, tz);
  const to = zonedTime(p.year + 1, 1, 1, tz);
  return { from, to, label: `${p.year} year to date` };
}

/** Parses an explicit from/to pair from a query string, in the driver's tz. */
export function periodFromInputs(fromIso: string, toIso: string, tz: string, label?: string): SettlementPeriod | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (!m || !n) return null;
  const from = zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), tz);
  // `to` is exclusive: a user asking for the 1st–7th means through the 7th.
  const to = zonedTime(Number(n[1]), Number(n[2]), Number(n[3]) + 1, tz);
  if (to.getTime() <= from.getTime()) return null;
  return { from, to, label: label ?? weekdayLabel(from, to, tz) };
}

/* ------------------------------------------------------------------ */

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMiles(miles: number): string {
  return miles.toFixed(1);
}

export function formatMoney(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}
