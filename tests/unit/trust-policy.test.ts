/**
 * Trust layer rules. These pin the two things that decide whether a carrier
 * trusts a badge: how insurance/authority are classified, and what a real
 * days-to-pay figure is computed from (invoices we issued and they settled —
 * nothing self-reported).
 */
import {
  NEW_AUTHORITY_DAYS,
  insuranceState,
  authorityState,
  authorityAgeYears,
  paymentRecord,
  paymentBand,
  trustSummary,
  reportAllowed,
  isReportCategory,
  withinCooldown,
  REPORT_CATEGORIES,
  type SettledInvoice,
  type TrustInput,
} from '../../src/modules/trust/trust.policy';

const NOW = new Date('2026-09-12T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('insurance state', () => {
  it('is MISSING when nothing is on file', () => {
    expect(insuranceState(null, NOW)).toBe('MISSING');
    expect(insuranceState(undefined, NOW)).toBe('MISSING');
  });

  it('flags an expired policy as EXPIRED, not merely old', () => {
    expect(insuranceState(days(-1), NOW)).toBe('EXPIRED');
  });

  it('warns inside the 45-day window and clears beyond it', () => {
    expect(insuranceState(days(45), NOW)).toBe('EXPIRING');
    expect(insuranceState(days(46), NOW)).toBe('VALID');
    expect(insuranceState(days(400), NOW)).toBe('VALID');
  });
});

describe('authority state', () => {
  it('treats a revoked authority as revoked even if it is old', () => {
    expect(authorityState('REVOKED', days(-3000), NOW)).toBe('REVOKED');
    expect(authorityState('out_of_service', days(-3000), NOW)).toBe('REVOKED');
  });

  it('is UNKNOWN without a start date', () => {
    expect(authorityState('ACTIVE', null, NOW)).toBe('UNKNOWN');
  });

  it('separates a new authority from an established one at one year', () => {
    expect(authorityState('ACTIVE', days(-100), NOW)).toBe('NEW');
    expect(authorityState('ACTIVE', days(-400), NOW)).toBe('ESTABLISHED');
  });

  it('reports whole years of authority', () => {
    expect(authorityAgeYears(new Date('2019-03-01T00:00:00Z'), NOW)).toBe(7);
    expect(authorityAgeYears(null, NOW)).toBeNull();
  });
});

describe('payment record', () => {
  const invoice = (issueOffset: number, dueOffset: number, paidOffset: number | null): SettledInvoice => ({
    issueDate: days(issueOffset),
    dueDate: days(dueOffset),
    paidAt: paidOffset == null ? null : days(paidOffset),
  });

  it('is null with nothing settled — never a zero-day claim', () => {
    expect(paymentRecord([], NOW)).toBeNull();
    expect(paymentRecord([invoice(-60, -30, null)], NOW)).toBeNull();
  });

  it('averages days-to-pay and days-past-due only over settled invoices', () => {
    const record = paymentRecord(
      [invoice(-100, -70, -80), invoice(-60, -30, -20), invoice(-40, -10, null)],
      NOW,
    );
    expect(record).not.toBeNull();
    expect(record?.samples).toBe(2);
    // Paid 20 and 40 days after issue; the unpaid invoice is not an average.
    expect(record?.avgDaysToPay).toBe(30);
    // 10 days early on one, 10 days late on the other.
    expect(record?.avgDaysPastDue).toBe(0);
    expect(record?.band).toBe('ON_TIME');
    expect(record?.earlyData).toBe(true);
  });

  it('bands late and slow payers apart', () => {
    expect(paymentBand(-3)).toBe('ON_TIME');
    expect(paymentBand(0)).toBe('ON_TIME');
    expect(paymentBand(10)).toBe('LATE');
    expect(paymentBand(15)).toBe('LATE');
    expect(paymentBand(16)).toBe('SLOW');
  });

  it('calls a two-invoice sample early data but a four-invoice one solid', () => {
    const two = paymentRecord([invoice(-100, -70, -60), invoice(-90, -60, -50)], NOW);
    const four = paymentRecord(
      [invoice(-100, -70, -60), invoice(-90, -60, -50), invoice(-80, -50, -40), invoice(-70, -40, -30)],
      NOW,
    );
    expect(two?.earlyData).toBe(true);
    expect(four?.earlyData).toBe(false);
  });

  it('ignores invoices older than the window and impossible payment dates', () => {
    const record = paymentRecord([invoice(-3000, -2970, -2900), invoice(-50, -20, -70)], NOW);
    expect(record).toBeNull();
  });

  it('clips the window so a retired lane does not colour a current record', () => {
    const record = paymentRecord([invoice(-800, -770, -760), invoice(-40, -10, -5)], NOW, { windowDays: 365 });
    expect(record?.samples).toBe(1);
  });
});

describe('trust summary', () => {
  const base = {
    insuranceExpiresAt: days(300),
    authorityStatus: 'ACTIVE',
    authoritySince: days(-2000),
    payment: null,
    openReports: 0,
    ratingAvg: 4.5,
    ratingCount: 3,
    // Authority confirmed by FMCSA. Left out of a variant below on purpose:
    // without it the signal is self-declared and the summary must say so.
    verification: 'VERIFIED' as const,
  };

  it('is STRONG only with an established authority, current insurance, on-time payers and no reports', () => {
    const summary = trustSummary(
      { ...base, payment: { avgDaysToPay: 21, avgDaysPastDue: -2, samples: 6, band: 'ON_TIME', earlyData: false } },
      NOW,
    );
    expect(summary.level).toBe('STRONG');
    expect(summary.flags).toEqual([]);
  });

  it('says out loud when authority is self-declared rather than checked', () => {
    // Built without a verification field on purpose: that is the state every
    // tenant is in until an FMCSA check actually runs.
    const selfDeclared: TrustInput = {
      insuranceExpiresAt: base.insuranceExpiresAt,
      authorityStatus: base.authorityStatus,
      authoritySince: base.authoritySince,
      payment: null,
      openReports: 0,
      ratingAvg: base.ratingAvg,
      ratingCount: base.ratingCount,
    };
    const summary = trustSummary(selfDeclared, NOW);
    expect(summary.verification).toBe('DECLARED');
    expect(summary.flags).toContain('Authority status is declared, not checked against FMCSA');
    // An unchecked authority must not read as strong just because it is old.
    expect(summary.level).not.toBe('STRONG');
  });

  it('treats an FMCSA failure as RISKY even when the carrier declared itself active', () => {
    const summary = trustSummary(
      { ...base, verification: 'FAILED', payment: { avgDaysToPay: 12, avgDaysPastDue: -3, samples: 8, band: 'ON_TIME', earlyData: false } },
      NOW,
    );
    expect(summary.level).toBe('RISKY');
    expect(summary.flags).toContain('FMCSA records do not allow this carrier to operate');
  });

  it('is ESTABLISHED when the payment record is missing — an unknown file is not a bad one', () => {
    expect(trustSummary(base, NOW).level).toBe('ESTABLISHED');
  });

  it('is THIN for a new authority or missing insurance', () => {
    expect(trustSummary({ ...base, insuranceExpiresAt: null }, NOW).level).toBe('THIN');
    expect(trustSummary({ ...base, authoritySince: days(-30) }, NOW).level).toBe('THIN');
  });

  it('is RISKY on a revoked authority, repeated reports, or slow payment', () => {
    expect(trustSummary({ ...base, authorityStatus: 'REVOKED' }, NOW).level).toBe('RISKY');
    expect(trustSummary({ ...base, openReports: 2 }, NOW).level).toBe('RISKY');
    expect(
      trustSummary(
        { ...base, payment: { avgDaysToPay: 60, avgDaysPastDue: 25, samples: 5, band: 'SLOW', earlyData: false } },
        NOW,
      ).level,
    ).toBe('RISKY');
  });

  it('explains itself with flags instead of a bare badge', () => {
    const summary = trustSummary({ ...base, insuranceExpiresAt: days(-5), openReports: 1 }, NOW);
    expect(summary.flags).toContain('Insurance expired');
    expect(summary.flags).toContain('1 report in the last year');
  });

  it('exposes the constants the copy depends on', () => {
    expect(NEW_AUTHORITY_DAYS).toBeGreaterThanOrEqual(365);
    expect(REPORT_CATEGORIES).toContain('NON_PAYMENT');
  });
});

describe('report rules', () => {
  it('accepts only known categories', () => {
    expect(isReportCategory('NON_PAYMENT')).toBe(true);
    expect(isReportCategory('DOUBLE_BROKERING')).toBe(true);
    expect(isReportCategory('because i said so')).toBe(false);
    expect(isReportCategory('')).toBe(false);
  });

  it('refuses self-reports and strangers', () => {
    expect(reportAllowed('a', 'a', { sharedLoad: true })).toMatchObject({ ok: false });
    expect(reportAllowed('a', 'b', { sharedLoad: false }).ok).toBe(false);
    expect(reportAllowed('a', 'b', { sharedLoad: true }).ok).toBe(true);
  });

  it('allows one report per counterparty every 90 days', () => {
    expect(withinCooldown(new Date(NOW.getTime() - 10 * 86_400_000), NOW)).toBe(true);
    expect(withinCooldown(new Date(NOW.getTime() - 91 * 86_400_000), NOW)).toBe(false);
  });
});
