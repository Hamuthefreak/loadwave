/**
 * Compliance documents — pure policy, no database, no clock.
 *
 * Every load board tells a carrier whether a load is worth hauling. None of them
 * tell the carrier whether they are *legal to haul it*. A truck put out of
 * service at a scale for an expired medical card or a lapsed annual inspection
 * costs more than any load pays, and it is the first thing a DOT auditor asks
 * for — the driver qualification file required by 49 CFR 391.51.
 *
 * This module is the rulebook: what has to be on file, how long each document is
 * good for, and how close to expiry it is. It is deliberately pure so the
 * expiring/expired boundaries are unit-tested rather than trusted.
 */

/** Who a document belongs to. Carrier-level items (authority, IFTA) aren't per-truck. */
export type ComplianceSubject = 'DRIVER' | 'ASSET' | 'TENANT';

/**
 * EXPIRED and MISSING are both failures, but they need different actions:
 * one is a renewal, the other is a hunt. EXPIRING is the warning window.
 */
export type ComplianceStatus = 'EXPIRED' | 'MISSING' | 'EXPIRING' | 'OK';

/** Days before expiry that a document starts warning. */
export const EXPIRING_WINDOW_DAYS = 30;

/** Worst-first, so a list can be sorted by urgency with a plain number. */
export const COMPLIANCE_RANK: Record<ComplianceStatus, number> = {
  EXPIRED: 0,
  MISSING: 1,
  EXPIRING: 2,
  OK: 3,
};

export interface KindSpec {
  kind: string;
  label: string;
  scope: ComplianceSubject;
  /** A missing one of these is a compliance gap, not just an untracked extra. */
  required: boolean;
  /**
   * Months of validity, applied to `issuedAt` when the user doesn't supply an
   * expiry. Only for documents whose cycle is set by rule (annual reviews,
   * registrations) — never for a CDL or a medical card, whose printed expiry is
   * the only authority.
   */
  validityMonths: number | null;
  /** The rule this comes from, shown in the UI so the claim is checkable. */
  reference: string;
}

/**
 * The checklist. Driver items are the DQ file under 49 CFR 391.51(b); asset and
 * carrier items are the paperwork a roadside inspection or an audit asks for.
 */
export const COMPLIANCE_KINDS: readonly KindSpec[] = [
  // --- Driver qualification file -------------------------------------------
  {
    kind: 'CDL',
    label: 'CDL / licence',
    scope: 'DRIVER',
    required: true,
    validityMonths: null, // printed on the licence
    reference: '49 CFR 383.153',
  },
  {
    kind: 'MEDICAL_CARD',
    label: "Medical examiner's certificate",
    scope: 'DRIVER',
    required: true,
    validityMonths: null, // printed on the certificate
    reference: '49 CFR 391.43',
  },
  {
    kind: 'MVR',
    label: 'Motor vehicle record',
    scope: 'DRIVER',
    required: true,
    validityMonths: null,
    reference: '49 CFR 391.23',
  },
  {
    kind: 'ANNUAL_REVIEW',
    label: 'Annual driving record review',
    scope: 'DRIVER',
    required: true,
    validityMonths: 12,
    reference: '49 CFR 391.25',
  },
  {
    kind: 'VIOLATIONS_CERT',
    label: 'Annual certification of violations',
    scope: 'DRIVER',
    required: true,
    validityMonths: 12,
    reference: '49 CFR 391.27',
  },
  {
    kind: 'EMPLOYMENT_VERIFICATION',
    label: 'Employment verification (3 years)',
    scope: 'DRIVER',
    required: true,
    validityMonths: null,
    reference: '49 CFR 391.23',
  },
  {
    kind: 'ROAD_TEST',
    label: 'Road test certificate or CDL equivalent',
    scope: 'DRIVER',
    required: false,
    validityMonths: null,
    reference: '49 CFR 391.31',
  },
  {
    kind: 'HAZMAT_TRAINING',
    label: 'Hazmat endorsement / training',
    scope: 'DRIVER',
    required: false,
    validityMonths: 36,
    reference: '49 CFR 172.704',
  },

  // --- Equipment ------------------------------------------------------------
  {
    kind: 'REGISTRATION',
    label: 'Registration',
    scope: 'ASSET',
    required: true,
    validityMonths: 12,
    reference: 'Provincial / state registration',
  },
  {
    kind: 'ANNUAL_INSPECTION',
    label: 'Annual inspection',
    scope: 'ASSET',
    required: true,
    validityMonths: 12,
    reference: '49 CFR 396.17',
  },
  {
    kind: 'IRP_CAB_CARD',
    label: 'IRP cab card',
    scope: 'ASSET',
    required: true,
    validityMonths: 12,
    reference: 'IRP Plan',
  },

  // --- Carrier --------------------------------------------------------------
  {
    kind: 'INSURANCE',
    label: 'Auto liability & cargo insurance',
    scope: 'TENANT',
    required: true,
    validityMonths: null,
    reference: '49 CFR 387.7 / 387.301',
  },
  {
    kind: 'MCS90',
    label: 'MCS-90 endorsement',
    scope: 'TENANT',
    required: false,
    validityMonths: null,
    reference: '49 CFR 387.313',
  },
  {
    kind: 'AUTHORITY',
    label: 'Operating authority (MC / USDOT)',
    scope: 'TENANT',
    required: true,
    validityMonths: null,
    reference: '49 CFR 387 / FMCSA registration',
  },
  {
    kind: 'IFTA_LICENSE',
    label: 'IFTA licence',
    scope: 'TENANT',
    required: false,
    validityMonths: 12,
    reference: 'IFTA Articles of Agreement',
  },
] as const;

export function kindsFor(scope: ComplianceSubject): KindSpec[] {
  return COMPLIANCE_KINDS.filter((k) => k.scope === scope);
}

export function specFor(kind: string): KindSpec | undefined {
  return COMPLIANCE_KINDS.find((k) => k.kind === kind);
}

/** Whole days from `now` to `expiresAt`. Negative once past; null when there's no expiry. */
export function daysUntil(
  expiresAt: Date | string | null | undefined,
  now: Date,
): number | null {
  if (!expiresAt) return null;
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Where a document stands. A document with no expiry is OK — not everything
 * lapses (an employment verification doesn't), and inventing a date for it would
 * be worse than leaving it alone.
 */
export function documentStatus(
  expiresAt: Date | string | null | undefined,
  now: Date,
  warnDays: number = EXPIRING_WINDOW_DAYS,
): ComplianceStatus {
  const days = daysUntil(expiresAt, now);
  if (days === null) return 'OK';
  if (days < 0) return 'EXPIRED';
  if (days <= warnDays) return 'EXPIRING';
  return 'OK';
}

/** `issuedAt + validityMonths`, for the documents whose cycle is set by rule. */
export function deriveExpiry(
  issuedAt: Date | string | null | undefined,
  validityMonths: number | null | undefined,
): Date | null {
  if (!issuedAt || !validityMonths) return null;
  const start = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (Number.isNaN(start.getTime())) return null;
  const out = new Date(start);
  out.setMonth(out.getMonth() + validityMonths);
  return out;
}

export interface ChecklistItem {
  kind: string;
  label: string;
  scope: ComplianceSubject;
  required: boolean;
  reference: string;
  status: ComplianceStatus;
  expiresAt: string | null;
  daysUntil: number | null;
  identifier: string | null;
  hasFile: boolean;
  /** Row id, so the UI can update or delete without a second lookup. Null when nothing is on file. */
  documentId: string | null;
  notes: string | null;
}

export interface StoredDoc {
  id?: string;
  kind: string;
  identifier?: string | null;
  expiresAt?: Date | string | null;
  notes?: string | null;
  hasFile?: boolean;
}

/**
 * Builds the full checklist for one subject: every kind it should carry, with
 * the document that's on file merged in. Returns worst-first so the caller can
 * render the top of the list without re-sorting.
 */
export function checklist(
  scope: ComplianceSubject,
  docs: StoredDoc[],
  now: Date,
  warnDays: number = EXPIRING_WINDOW_DAYS,
): ChecklistItem[] {
  const byKind = new Map(docs.map((d) => [d.kind, d]));
  return kindsFor(scope)
    .map<ChecklistItem>((spec) => {
      const doc = byKind.get(spec.kind);
      const expiresAt = doc?.expiresAt ?? null;
      return {
        kind: spec.kind,
        label: spec.label,
        scope: spec.scope,
        required: spec.required,
        reference: spec.reference,
        status: doc ? documentStatus(expiresAt, now, warnDays) : 'MISSING',
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        daysUntil: daysUntil(expiresAt, now),
        identifier: doc?.identifier ?? null,
        hasFile: Boolean(doc?.hasFile),
        documentId: doc?.id ?? null,
        notes: doc?.notes ?? null,
      };
    })
    .sort(
      (a, b) =>
        COMPLIANCE_RANK[a.status] - COMPLIANCE_RANK[b.status] ||
        a.kind.localeCompare(b.kind),
    );
}

/**
 * A subject's own status: its worst *required* problem. Optional items that
 * aren't on file don't fail anyone.
 */
export function subjectStatus(items: ChecklistItem[]): ComplianceStatus {
  let worst: ComplianceStatus = 'OK';
  for (const item of items) {
    if (!item.required && item.status === 'MISSING') continue;
    if (COMPLIANCE_RANK[item.status] < COMPLIANCE_RANK[worst]) worst = item.status;
  }
  return worst;
}

export interface ComplianceTotals {
  expired: number;
  missing: number;
  expiring: number;
  ok: number;
}

export function countStatuses(items: ChecklistItem[]): ComplianceTotals {
  const totals: ComplianceTotals = { expired: 0, missing: 0, expiring: 0, ok: 0 };
  for (const item of items) {
    if (!item.required && item.status === 'MISSING') continue;
    if (item.status === 'EXPIRED') totals.expired += 1;
    else if (item.status === 'MISSING') totals.missing += 1;
    else if (item.status === 'EXPIRING') totals.expiring += 1;
    else totals.ok += 1;
  }
  return totals;
}

/**
 * One-line phrase for a subject, used in notifications and card headings. Kept
 * honest: it names the document, it doesn't say "compliant" or "safe".
 */
/** Everything on a checklist that needs doing, worst-first (the list is already sorted). */
export function problems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter(
    (i) => i.status === 'EXPIRED' || (i.required && i.status === 'MISSING') || i.status === 'EXPIRING',
  );
}

/**
 * The headline names the single most urgent document and counts the rest —
 * reporting only the other *expired* items would understate a subject that has
 * one lapse and three gaps.
 */
export function statusHeadline(items: ChecklistItem[]): string {
  const open = problems(items);
  if (open.length === 0) return 'All required documents on file';
  const first = open[0];
  const more = open.length > 1 ? ` (+${open.length - 1} more)` : '';
  if (first.status === 'EXPIRED') return `${first.label} expired${more}`;
  if (first.status === 'MISSING') return `${first.label} not on file${more}`;
  const days = first.daysUntil ?? 0;
  return `${first.label} expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}${more}`;
}

/** Anything worth telling the office about today. */
export function needsAttention(items: ChecklistItem[]): boolean {
  return problems(items).length > 0;
}

/** The notification text for one subject's checklist, or null when it's fine. */
export function attentionSummary(
  subjectLabel: string,
  items: ChecklistItem[],
): { title: string; body: string } | null {
  const open = problems(items);
  if (open.length === 0) return null;
  return {
    title: `${subjectLabel}: ${statusHeadline(items)}`,
    body: open.map((p) => `${p.label} — ${describeItem(p)}`).join('\n'),
  };
}

/* ------------------------------------------------------------------ *
 * Assignment gate
 *
 * Whether a driver or a unit may be put on a load. This is the part of the
 * vault that acts rather than reports: a truck dispatched on a lapsed annual
 * inspection is the failure the whole module exists to prevent, and it is worth
 * more than any report.
 *
 * What blocks and what merely warns is a deliberate split:
 *
 *   - **EXPIRED blocks.** The document exists and its date has passed. There is
 *     no reading of that which is fine, and a dispatcher cannot fix it by
 *     ignoring it.
 *   - **MISSING does not block.** A vault that is still being filled in is the
 *     normal state of a new carrier — blocking on absence would refuse to assign
 *     anything on day one and teach dispatch to route around this feature
 *     entirely. It is reported, loudly, as a warning.
 *   - **EXPIRING warns.** Not yet a violation.
 *
 * Blocks can be overridden on purpose, and the override is recorded with a name
 * and a reason. A gate nobody can pass is a gate everybody turns off.
 * ------------------------------------------------------------------ */

export interface ComplianceFlag {
  subject: ComplianceSubject;
  subjectId: string;
  /** The driver's name or the unit label, so a message needs no second lookup. */
  label: string;
  kind: string;
  itemLabel: string;
  status: ComplianceStatus;
  expiresAt: string | null;
  daysUntil: number | null;
}

/** Only a lapse stops a dispatch. */
export const BLOCKING_STATUSES: readonly ComplianceStatus[] = ['EXPIRED'];

/** How long an override reason must be — a checkbox is not an explanation. */
export const MIN_OVERRIDE_REASON = 12;

export function assignmentBlocks(
  items: readonly ChecklistItem[],
  subject: ComplianceSubject,
  subjectId: string,
  label: string,
): ComplianceFlag[] {
  return items
    .filter((item) => BLOCKING_STATUSES.includes(item.status))
    .map((item) => flagFor(item, subject, subjectId, label));
}

/** Everything worth mentioning that does not stop the assignment. */
export function assignmentWarnings(
  items: readonly ChecklistItem[],
  subject: ComplianceSubject,
  subjectId: string,
  label: string,
): ComplianceFlag[] {
  return items
    .filter((item) => item.status === 'EXPIRING' || (item.required && item.status === 'MISSING'))
    .map((item) => flagFor(item, subject, subjectId, label))
    .filter((flag) => !BLOCKING_STATUSES.includes(flag.status));
}

function flagFor(
  item: ChecklistItem,
  subject: ComplianceSubject,
  subjectId: string,
  label: string,
): ComplianceFlag {
  return {
    subject,
    subjectId,
    label,
    kind: item.kind,
    itemLabel: item.label,
    status: item.status,
    expiresAt: item.expiresAt,
    daysUntil: item.daysUntil,
  };
}

/** `CDL / licence expired 3 days ago` — says what to fix, not just "blocked". */
export function describeFlag(flag: ComplianceFlag): string {
  const who = flag.label ? `${flag.label} — ` : '';
  if (statusIsExpired(flag)) {
    const days = flag.daysUntil === null ? null : Math.abs(flag.daysUntil);
    const when = days === 0 ? 'expired today' : days === null ? 'expired' : `expired ${days} day${days === 1 ? '' : 's'} ago`;
    return `${who}${flag.itemLabel} ${when}`;
  }
  if (flag.status === 'MISSING') return `${who}${flag.itemLabel} not on file`;
  const days = flag.daysUntil ?? 0;
  return `${who}${flag.itemLabel} expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`;
}

function statusIsExpired(flag: ComplianceFlag): boolean {
  return flag.status === 'EXPIRED';
}

/** The sentence the dispatcher reads when the assign is refused. */
export function blockedMessage(flags: readonly ComplianceFlag[]): string {
  if (flags.length === 0) return 'This assignment is blocked by a compliance lapse.';
  const first = describeFlag(flags[0] as ComplianceFlag);
  const more = flags.length > 1 ? ` (+${flags.length - 1} more)` : '';
  return `Cannot dispatch: ${first}${more}. Renew it, or override with a reason.`;
}

/** Trim and bound an override reason; null when it is usable. */
export function overrideReasonIssue(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.replace(/\s+/g, ' ').trim().length < MIN_OVERRIDE_REASON) {
    return `An override needs a reason of at least ${MIN_OVERRIDE_REASON} characters — it is recorded against your name.`;
  }
  if (raw.length > 1000) return 'That reason is too long — keep it under 1000 characters.';
  return null;
}

/** What an override row stores, so the decision is readable after a renewal. */
export function overrideSnapshot(flags: readonly ComplianceFlag[]): Array<{
  subject: ComplianceSubject;
  subjectId: string;
  label: string;
  kind: string;
  status: ComplianceStatus;
  expiresAt: string | null;
}> {
  return flags.map((f) => ({
    subject: f.subject,
    subjectId: f.subjectId,
    label: f.label,
    kind: f.kind,
    status: f.status,
    expiresAt: f.expiresAt,
  }));
}

export function describeItem(item: ChecklistItem): string {
  if (item.status === 'MISSING') return 'not on file';
  if (item.status === 'EXPIRED') {
    const days = item.daysUntil === null ? null : Math.abs(item.daysUntil);
    return days === 0 ? 'expired today' : `expired ${days} day${days === 1 ? '' : 's'} ago`;
  }
  if (item.status === 'EXPIRING') {
    const days = item.daysUntil ?? 0;
    return days === 0 ? 'expires today' : `expires in ${days} day${days === 1 ? '' : 's'}`;
  }
  return item.expiresAt ? `valid to ${item.expiresAt.slice(0, 10)}` : 'on file';
}
