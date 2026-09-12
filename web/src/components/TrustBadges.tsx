/**
 * Trust signals, in the two shapes they are needed:
 *
 *   TrustLine  — one compact row for a board card (mobile-first: at most three
 *                chips, because a card that explains itself is a card nobody
 *                reads).
 *   TrustPanel — the full picture in the load drawer, with the same facts and
 *                an explicit note that these are self-declared.
 *
 * Exactly one signal is externally checked: FMCSA operating status, and only
 * when that check has actually run. Everything else — insurance, authority age,
 * payment record, reports — stays labelled for what it is. A badge that
 * overstates itself is worse than no badge, so the wording is driven by
 * `verification` rather than assumed.
 */
export interface TrustPayment {
  avgDaysToPay: number;
  avgDaysPastDue: number;
  samples: number;
  band: 'ON_TIME' | 'LATE' | 'SLOW' | 'UNKNOWN';
  earlyData: boolean;
}

export interface TrustSignals {
  tenantId: string;
  name: string;
  level: 'RISKY' | 'THIN' | 'ESTABLISHED' | 'STRONG';
  authority: 'REVOKED' | 'NEW' | 'ESTABLISHED' | 'UNKNOWN';
  authorityStatus: string;
  authoritySince: string | null;
  authorityAgeYears: number | null;
  insurance: 'MISSING' | 'EXPIRED' | 'EXPIRING' | 'VALID';
  insuranceExpiresAt: string | null;
  payment: TrustPayment | null;
  openReports: number;
  ratingAvg: number | null;
  ratingCount: number;
  mcNumber: string | null;
  usdotNumber: string | null;
  /** true only when FMCSA confirmed the carrier may operate. */
  verified: boolean;
  verification: 'VERIFIED' | 'DECLARED' | 'NONE' | 'FAILED';
  verificationNote: string;
  fmcsaStatus: string | null;
  fmcsaLegalName: string | null;
  fmcsaCheckedAt: string | null;
  flags: string[];
  declaredAt: string | null;
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function authorityChip(trust: TrustSignals): { tone: Tone; text: string } {
  if (trust.authority === 'REVOKED') return { tone: 'bad', text: 'Authority not active' };
  const years = trust.authorityAgeYears;
  if (trust.authority === 'ESTABLISHED' && years != null) {
    return { tone: 'ok', text: `Authority ${years} yr${years === 1 ? '' : 's'}` };
  }
  if (trust.authority === 'NEW') {
    return { tone: 'warn', text: `New authority${years != null && years > 0 ? ` · ${years} yr` : ' · under 1 yr'}` };
  }
  return { tone: 'muted', text: 'Authority age unknown' };
}

export function insuranceChip(trust: TrustSignals): { tone: Tone; text: string } {
  if (trust.insurance === 'VALID' && trust.insuranceExpiresAt) {
    return { tone: 'ok', text: `Insured to ${monthYear(trust.insuranceExpiresAt)}` };
  }
  if (trust.insurance === 'EXPIRING' && trust.insuranceExpiresAt) {
    const days = daysUntil(trust.insuranceExpiresAt);
    return { tone: 'warn', text: `Insurance expires in ${days} day${days === 1 ? '' : 's'}` };
  }
  if (trust.insurance === 'EXPIRED') return { tone: 'bad', text: 'Insurance expired' };
  return { tone: 'bad', text: 'No insurance on file' };
}

/**
 * The authority check, stated for exactly what happened. "Self-declared" is
 * shown just as plainly as "checked" because a carrier reading this is deciding
 * whether to hand over freight.
 */
export function verificationChip(trust: TrustSignals): { tone: Tone; text: string } {
  if (trust.verification === 'VERIFIED') return { tone: 'ok', text: 'FMCSA checked' };
  if (trust.verification === 'FAILED') return { tone: 'bad', text: 'Not cleared to operate' };
  if (trust.verification === 'DECLARED') return { tone: 'muted', text: 'Self-declared authority' };
  return { tone: 'muted', text: 'No authority on file' };
}

export function paymentChip(payment: TrustPayment): { tone: Tone; text: string } {
  const label = `Pays in ~${payment.avgDaysToPay} days`;
  const suffix = payment.earlyData ? ` · ${payment.samples} invoice${payment.samples === 1 ? '' : 's'}` : '';
  if (payment.band === 'ON_TIME') return { tone: 'ok', text: `${label}${suffix}` };
  if (payment.band === 'LATE') return { tone: 'warn', text: `${label}${suffix}` };
  return { tone: 'bad', text: `${label}${suffix}` };
}

function Chip({ tone, text, title }: { tone: Tone; text: string; title?: string }) {
  return (
    <span className={`trust-chip ${tone}`} title={title}>
      {text}
    </span>
  );
}

/** Compact line for a board card: at most three chips. */
export function TrustLine({ trust }: { trust: TrustSignals | null | undefined }) {
  if (!trust) return null;
  const insurance = insuranceChip(trust);
  const verification = verificationChip(trust);
  const payment = trust.payment ? paymentChip(trust.payment) : null;

  return (
    <div className="trust-chips">
      {trust.verification !== 'NONE' && (
        <Chip tone={verification.tone} text={verification.text} title={trust.verificationNote} />
      )}
      <Chip tone={insurance.tone} text={insurance.text} title="Declared by the carrier; not independently verified" />
      {payment && <Chip tone={payment.tone} text={payment.text} title="Average from invoices issued on Loadwave" />}
      {trust.openReports > 0 && (
        <Chip
          tone="bad"
          text={`⚑ ${trust.openReports} report${trust.openReports === 1 ? '' : 's'}`}
          title="Complaints filed by counterparties in the last 12 months"
        />
      )}
    </div>
  );
}

const LEVEL_COPY: Record<TrustSignals['level'], { tone: Tone; label: string; blurb: string }> = {
  STRONG: { tone: 'ok', label: 'Strong', blurb: 'Established authority, current insurance, a clean payment record.' },
  ESTABLISHED: { tone: 'ok', label: 'Established', blurb: 'Established authority with insurance on file.' },
  THIN: { tone: 'warn', label: 'Thin file', blurb: 'Some trust signals are missing — read the details before booking.' },
  RISKY: { tone: 'bad', label: 'Caution', blurb: 'One or more serious signals. Confirm details with the carrier directly.' },
};

/** Full trust block for the load drawer. */
export function TrustPanel({
  trust,
  onReport,
}: {
  trust: TrustSignals | null | undefined;
  onReport?: () => void;
}) {
  if (!trust) {
    return (
      <div className="trust-panel">
        <div className="trust-head">
          <span className="trust-level muted">No trust data</span>
        </div>
        <p className="muted small">This carrier has not published compliance details yet.</p>
        {onReport && (
          <button type="button" className="btn-ghost btn-sm trust-report" onClick={onReport}>
            ⚑ Report this carrier
          </button>
        )}
      </div>
    );
  }

  const level = LEVEL_COPY[trust.level];
  const authority = authorityChip(trust);
  const insurance = insuranceChip(trust);
  const verification = verificationChip(trust);
  const payment = trust.payment ? paymentChip(trust.payment) : null;

  return (
    <div className="trust-panel">
      <div className="trust-head">
        <span className={`trust-level ${level.tone}`}>{level.label}</span>
        <span className="muted small">{level.blurb}</span>
      </div>

      <dl className="trust-rows">
        <div>
          <dt>Authority check</dt>
          <dd>
            <Chip tone={verification.tone} text={verification.text} />
            <span className="muted small"> {trust.verificationNote}</span>
            {trust.fmcsaLegalName && (
              <span className="muted small"> · registered as {trust.fmcsaLegalName}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Authority</dt>
          <dd>
            <Chip tone={authority.tone} text={authority.text} />
            {trust.authoritySince && (
              <span className="muted small"> since {monthYear(trust.authoritySince)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Insurance</dt>
          <dd>
            <Chip tone={insurance.tone} text={insurance.text} />
          </dd>
        </div>
        <div>
          <dt>Payment record</dt>
          <dd>
            {payment ? (
              <>
                <Chip tone={payment.tone} text={payment.text} />
                <span className="muted small">
                  {' '}
                  {trust.payment && trust.payment.avgDaysPastDue <= 0
                    ? 'paid on time or early'
                    : `${trust.payment?.avgDaysPastDue} days past due on average`}
                </span>
              </>
            ) : (
              <span className="muted small">No invoices settled on Loadwave yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Ratings</dt>
          <dd>
            {trust.ratingCount > 0 && trust.ratingAvg != null ? (
              <span>
                ★ {trust.ratingAvg.toFixed(1)} <span className="muted small">from {trust.ratingCount}</span>
              </span>
            ) : (
              <span className="muted small">No ratings yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Reports</dt>
          <dd>
            {trust.openReports > 0 ? (
              <Chip tone="bad" text={`⚑ ${trust.openReports} in the last year`} />
            ) : (
              <span className="muted small">None in the last year</span>
            )}
          </dd>
        </div>
        {trust.mcNumber || trust.usdotNumber ? (
          <div>
            <dt>Numbers</dt>
            <dd className="muted small">
              {[
                trust.mcNumber ? (/^MC/i.test(trust.mcNumber) ? trust.mcNumber.toUpperCase() : `MC ${trust.mcNumber}`) : null,
                trust.usdotNumber
                  ? /^USDOT/i.test(trust.usdotNumber)
                    ? trust.usdotNumber.toUpperCase()
                    : `USDOT ${trust.usdotNumber}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        ) : null}
      </dl>

      {trust.flags.length > 0 && (
        <ul className="trust-flags">
          {trust.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      <p className="muted small trust-caveat">
        {trust.verification === 'VERIFIED'
          ? 'Authority status was checked against FMCSA records. Insurance and the authority start date are declared by the carrier. Payment record comes from invoices settled on Loadwave.'
          : trust.verification === 'FAILED'
            ? 'FMCSA records do not show this carrier as allowed to operate. Treat any booking with them with caution.'
            : 'Authority and insurance are declared by the carrier and have not been independently verified. Payment record comes from invoices settled on Loadwave.'}
      </p>

      {onReport && (
        <button type="button" className="btn-ghost btn-sm trust-report" onClick={onReport}>
          ⚑ Report this carrier
        </button>
      )}
    </div>
  );
}
