import { d, toDb } from '../../utils/decimal';
import { quarterOf } from '../../utils/quarters';

export interface ArInvoiceRow {
  totalBase: string;
  issueDate: Date | string;
  dueDate: Date | string;
  paidAt: Date | string | null;
}

export interface ArBucket {
  label: string;
  count: number;
  amountBase: string;
}

export interface ArQuarterRow {
  quarter: string;
  count: number;
  amountBase: string;
}

export interface ArAgingReport {
  asOf: string;
  unpaidCount: number;
  outstandingBase: string;
  notYetDueBase: string;
  overdueBase: string;
  paidCount: number;
  paidTotalBase: string;
  buckets: ArBucket[];
  outstandingByQuarter: ArQuarterRow[];
}

const DAY = 24 * 3_600_000;

export const AGING_BUCKETS = ['Not yet due', '0–30 days', '31–60 days', '61–90 days', '90+ days'] as const;

export function computeAging(rows: ArInvoiceRow[], asOf: Date = new Date()): ArAgingReport {
  let totals = d(0);
  let paid = d(0);
  const buckets = AGING_BUCKETS.map<ArBucket>((label) => ({ label, count: 0, amountBase: '0' }));
  const quarters = new Map<string, { count: number; amountBase: ReturnType<typeof d> }>();
  let unpaidCount = 0;
  let paidCount = 0;

  for (const row of rows) {
    const due = new Date(row.dueDate);
    const value = d(row.totalBase);
    if (row.paidAt) {
      paidCount += 1;
      paid = paid.plus(value);
      continue;
    }
    unpaidCount += 1;
    totals = totals.plus(value);

    const ageMs = asOf.getTime() - due.getTime();
    const bucket = ageMs <= 0 ? 0 : ageMs <= 30 * DAY ? 1 : ageMs <= 60 * DAY ? 2 : ageMs <= 90 * DAY ? 3 : 4;
    const b = buckets[bucket];
    b.count += 1;
    b.amountBase = toDb(d(b.amountBase).plus(value));

    const q = quarterOf(new Date(row.issueDate));
    const cur = quarters.get(q) ?? { count: 0, amountBase: d(0) };
    cur.count += 1;
    cur.amountBase = cur.amountBase.plus(value);
    quarters.set(q, cur);
  }

  const outstandingByQuarter: ArQuarterRow[] = [...quarters.entries()]
    .map(([quarter, v]) => ({ quarter, count: v.count, amountBase: toDb(v.amountBase) }))
    .sort((a, b) => (a.quarter < b.quarter ? 1 : -1));

  const notYetDue = buckets[0];
  return {
    asOf: asOf.toISOString(),
    unpaidCount,
    outstandingBase: toDb(totals),
    notYetDueBase: notYetDue.amountBase,
    overdueBase: toDb(totals.minus(d(notYetDue.amountBase))),
    paidCount,
    paidTotalBase: toDb(paid),
    buckets,
    outstandingByQuarter,
  };
}
