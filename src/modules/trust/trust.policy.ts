/**
 * Trust rules — pure functions, no database.
 *
 * Everything here answers one question a carrier asks before committing to a
 * load: "will this counterparty honour the deal?" Other boards answer it with
 * a bought broker credit score; we answer it with the counterparty's own
 * authority age, whether insurance is on file, how they have actually paid
 * invoices on this platform, and whether anyone has complained about them.
 *
 * Almost every signal is self-declared or platform-observed, and each one is
 * labelled as such. The single exception is the FMCSA operating-status check:
 * when that has actually run, the badge says so, and when it has not, the
 * signals stay labelled self-declared. The distinction is carried in
 * VerificationState, not left to the UI to imply.
 */

import type { VerificationState } from './fmcsa.policy';

export const INSURANCE_EXPIRING_DAYS = 45;
export const NEW_AUTHORITY_DAYS = 365;
export const REPORT_WINDOW_DAYS = 365;
/** Below this many settled invoices, a payment record is shown as early data. */
export const PAYMENT_SAMPLE_FLOOR = 3;

export type InsuranceState = 'MISSING' | 'EXPIRED' | 'EXPIRING' | 'VALID';
export type AuthorityState = 'REVOKED' | 'NEW' | 'ESTABLISHED' | 'UNKNOWN';
export type PaymentBand = 'ON_TIME' | 'LATE' | 'SLOW' | 'UNKNOWN';
export type TrustLevel = 'RISKY' | 'THIN' | 'ESTABLISHED' | 'STRONG';

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** Insurance is only useful if it is current: an expiry in the past is worse than none. */
export function insuranceState(expiresAt: Date | null | undefined, now: Date): InsuranceState {
  if (!expiresAt) return 'MISSING';
  const days = daysBetween(now, expiresAt);
  if (days < 0) return 'EXPIRED';
  if (days <= INSURANCE_EXPIRING_DAYS) return 'EXPIRING';
  return 'VALID';
}

/** Whole years of authority, or null when the tenant has not declared a start date. */
export function authorityAgeYears(since: Date | null | undefined, now: Date): number | null {
  if (!since) return null;
  return Math.floor(daysBetween(since, now) / 365);
}

/**
 * A revoked or out-of-service authority outranks everything else. Without a
 * declared status we fall back to age only, and say so rather than guessing.
 */
export function authorityState(
  status: string | null | undefined,
  since: Date | null | undefined,
  now: Date,
): AuthorityState {
  const s = (status ?? '').toUpperCase();
  if (s === 'REVOKED' || s === 'OUT_OF_SERVICE') return 'REVOKED';
  if (!since) return 'UNKNOWN';
  return daysBetween(since, now) < NEW_AUTHORITY_DAYS ? 'NEW' : 'ESTABLISHED';
}

export interface SettledInvoice {
  issueDate: Date;
  dueDate: Date;
  paidAt: Date | null;
}

export interface PaymentRecord {
  /** Mean days from invoice date to payment. */
  avgDaysToPay: number;
  /** Mean days past due (negative = paid early). */
  avgDaysPastDue: number;
  samples: number;
  band: PaymentBand;
  /** Fewer than PAYMENT_SAMPLE_FLOOR settled invoices: show it, but say so. */
  earlyData: boolean;
}

/**
 * Real days-to-pay from invoices we issued that this tenant owed. Unpaid
 * invoices are excluded (they are a different, later signal), as are invoices
 * dated in the future by a clock skew.
 */
export function paymentRecord(
  invoices: SettledInvoice[],
  now: Date,
  opts: { windowDays?: number } = {},
): PaymentRecord | null {
  const windowDays = opts.windowDays ?? 730;
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const settled = invoices.filter(
    (i) => i.paidAt != null && i.issueDate >= since && i.issueDate <= now && i.paidAt >= i.issueDate,
  );
  if (settled.length === 0) return null;

  let toPay = 0;
  let pastDue = 0;
  for (const inv of settled) {
    const paid = inv.paidAt as Date;
    toPay += daysBetween(inv.issueDate, paid);
    pastDue += daysBetween(inv.dueDate, paid);
  }
  const avgDaysToPay = Math.round(toPay / settled.length);
  const avgDaysPastDue = Math.round(pastDue / settled.length);

  return {
    avgDaysToPay,
    avgDaysPastDue,
    samples: settled.length,
    band: paymentBand(avgDaysPastDue),
    earlyData: settled.length < PAYMENT_SAMPLE_FLOOR,
  };
}

export function paymentBand(avgDaysPastDue: number): PaymentBand {
  if (avgDaysPastDue <= 0) return 'ON_TIME';
  if (avgDaysPastDue <= 15) return 'LATE';
  return 'SLOW';
}

export interface TrustInput {
  insuranceExpiresAt: Date | null;
  authorityStatus: string | null;
  authoritySince: Date | null;
  payment: PaymentRecord | null;
  /** Non-dismissed reports in the last REPORT_WINDOW_DAYS. */
  openReports: number;
  ratingAvg: number | null;
  ratingCount: number;
  /** Outcome of the FMCSA check, when one has run. Absent means self-declared. */
  verification?: VerificationState;
}

export interface TrustSummary {
  level: TrustLevel;
  insurance: InsuranceState;
  authority: AuthorityState;
  /** VERIFIED only when FMCSA confirmed the carrier may operate. */
  verification: VerificationState;
  authorityAgeYears: number | null;
  payment: PaymentRecord | null;
  openReports: number;
  /** Short, displayable reasons — the "why" behind the level. */
  flags: string[];
}

/**
 * Levels are conservative on purpose: the badge a carrier sees before
 * booking someone's freight should never flatter an unknown party.
 */
export function trustSummary(input: TrustInput, now: Date): TrustSummary {
  const insurance = insuranceState(input.insuranceExpiresAt, now);
  const authority = authorityState(input.authorityStatus, input.authoritySince, now);
  const authorityAgeYears = authorityAgeYearsOf(input.authoritySince, now);
  const verification = input.verification ?? 'DECLARED';
  const flags: string[] = [];

  // A confirmed FMCSA failure outranks anything the tenant declared about itself.
  if (verification === 'FAILED') {
    flags.push('FMCSA records do not allow this carrier to operate');
  } else if (verification === 'DECLARED') {
    flags.push('Authority status is declared, not checked against FMCSA');
  }

  if (authority === 'REVOKED') flags.push('Authority is not active');
  else if (authority === 'NEW') flags.push('Authority is under a year old');
  else if (authority === 'UNKNOWN') flags.push('No authority start date on file');

  if (insurance === 'EXPIRED') flags.push('Insurance expired');
  else if (insurance === 'MISSING') flags.push('No insurance on file');
  else if (insurance === 'EXPIRING') flags.push('Insurance expires soon');

  if (input.payment?.band === 'SLOW') flags.push(`Pays ~${input.payment.avgDaysToPay} days after invoicing`);
  if (input.openReports > 0) flags.push(`${input.openReports} report${input.openReports === 1 ? '' : 's'} in the last year`);

  let level: TrustLevel;
  if (
    verification === 'FAILED' ||
    authority === 'REVOKED' ||
    input.openReports >= 2 ||
    input.payment?.band === 'SLOW'
  ) {
    level = 'RISKY';
  } else if (authority === 'ESTABLISHED' && (insurance === 'VALID' || insurance === 'EXPIRING')) {
    // Established authority plus current insurance is the real bar; a good
    // payment record lifts it from merely established to strong.
    level = input.payment?.band === 'ON_TIME' && input.openReports === 0 ? 'STRONG' : 'ESTABLISHED';
  } else {
    level = 'THIN';
  }

  return {
    level,
    insurance,
    authority,
    verification,
    authorityAgeYears,
    payment: input.payment,
    openReports: input.openReports,
    flags,
  };
}

function authorityAgeYearsOf(since: Date | null, now: Date): number | null {
  return authorityAgeYears(since, now);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = [
  'DOUBLE_BROKERING',
  'NON_PAYMENT',
  'FRAUD',
  'CARGO_DAMAGE',
  'MISREPRESENTATION',
  'OTHER',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_MAX_DETAILS = 2000;
/** One complaint per counterparty per 90 days keeps this a signal, not a weapon. */
export const REPORT_COOLDOWN_DAYS = 90;

export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export interface SharedLoad {
  tenantId: string; // poster
  bookedByTenantId: string | null; // booker
}

/**
 * You can only report someone you have actually traded with: you posted the
 * load they booked, you booked theirs, or they proposed a rate on yours.
 * Without this, the report count is spam-able and worthless.
 */
export function reportAllowed(
  subjectTenantId: string,
  reporterTenantId: string,
  relations: { sharedLoad: boolean },
): { ok: boolean; reason?: string } {
  if (subjectTenantId === reporterTenantId) return { ok: false, reason: 'you cannot report yourself' };
  if (!relations.sharedLoad) {
    return { ok: false, reason: 'you can only report a carrier you have posted a load with, or booked from' };
  }
  return { ok: true };
}

/** True when the two tenants have a real trading relation on a load. */
export function loadRelates(a: string, b: string, load: SharedLoad): boolean {
  if (load.tenantId === a && load.bookedByTenantId === b) return true;
  if (load.tenantId === b && load.bookedByTenantId === a) return true;
  return false;
}

export function withinCooldown(createdAt: Date, now: Date): boolean {
  return daysBetween(createdAt, now) < REPORT_COOLDOWN_DAYS;
}
