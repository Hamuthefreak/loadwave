import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Badge, Empty, Modal, PageHeader, Spinner, Stat } from '../../components/ui';
import { money, shortDate } from '../../utils/format';

interface Invoice {
  id: string;
  customerId: string;
  loadId: string | null;
  issueDate: string;
  dueDate: string;
  currencyTransaction: string;
  totalTransaction: string;
  totalBase: string;
  paidAt: string | null;
}

interface ArBucket {
  label: string;
  count: number;
  amountBase: string;
}

interface ArReport {
  asOf: string;
  unpaidCount: number;
  outstandingBase: string;
  notYetDueBase: string;
  overdueBase: string;
  paidCount: number;
  paidTotalBase: string;
  buckets: ArBucket[];
  outstandingByQuarter: Array<{ quarter: string; count: number; amountBase: string }>;
}

function quarterKey(year: number, q: number): string {
  return `${year}-Q${q}`;
}

function quarterOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 6; i += 1) {
    const yq = q - i;
    let yy = y;
    let qq = yq;
    while (qq <= 0) {
      yy -= 1;
      qq += 4;
    }
    out.push({ value: quarterKey(yy, qq), label: quarterKey(yy, qq) });
  }
  return out;
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

type PaidFilter = 'all' | 'open' | 'paid';

export default function Billing() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [aging, setAging] = useState<ArReport | null>(null);
  const [baseCurrency, setBaseCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [quarter, setQuarter] = useState('all');
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [paidDate, setPaidDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inv, ar, tenant] = await Promise.all([
        api<Invoice[]>('/api/invoices'),
        api<ArReport>('/api/ar/aging'),
        api<{ baseCurrency: string }>('/api/tenants/me'),
      ]);
      setInvoices(inv);
      setAging(ar);
      setBaseCurrency(tenant.baseCurrency === 'USD' ? 'USD' : 'CAD');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const rows = invoices ?? [];
    return rows.filter((i) => {
      const q = i.issueDate.slice(0, 4) + '-Q' + (Math.floor(new Date(i.issueDate).getMonth() / 3) + 1);
      if (quarter !== 'all' && q !== quarter) return false;
      if (paidFilter === 'paid' && !i.paidAt) return false;
      if (paidFilter === 'open' && i.paidAt) return false;
      return true;
    });
  }, [invoices, quarter, paidFilter]);

  const submitPaid = async () => {
    if (!payFor || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/invoices/${payFor.id}/pay`, {
        method: 'PATCH',
        body: {
          paid: true,
          ...(paidDate ? { paidAt: new Date(`${paidDate}T00:00:00`).toISOString() } : {}),
        },
      });
      setFlash(`Invoice to ${payFor.customerId} marked paid.`);
      setPayFor(null);
      setPaidDate('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark the invoice paid');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (inv: Invoice) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/invoices/${inv.id}/pay`, { method: 'PATCH', body: { paid: false } });
      setFlash(`Invoice to ${inv.customerId} reopened — it's back in accounts receivable.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen the invoice');
    } finally {
      setBusy(false);
    }
  };

  const todayIso = toDateOnly(new Date().toISOString());
  const now = new Date().getTime();

  return (
    <div>
      <PageHeader
        title="Billing & accounts receivable"
        sub="Every invoice you've raised, what's still owed, and how old it is."
        actions={<button className="btn-ghost" onClick={() => void load()}>↻ Refresh</button>}
      />

      {flash && <div className="alert alert-success">{flash}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!aging || !invoices ? (
        <Spinner label="Loading billing…" />
      ) : (
        <>
          <div className="grid">
            <Stat
              label="Outstanding"
              value={money(aging.outstandingBase, baseCurrency)}
              sub={`${aging.unpaidCount} open invoice${aging.unpaidCount === 1 ? '' : 's'}`}
              tone="amber"
            />
            <Stat
              label="Overdue"
              value={money(aging.overdueBase, baseCurrency)}
              sub="Past their due date"
              tone="red"
            />
            <Stat
              label="Not yet due"
              value={money(aging.notYetDueBase, baseCurrency)}
              sub="Within their payment terms"
              tone="default"
            />
            <Stat
              label="Received"
              value={money(aging.paidTotalBase, baseCurrency)}
              sub={`${aging.paidCount} paid`}
              tone="green"
            />
          </div>

          <div className="grid" style={{ marginTop: 18, gridTemplateColumns: '1fr 1fr' }}>
            <div className="card">
              <h3>How old is what's owed?</h3>
              {aging.buckets.every((b) => b.count === 0) ? (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Nothing outstanding — nice and clean.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Bucket</th><th>Invoices</th><th>Amount</th></tr>
                    </thead>
                    <tbody>
                      {aging.buckets.map((b) => (
                        <tr key={b.label}>
                          <td>
                            <strong>{b.label}</strong>
                          </td>
                          <td>{b.count}</td>
                          <td className="mono-num">{Number(b.amountBase) > 0 ? money(b.amountBase, baseCurrency) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <h3>Outstanding by quarter</h3>
              {aging.outstandingByQuarter.length === 0 ? (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  No open invoices issued in the last few quarters.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Quarter</th><th>Invoices</th><th>Still owed</th></tr>
                    </thead>
                    <tbody>
                      {aging.outstandingByQuarter.map((q) => (
                        <tr key={q.quarter}>
                          <td><strong>{q.quarter}</strong></td>
                          <td>{q.count}</td>
                          <td className="mono-num">{money(q.amountBase, baseCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="billing-toolbar">
              <div className="tabs">
                <button className={paidFilter === 'all' ? 'active' : ''} onClick={() => setPaidFilter('all')}>All</button>
                <button className={paidFilter === 'open' ? 'active' : ''} onClick={() => setPaidFilter('open')}>Open</button>
                <button className={paidFilter === 'paid' ? 'active' : ''} onClick={() => setPaidFilter('paid')}>Paid</button>
              </div>
              <label className="billing-quarter">
                Quarter
                <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                  <option value="all">All quarters</option>
                  {quarterOptions().map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {filtered.length === 0 ? (
              <Empty
                title="No invoices here"
                sub={invoices.length === 0 ? 'Invoice a delivered load from My Loads and it shows up here.' : 'Try widening the filters.'}
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Bill to</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((inv) => {
                      const overdue = !inv.paidAt && new Date(inv.dueDate).getTime() < now;
                      return (
                        <tr key={inv.id}>
                          <td><strong>{inv.customerId}</strong></td>
                          <td>{shortDate(inv.issueDate)}</td>
                          <td>{shortDate(inv.dueDate)}</td>
                          <td className="mono-num">{money(inv.totalTransaction, inv.currencyTransaction)}</td>
                          <td>
                            {inv.paidAt ? (
                              <Badge tone="green">Paid · {shortDate(inv.paidAt)}</Badge>
                            ) : overdue ? (
                              <Badge tone="red">Overdue</Badge>
                            ) : (
                              <Badge tone="amber">Pending</Badge>
                            )}
                          </td>
                          <td>
                            {inv.paidAt ? (
                              <button className="btn-sm" disabled={busy} onClick={() => void reopen(inv)}>Reopen</button>
                            ) : (
                              <button className="btn-sm" disabled={busy} onClick={() => { setPaidDate(todayIso); setPayFor(inv); }}>Mark paid</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Modal
            open={payFor !== null}
            onClose={() => setPayFor(null)}
            title="Mark invoice paid"
            footer={
              <>
                <button className="btn-ghost" onClick={() => setPayFor(null)}>Cancel</button>
                <button className="btn-green" disabled={busy} onClick={() => void submitPaid()}>
                  {busy ? 'Saving…' : 'Mark paid'}
                </button>
              </>
            }
          >
            {payFor && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Recording payment for <strong>{payFor.customerId}</strong> ({money(payFor.totalTransaction, payFor.currencyTransaction)}).
                </p>
                <label>
                  Payment received on
                  <input type="date" max={todayIso} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                </label>
              </>
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
