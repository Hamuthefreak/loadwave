/**
 * Driver pay queries — pure rules, no database, no clock.
 *
 * A settlement statement is derived from delivered loads, which is the right way
 * to compute pay but leaves a driver nothing to point at when a number looks
 * wrong. Today that becomes a phone call: not written down, not checkable, and
 * reconstructed from memory a week later when somebody asks why the cheque was
 * short.
 *
 * This module is the rulebook for the other side of that conversation: what a
 * driver may question, what the office must say back, and what a query is worth
 * in money. It is deliberately pure so the boundaries — a message that is too
 * short to act on, a line that is not on the statement, a query already open —
 * are unit-tested rather than trusted.
 */

/**
 * Which figure on a statement line is being questioned.
 *
 * Deliberately only two, and both attached to a load. A "the whole week is
 * wrong" query would have nothing concrete to point at, and the office would
 * have to reconstruct which line was really in dispute — which is the phone call
 * this feature exists to replace. A driver who thinks the week is short queries
 * the lines that are short.
 */
export type DisputeSubject = 'LINE' | 'DETENTION';

export const DISPUTE_SUBJECTS: readonly DisputeSubject[] = ['LINE', 'DETENTION'];

/** OPEN is the office's inbox; the other two are answers, not states to return to. */
export type DisputeStatus = 'OPEN' | 'RESOLVED' | 'DECLINED';

export const DISPUTE_STATUSES: readonly DisputeStatus[] = ['OPEN', 'RESOLVED', 'DECLINED'];

/**
 * Short enough and it is not a query ("no"), long enough and it is not a
 * paragraph nobody reads on a phone. The floor is deliberately low: a driver
 * typing with one thumb at a truck stop should not be argued with.
 */
export const DISPUTE_MESSAGE_MIN = 12;
export const DISPUTE_MESSAGE_MAX = 1000;

/** An answer has to say something. "Resolved" with no text explains nothing. */
export const DISPUTE_ANSWER_MIN = 8;
export const DISPUTE_ANSWER_MAX = 1000;

export function isDisputeSubject(value: unknown): value is DisputeSubject {
  return typeof value === 'string' && (DISPUTE_SUBJECTS as readonly string[]).includes(value);
}

export function isDisputeStatus(value: unknown): value is DisputeStatus {
  return typeof value === 'string' && (DISPUTE_STATUSES as readonly string[]).includes(value);
}

export function isOpenDispute(status: string): boolean {
  return status === 'OPEN';
}

export function subjectLabel(subject: DisputeSubject): string {
  return subject === 'DETENTION' ? 'detention time' : 'the load line';
}

/**
 * Trim and bound free text. Returns the value or the reason it is unusable, so
 * the route can answer with a sentence rather than a regex.
 */
export function normalizeText(
  raw: unknown,
  bounds: { min: number; max: number; field: string },
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${bounds.field} is required` };
  // Collapse runs of whitespace: a query pasted from a notes app arrives with
  // newlines, and they would otherwise count toward the length.
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length < bounds.min) {
    return { ok: false, error: `${bounds.field} needs at least ${bounds.min} characters` };
  }
  if (value.length > bounds.max) {
    return { ok: false, error: `${bounds.field} is longer than ${bounds.max} characters` };
  }
  return { ok: true, value };
}

export function normalizeMessage(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  return normalizeText(raw, { min: DISPUTE_MESSAGE_MIN, max: DISPUTE_MESSAGE_MAX, field: 'A note to dispatch' });
}

export function normalizeAnswer(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  return normalizeText(raw, { min: DISPUTE_ANSWER_MIN, max: DISPUTE_ANSWER_MAX, field: 'An answer' });
}

/** The statement line as the driver was looking at it when they raised the query. */
export interface DisputedLine {
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  basis: string;
  baseCents: number;
  detentionHours: number;
  detentionBasis: string | null;
  detentionCents: number;
  totalCents: number;
}

/** Minimum shape needed to snapshot a statement line. */
export interface StatementLineLike {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  basis: string;
  baseCents: number;
  detentionHours: number;
  detentionBasis: string | null;
  detentionCents: number;
  totalCents: number;
}

export function snapshotLine(line: StatementLineLike): DisputedLine {
  return {
    reference: line.reference,
    lane: line.lane,
    deliveredAt: line.deliveredAt,
    miles: line.miles,
    basis: line.basis,
    baseCents: line.baseCents,
    detentionHours: line.detentionHours,
    detentionBasis: line.detentionBasis,
    detentionCents: line.detentionCents,
    totalCents: line.totalCents,
  };
}

/** Money in cents, printed the way a driver reads it. */
export function cents(cents: number): string {
  const negative = cents < 0;
  const whole = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${rest}`;
}

/** The part of the line the query is actually about. */
export function disputedCents(line: DisputedLine, subject: DisputeSubject): number {
  return subject === 'DETENTION' ? line.detentionCents : line.baseCents;
}

/** One line describing what was disputed, for the office inbox and the bell. */
export function disputedSummary(line: DisputedLine, subject: DisputeSubject): string {
  if (subject === 'DETENTION') {
    const hours = line.detentionBasis ?? `${line.detentionHours.toFixed(1)} h detention`;
    return `${line.reference} · ${line.lane} · ${hours} → ${cents(line.detentionCents)}`;
  }
  return `${line.reference} · ${line.lane} · ${line.basis} → ${cents(line.baseCents)}`;
}

/**
 * A driver raising a second query about the same figure on the same load is
 * almost always a double-tap, not a new grievance. The office should answer the
 * one already open rather than triage two.
 */
export function findOpenDuplicate<
  T extends { loadId: string | null; subject: string; status: string },
>(existing: readonly T[], loadId: string | null, subject: DisputeSubject): T | undefined {
  return existing.find((d) => d.loadId === loadId && d.subject === subject && isOpenDispute(d.status));
}

/** Whole days a query has been sitting open — what an owner chases on. */
export function ageInDays(createdAt: Date | string, now: Date): number {
  const at = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(at.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

export function queryAgeLabel(days: number): string {
  if (days === 0) return 'raised today';
  if (days === 1) return 'open 1 day';
  return `open ${days} days`;
}

/** The bell row the office sees when a driver raises a query. */
export function disputeNotification(input: {
  driverName: string;
  line: DisputedLine;
  subject: DisputeSubject;
}): { title: string; body: string } {
  return {
    title: `${input.driverName} queried ${subjectLabel(input.subject)}`,
    body: disputedSummary(input.line, input.subject),
  };
}

/** The bell row the driver sees when the office answers. */
export function answerNotification(input: {
  status: DisputeStatus;
  periodLabel: string;
  reference: string;
}): { title: string; body: string } {
  const declined = input.status === 'DECLINED';
  return {
    title: declined ? 'Your pay query was declined' : 'Your pay query was answered',
    body: `${input.reference} · ${input.periodLabel}`,
  };
}

/**
 * What the driver signs off on, printed above the signature rule. It has to be
 * a statement of fact, not a waiver: payroll is filed on this, and a driver who
 * has an open query should not be signing that they agree with the number.
 */
export function signoffText(input: {
  driverName: string;
  periodLabel: string;
  totalLabel: string;
  openQueries: number;
}): string {
  const base = `I have reviewed the loads and the total pay of ${input.totalLabel} for ${input.periodLabel}, and the miles, rates and detention shown above match my records.`;
  if (input.openQueries === 0) return base;
  return `${base} I have ${input.openQueries} pay ${input.openQueries === 1 ? 'query' : 'queries'} still open with the office.`;
}

/** A short, stable reference a driver can quote on the phone. */
export function disputeReference(id: string): string {
  return `PD-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
