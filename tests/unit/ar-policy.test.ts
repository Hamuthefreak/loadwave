import { computeAging, type ArInvoiceRow } from '../../src/modules/invoicing/ar.policy';

const NOW = new Date('2026-09-05T00:00:00Z');
const DAY = 24 * 3_600_000;

function inv(
  totalBase: string,
  opts: { issue?: string; due: string; paid?: string | null },
): ArInvoiceRow {
  return {
    totalBase,
    issueDate: opts.issue ?? '2026-07-15T00:00:00Z',
    dueDate: opts.due,
    paidAt: opts.paid ?? null,
  };
}

describe('computeAging', () => {
  it('buckets outstanding invoices by days past due and keeps paid ones separate', () => {
    const report = computeAging(
      [
        inv('1000', { due: new Date(NOW.getTime() - 10 * DAY).toISOString() }), // 0–30
        inv('2000', { due: new Date(NOW.getTime() - 45 * DAY).toISOString() }), // 31–60
        inv('3000', { due: new Date(NOW.getTime() - 200 * DAY).toISOString() }), // 90+
        inv('4000', { due: new Date(NOW.getTime() + 10 * DAY).toISOString() }), // not yet due
        inv('5000', {
          due: new Date(NOW.getTime() - 30 * DAY).toISOString(),
          paid: new Date(NOW.getTime() - 5 * DAY).toISOString(),
        }),
      ],
      NOW,
    );

    expect(report.unpaidCount).toBe(4);
    expect(report.paidCount).toBe(1);
    expect(Number(report.outstandingBase)).toBe(10000);
    expect(Number(report.notYetDueBase)).toBe(4000);
    expect(Number(report.overdueBase)).toBe(6000);
    expect(Number(report.paidTotalBase)).toBe(5000);

    const byLabel = Object.fromEntries(report.buckets.map((b) => [b.label, b]));
    expect(byLabel['0–30 days']).toMatchObject({ count: 1 });
    expect(byLabel['31–60 days']).toMatchObject({ count: 1, amountBase: '2000' });
    expect(byLabel['90+ days']).toMatchObject({ count: 1 });
    expect(byLabel['Not yet due']).toMatchObject({ count: 1 });
    expect(byLabel['61–90 days']).toMatchObject({ count: 0 });
  });

  it('groups outstanding by issue quarter, newest first', () => {
    const report = computeAging(
      [
        inv('100', { issue: '2026-01-10T00:00:00Z', due: '2026-01-30T00:00:00Z' }),
        inv('200', { issue: '2026-04-10T00:00:00Z', due: '2026-04-30T00:00:00Z' }),
        inv('300', { issue: '2026-04-20T00:00:00Z', due: '2026-05-10T00:00:00Z' }),
      ],
      NOW,
    );
    expect(report.outstandingByQuarter.map((q) => q.quarter)).toEqual(['2026-Q2', '2026-Q1']);
    const q2 = report.outstandingByQuarter.find((q) => q.quarter === '2026-Q2')!;
    expect(q2).toMatchObject({ count: 2, amountBase: '500' });
  });

  it('returns zeros for an empty ledger', () => {
    const report = computeAging([], NOW);
    expect(report.unpaidCount).toBe(0);
    expect(Number(report.outstandingBase)).toBe(0);
    expect(report.buckets.every((b) => b.count === 0)).toBe(true);
    expect(report.outstandingByQuarter).toEqual([]);
  });
});
