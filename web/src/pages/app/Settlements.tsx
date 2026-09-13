import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Empty, PageHeader, Spinner, Stat } from '../../components/ui';
import { money, shortDate } from '../../utils/format';

type PayModel = 'PER_MILE' | 'PERCENT_REVENUE' | 'FLAT_PER_LOAD';

interface StatementLine {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  revenueCents: number | null;
  basis: string;
  baseCents: number;
  detentionHours: number;
  detentionBasis: string | null;
  detentionCents: number;
  totalCents: number;
  priced: boolean;
}

interface StatementTotals {
  loads: number;
  unpricedLoads: number;
  miles: number;
  detentionHours: number;
  revenueCents: number;
  payCents: number;
  detentionCents: number;
  totalPayCents: number;
  marginCents: number;
  effectivePayPerMileCents: number | null;
}

interface Statement {
  driverId: string;
  driverName: string;
  period: { from: string; to: string; label: string };
  payModel: PayModel | null;
  payRate: number | null;
  payLabel: string;
  lines: StatementLine[];
  totals: StatementTotals;
  notes: string[];
}

interface Overview {
  period: { from: string; to: string; label: string };
  drivers: Statement[];
  totals: StatementTotals & { drivers: number; payableDrivers: number };
}

type PeriodKey = 'current' | 'last' | 'ytd';

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'current', label: 'This week' },
  { key: 'last', label: 'Last week' },
  { key: 'ytd', label: 'Year to date' },
];

const MODEL_LABEL: Record<PayModel, string> = {
  PER_MILE: 'Per mile ($/mi)',
  PERCENT_REVENUE: 'Share of revenue (%)',
  FLAT_PER_LOAD: 'Flat per load ($)',
};

const dollars = (cents: number): string => money(cents / 100);
const centsPerMile = (cents: number | null): string => (cents == null ? '—' : `${cents}¢/mi`);

export default function Settlements() {
  const [period, setPeriod] = useState<PeriodKey>('current');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Which driver's pay profile the inline editor is open for, and its draft.
  const [editingPay, setEditingPay] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<PayModel>('PER_MILE');
  const [draftRate, setDraftRate] = useState('0.58');
  const [savingPay, setSavingPay] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Overview>(`/api/settlements?period=${period}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settlements');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPay = (s: Statement) => {
    const model = s.payModel ?? 'PER_MILE';
    setEditingPay(s.driverId);
    setDraftModel(model);
    setDraftRate(s.payRate != null ? String(s.payRate) : model === 'PERCENT_REVENUE' ? '27' : '0.58');
  };

  const savePay = async (driverId: string) => {
    const rate = Number(draftRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter a pay rate of zero or more.');
      return;
    }
    setSavingPay(true);
    try {
      await api(`/api/drivers/${driverId}`, {
        method: 'PATCH',
        body: { payModel: draftModel, payRate: rate },
      });
      setEditingPay(null);
      setNotice('Pay profile saved — the period re-priced against it.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the pay profile');
    } finally {
      setSavingPay(false);
    }
  };

  const totals = data?.totals;

  return (
    <div className="page">
      <PageHeader
        title="Settlements"
        sub="What each driver earned, derived from the loads they delivered."
        actions={
          <div className="view-toggle" role="tablist" aria-label="Pay period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                role="tab"
                aria-selected={period === p.key}
                className={period === p.key ? 'active' : ''}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {loading && !data && <Spinner label="Working out the pay run…" />}

      {totals && (
        <div className="grid">
          <Stat
            label="Payable this period"
            value={dollars(totals.totalPayCents)}
            sub={`${totals.payableDrivers} of ${totals.drivers} drivers`}
            tone="green"
          />
          <Stat label="Loads settled" value={totals.loads} sub={`${totals.miles.toFixed(0)} mi driven`} />
          <Stat label="Detention" value={`${totals.detentionHours.toFixed(1)} h`} sub={dollars(totals.detentionCents)} />
          <Stat
            label="Revenue less pay"
            value={dollars(totals.marginCents)}
            sub={`of ${dollars(totals.revenueCents)} hauled`}
          />
        </div>
      )}

      {data && data.period && (
        <p className="muted small settle-period">
          {data.period.label} · Monday to Sunday in each driver&rsquo;s home terminal timezone
        </p>
      )}

      {data && data.drivers.length === 0 && (
        <Empty
          title="No drivers yet"
          sub="Add a driver, set how they are paid, and their statement builds itself from delivered loads."
        />
      )}

      <div className="settle-list">
        {(data?.drivers ?? []).map((s) => {
          const rpm = s.totals.effectivePayPerMileCents;
          const isOpen = expanded === s.driverId;
          return (
            <article className="card settle-card" key={s.driverId}>
              <header className="settle-head">
                <div className="settle-who">
                  <strong>{s.driverName}</strong>
                  <span className="muted small">{s.payLabel}</span>
                </div>
                <div className="settle-amount">
                  <span className="settle-total">{dollars(s.totals.totalPayCents)}</span>
                  <span className="muted small">
                    {s.totals.loads} load{s.totals.loads === 1 ? '' : 's'} · {s.totals.miles.toFixed(0)} mi
                    {/* For an owner-operator there is no pay per mile to quote — they
                        keep the revenue — so showing 0¢/mi would read as "earns nothing". */}
                    {s.payModel
                      ? ` · ${centsPerMile(rpm)}`
                      : ` · ${dollars(s.totals.revenueCents)} hauled`}
                  </span>
                </div>
              </header>

              {s.notes.length > 0 && (
                <ul className="settle-notes">
                  {s.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}

              {s.payModel && (
                <div className="settle-facts">
                  <Badge tone="gray">{s.payLabel}</Badge>
                  {s.totals.detentionHours > 0 && (
                    <span className="muted small">
                      {s.totals.detentionHours.toFixed(1)} h detention · {dollars(s.totals.detentionCents)}
                    </span>
                  )}
                  <button className="link-btn" onClick={() => setExpanded(isOpen ? null : s.driverId)}>
                    {isOpen ? 'Hide loads' : `Show ${s.lines.length} load${s.lines.length === 1 ? '' : 's'}`}
                  </button>
                  <button className="link-btn" onClick={() => (editingPay === s.driverId ? setEditingPay(null) : openPay(s))}>
                    Change pay
                  </button>
                </div>
              )}

              {!s.payModel && editingPay !== s.driverId && (
                <div className="settle-facts">
                  <span className="muted small">Set how this driver is paid to settle their loads.</span>
                  <button className="btn-ghost sm" onClick={() => openPay(s)}>
                    Set pay
                  </button>
                </div>
              )}

              {editingPay === s.driverId && (
                <div className="settle-pay-edit">
                  <label>
                    <span>How they are paid</span>
                    <select value={draftModel} onChange={(e) => setDraftModel(e.target.value as PayModel)}>
                      {(Object.keys(MODEL_LABEL) as PayModel[]).map((m) => (
                        <option key={m} value={m}>
                          {MODEL_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Rate</span>
                    <input
                      inputMode="decimal"
                      value={draftRate}
                      onChange={(e) => setDraftRate(e.target.value)}
                      placeholder={draftModel === 'PERCENT_REVENUE' ? '27' : draftModel === 'PER_MILE' ? '0.58' : '350'}
                    />
                  </label>
                  <div className="settle-pay-actions">
                    <button className="btn" disabled={savingPay} onClick={() => void savePay(s.driverId)}>
                      {savingPay ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn-ghost" onClick={() => setEditingPay(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isOpen && (
                <ul className="settle-lines">
                  {s.lines.length === 0 && <li className="muted small">Nothing delivered in this period.</li>}
                  {s.lines.map((l) => (
                    <li key={l.loadId} className="settle-line">
                      <div className="settle-line-main">
                        <span className="settle-ref">{l.reference}</span>
                        <span className="muted small">{l.lane}</span>
                        <span className="muted small">{shortDate(l.deliveredAt)}</span>
                      </div>
                      <div className="settle-line-basis">
                        <span className={l.priced ? 'muted small' : 'settle-unpriced small'}>{l.basis}</span>
                        {l.detentionCents > 0 && <span className="muted small">{l.detentionBasis}</span>}
                        {l.detentionCents === 0 && l.detentionBasis && (
                          <span className="settle-unpriced small">{l.detentionBasis}</span>
                        )}
                      </div>
                      <span className="settle-line-amount">{dollars(l.totalCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      {data && data.drivers.length > 0 && (
        <p className="muted small">
          Statements are recalculated from the loads on file every time this page opens, so correcting a delivery date or a
          rate re-prices the period rather than leaving a stale total behind.
        </p>
      )}
    </div>
  );
}
