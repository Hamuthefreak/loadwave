import { useCallback, useEffect, useState } from 'react';
import { api, fetchFile, saveBlob } from '../../api';
import { Badge, Empty, Modal, PageHeader, Spinner, Stat } from '../../components/ui';
import { SignaturePad } from '../../components/SignaturePad';
import { money, shortDate } from '../../utils/format';

interface PayQuery {
  id: string;
  reference: string;
  driverId: string;
  driverName: string;
  loadId: string | null;
  subject: 'LINE' | 'DETENTION';
  status: 'OPEN' | 'RESOLVED' | 'DECLINED';
  message: string;
  periodLabel: string;
  line: { reference: string; lane: string; deliveredAt: string };
  disputedCents: number;
  summary: string;
  currentCents: number | null;
  /** The figure moved since the query was raised — often because it was fixed. */
  lineChanged: boolean;
  resolution: string | null;
  decidedAt: string | null;
  createdAt: string;
  ageDays: number;
}

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
  /** Present on the fleet view: whether the driver has signed this period off. */
  signedAt?: string | null;
  signedBy?: string | null;
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
  // Driver pay queries: the office reads them with the load and the arithmetic.
  const [queries, setQueries] = useState<PayQuery[]>([]);
  const [openQueries, setOpenQueries] = useState(0);
  const [answering, setAnswering] = useState<PayQuery | null>(null);
  const [decision, setDecision] = useState<'RESOLVED' | 'DECLINED'>('RESOLVED');
  const [answerText, setAnswerText] = useState('');
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showAnswered, setShowAnswered] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [signFor, setSignFor] = useState<Statement | null>(null);

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

  const loadQueries = useCallback(async () => {
    try {
      const res = await api<{ open: number; disputes: PayQuery[] }>('/api/settlements/disputes');
      setQueries(res.disputes);
      setOpenQueries(res.open);
    } catch {
      setQueries([]);
      setOpenQueries(0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadQueries();
  }, [loadQueries]);

  const answer = async (q: PayQuery) => {
    if (answerBusy) return;
    if (answerText.trim().length < 8) {
      setAnswerError('Say something the driver can use — at least a short sentence.');
      return;
    }
    setAnswerBusy(true);
    setAnswerError(null);
    try {
      await api(`/api/settlements/disputes/${q.id}`, {
        method: 'PATCH',
        body: { status: decision, resolution: answerText },
      });
      setAnswering(null);
      setAnswerText('');
      setNotice(
        decision === 'RESOLVED'
          ? 'Answer sent — the driver sees it on their pay card.'
          : 'Query declined with your reason — the driver sees it on their pay card.',
      );
      await Promise.all([loadQueries(), load()]);
      window.setTimeout(() => setNotice(null), 5000);
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : 'Could not save that answer');
    } finally {
      setAnswerBusy(false);
    }
  };

  const downloadStatement = async (s: Statement) => {
    if (pdfBusy) return;
    setPdfBusy(s.driverId);
    try {
      const file = await fetchFile(
        `/api/settlements/drivers/${s.driverId}/statement.pdf?period=${period}`,
      );
      saveBlob(file.blob, file.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build that statement');
    } finally {
      setPdfBusy(null);
    }
  };

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
  // Open queries are the work; answered ones are only shown on request.
  const visibleQueries = showAnswered ? queries : queries.filter((q) => q.status === 'OPEN');

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
          <Stat
            label="Driver queries"
            value={openQueries}
            sub={openQueries > 0 ? 'Waiting on an answer' : 'Nothing outstanding'}
            tone={openQueries > 0 ? 'amber' : 'green'}
          />
        </div>
      )}

      {data && data.period && (
        <p className="muted small settle-period">
          {data.period.label} · Monday to Sunday in each driver&rsquo;s home terminal timezone
        </p>
      )}

      {visibleQueries.length > 0 && (
        <section className="card query-inbox">
          <div className="query-inbox-head">
            <div>
              <h3 style={{ marginBottom: 2 }}>Pay queries from drivers</h3>
              <span className="muted small">
                Each one carries the load and the arithmetic the driver was looking at.
              </span>
            </div>
            <button className="link-btn" onClick={() => setShowAnswered(!showAnswered)}>
              {showAnswered ? 'Hide answered' : `Show answered (${queries.length - openQueries})`}
            </button>
          </div>
          <ul className="query-list">
            {visibleQueries.map((q) => (
              <li className={`query-row ${q.status === 'OPEN' ? '' : 'query-row-done'}`} key={q.id}>
                <div className="query-row-main">
                  <div className="query-row-title">
                    <strong>{q.driverName}</strong>
                    <span className="badge badge-gray">{q.reference}</span>
                    <Badge tone={q.status === 'OPEN' ? 'amber' : q.status === 'RESOLVED' ? 'green' : 'gray'}>
                      {q.status === 'OPEN' ? `open ${q.ageDays === 0 ? 'today' : `${q.ageDays}d`}` : q.status.toLowerCase()}
                    </Badge>
                    {/* The statement re-prices on read, so say when the number has
                        moved since the driver objected to it. */}
                    {q.lineChanged && (
                      <Badge tone="cyan">
                        was {dollars(q.disputedCents)} · now {q.currentCents == null ? 'gone' : dollars(q.currentCents)}
                      </Badge>
                    )}
                  </div>
                  <span className="muted small">
                    {q.subject === 'DETENTION' ? 'Detention · ' : ''}
                    {q.summary}
                  </span>
                  <span className="muted small">“{q.message}”</span>
                  {q.resolution && <span className="muted small">Answered: {q.resolution}</span>}
                </div>
                {q.status === 'OPEN' && (
                  <button
                    className="btn-sm"
                    onClick={() => {
                      setAnswering(q);
                      setDecision('RESOLVED');
                      setAnswerText('');
                      setAnswerError(null);
                    }}
                  >
                    Answer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
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
                  <span className="settle-signoff">
                    {s.signedAt ? (
                      <Badge tone="green">Signed {shortDate(s.signedAt)}</Badge>
                    ) : (
                      <Badge tone="gray">Not signed</Badge>
                    )}
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
                  <button
                    className="btn-ghost sm"
                    disabled={pdfBusy === s.driverId}
                    title="The statement as a PDF, for payroll or to hand to the driver"
                    onClick={() => void downloadStatement(s)}
                  >
                    {pdfBusy === s.driverId ? 'Building…' : 'Statement PDF'}
                  </button>
                  <button className="btn-ghost sm" onClick={() => setSignFor(s)}>
                    {s.signedAt ? 'Re-sign' : 'Sign'}
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

      <Modal
        open={answering !== null}
        onClose={() => setAnswering(null)}
        title={answering ? `Answer ${answering.driverName}'s query` : 'Answer the query'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setAnswering(null)} disabled={answerBusy}>
              Cancel
            </button>
            <button
              className={decision === 'DECLINED' ? 'btn-ghost' : 'btn-green'}
              disabled={answerBusy}
              onClick={() => answering && void answer(answering)}
            >
              {answerBusy ? 'Sending…' : decision === 'RESOLVED' ? 'Send the answer' : 'Decline the query'}
            </button>
          </>
        }
      >
        {answering && (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              {answering.reference} · {answering.periodLabel} · {answering.summary}
            </p>
            <div className="query-context">
              <span className="muted small">The driver says: “{answering.message}”</span>
              {answering.lineChanged && (
                <span className="muted small">
                  This figure has moved since the query was raised: {dollars(answering.disputedCents)} then,{' '}
                  {answering.currentCents == null ? 'gone from the statement now' : `${dollars(answering.currentCents)} now`}.
                  Correcting the load re-priced the week, so re-check before answering.
                </span>
              )}
            </div>
            <div className="form-grid">
              <label>
                Outcome
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as 'RESOLVED' | 'DECLINED')}
                >
                  <option value="RESOLVED">Resolved — the driver was right, or it is now fixed</option>
                  <option value="DECLINED">Declined — the pay is correct as shown</option>
                </select>
              </label>
            </div>
            <label>
              What you found
              <textarea
                rows={4}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                maxLength={1000}
                placeholder="e.g. The ELD shows 3.2 h at the dock; the timer was stopped early. Corrected and re-priced in this week's statement."
              />
            </label>
            <p className="muted small">
              The answer goes to the driver's own pay card and their bell. Because the statement is derived, the honest fix is
              usually to correct the load or the detention entry rather than to adjust a number here.
            </p>
            {answerError && <div className="alert alert-error">{answerError}</div>}
          </>
        )}
      </Modal>

      <SignaturePad
        open={signFor !== null}
        endpoint={signFor ? `/api/settlements/drivers/${signFor.driverId}/signature` : undefined}
        extraBody={{ role: 'DRIVER', period }}
        roles={[
          { value: 'DRIVER', label: 'Driver — signed at the yard' },
          { value: 'CARRIER', label: 'Carrier — signed on the driver’s behalf' },
        ]}
        defaultRole="DRIVER"
        title={signFor ? `Sign ${signFor.driverName}'s statement` : 'Sign the statement'}
        hint={
          signFor
            ? `This puts ${signFor.driverName}'s signature on the ${signFor.period.label} statement, next to the loads and total of ${dollars(
                signFor.totals.totalPayCents,
              )}. The driver can also sign it from their own pay card.`
            : undefined
        }
        onClose={() => setSignFor(null)}
        onSigned={() => {
          setNotice('Signature captured — it is printed on that period\u2019s statement PDF.');
          void load();
          window.setTimeout(() => setNotice(null), 5000);
        }}
      />
    </div>
  );
}
