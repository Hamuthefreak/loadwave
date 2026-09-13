import {
  ageInDays,
  answerNotification,
  cents,
  DISPUTE_MESSAGE_MIN,
  disputeNotification,
  disputeReference,
  disputedCents,
  disputedSummary,
  findOpenDuplicate,
  isDisputeSubject,
  normalizeAnswer,
  normalizeMessage,
  queryAgeLabel,
  signoffText,
  snapshotLine,
  subjectLabel,
  type DisputedLine,
} from '../../src/modules/settlements/dispute.policy';

const line: DisputedLine = {
  reference: 'LW-1001',
  lane: 'QC → ON',
  deliveredAt: '2026-09-08T18:00:00.000Z',
  miles: 412.3,
  basis: '412.3 mi × $0.58/mi',
  baseCents: 23913,
  detentionHours: 2.5,
  detentionBasis: '2.5 h detention × $60.00/h',
  detentionCents: 15000,
  totalCents: 38913,
};

describe('query text', () => {
  it('trims, collapses whitespace and refuses a note too short to act on', () => {
    expect(normalizeMessage('  short  ')).toEqual({
      ok: false,
      error: `A note to dispatch needs at least ${DISPUTE_MESSAGE_MIN} characters`,
    });
    expect(normalizeMessage('')).toEqual({ ok: false, error: expect.stringContaining('at least') });
    expect(normalizeMessage(undefined)).toEqual({ ok: false, error: 'A note to dispatch is required' });
    // Pasted notes arrive with newlines; they must not pad the length count.
    expect(normalizeMessage('short\n\n\n')).toEqual({ ok: false, error: expect.stringContaining('at least') });
    const ok = normalizeMessage('  The   miles on this one look short.\n');
    expect(ok).toEqual({ ok: true, value: 'The miles on this one look short.' });
  });

  it('bounds the length so a paragraph cannot be pasted in', () => {
    expect(normalizeMessage('a'.repeat(1001))).toEqual({
      ok: false,
      error: 'A note to dispatch is longer than 1000 characters',
    });
  });

  it('requires the office to actually answer', () => {
    expect(normalizeAnswer('no')).toEqual({
      ok: false,
      error: 'An answer needs at least 8 characters',
    });
    expect(normalizeAnswer('Mileage corrected to 418.2 mi from the ELD.')).toEqual({
      ok: true,
      value: 'Mileage corrected to 418.2 mi from the ELD.',
    });
  });

  it('only accepts the subjects and statuses it knows', () => {
    expect(isDisputeSubject('LINE')).toBe(true);
    expect(isDisputeSubject('DETENTION')).toBe(true);
    expect(isDisputeSubject('line')).toBe(false);
    // Nothing to point at, so a whole-week query is not a subject.
    expect(isDisputeSubject('PERIOD')).toBe(false);
    expect(isDisputeSubject(null)).toBe(false);
    expect(subjectLabel('DETENTION')).toBe('detention time');
    expect(subjectLabel('LINE')).toBe('the load line');
  });
});

describe('the disputed figure', () => {
  it('points at the part of the line that was questioned', () => {
    expect(disputedCents(line, 'LINE')).toBe(23913);
    expect(disputedCents(line, 'DETENTION')).toBe(15000);
  });

  it('writes money the way a driver reads it', () => {
    expect(cents(23913)).toBe('$239.13');
    expect(cents(0)).toBe('$0.00');
    expect(cents(5)).toBe('$0.05');
    expect(cents(-1234)).toBe('-$12.34');
  });

  it('shows the arithmetic in the office inbox, not just an amount', () => {
    expect(disputedSummary(line, 'LINE')).toBe('LW-1001 · QC → ON · 412.3 mi × $0.58/mi → $239.13');
    expect(disputedSummary(line, 'DETENTION')).toBe('LW-1001 · QC → ON · 2.5 h detention × $60.00/h → $150.00');
  });

  it('falls back to the hours when a detention line has no rate', () => {
    const noRate = { ...line, detentionBasis: null, detentionCents: 0 };
    expect(disputedSummary(noRate, 'DETENTION')).toContain('2.5 h detention');
  });

  it('snapshots only what the statement actually showed', () => {
    const snapshot = snapshotLine({ ...line, loadId: 'load-9', priced: false } as never);
    expect(snapshot).toEqual(line);
    expect(Object.keys(snapshot)).not.toContain('loadId');
  });
});

describe('duplicate queries', () => {
  it('treats a second tap on the same figure as the query already open', () => {
    const open = [
      { loadId: 'load-1', subject: 'LINE', status: 'OPEN' },
      { loadId: 'load-2', subject: 'LINE', status: 'RESOLVED' },
    ];
    expect(findOpenDuplicate(open, 'load-1', 'LINE')).toBe(open[0]);
    // A different part of the same load, or a different load, is a real query.
    expect(findOpenDuplicate(open, 'load-1', 'DETENTION')).toBeUndefined();
    expect(findOpenDuplicate(open, 'load-2', 'LINE')).toBeUndefined();
    expect(findOpenDuplicate(open, null, 'LINE')).toBeUndefined();
  });
});

describe('ageing', () => {
  it('counts whole days open', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    expect(ageInDays('2026-09-14T09:00:00.000Z', now)).toBe(0);
    expect(ageInDays('2026-09-13T09:00:00.000Z', now)).toBe(1);
    expect(ageInDays('2026-09-04T09:00:00.000Z', now)).toBe(10);
    expect(ageInDays('not a date', now)).toBe(0);
    expect(queryAgeLabel(0)).toBe('raised today');
    expect(queryAgeLabel(1)).toBe('open 1 day');
    expect(queryAgeLabel(3)).toBe('open 3 days');
  });
});

describe('notifications', () => {
  it('tells the office what was questioned, and the driver the outcome', () => {
    const raised = disputeNotification({ driverName: 'Maria Chen', line, subject: 'LINE' });
    expect(raised.title).toBe('Maria Chen queried the load line');
    expect(raised.body).toBe('LW-1001 · QC → ON · 412.3 mi × $0.58/mi → $239.13');

    expect(answerNotification({ status: 'RESOLVED', periodLabel: 'Sep 7 – 13, 2026', reference: 'LD-3F9A21' }).title)
      .toBe('Your pay query was answered');
    expect(answerNotification({ status: 'DECLINED', periodLabel: 'Sep 7 – 13, 2026', reference: 'LD-3F9A21' }).title)
      .toBe('Your pay query was declined');
  });

  it('makes a quotable reference out of a uuid', () => {
    expect(disputeReference('3f9a21c4-1111-2222-3333-444455556666')).toBe('PD-3F9A21C4');
  });
});

describe('sign-off wording', () => {
  it('states the facts of the period', () => {
    const text = signoffText({
      driverName: 'Maria Chen',
      periodLabel: 'Sep 7 – 13, 2026',
      totalLabel: '$694.21',
      openQueries: 0,
    });
    expect(text).toContain('$694.21');
    expect(text).toContain('Sep 7 – 13, 2026');
    expect(text).not.toMatch(/query/i);
  });

  // Payroll is filed on this sheet, so a driver with an unresolved question must
  // not be signing that they agree with the number.
  it('discloses queries that are still open', () => {
    const one = signoffText({ driverName: 'Maria Chen', periodLabel: 'week', totalLabel: '$694.21', openQueries: 1 });
    expect(one).toContain('1 pay query still open');
    const two = signoffText({ driverName: 'Maria Chen', periodLabel: 'week', totalLabel: '$694.21', openQueries: 2 });
    expect(two).toContain('2 pay queries still open');
  });
});
