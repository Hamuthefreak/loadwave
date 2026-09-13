import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fetchFile, saveBlob } from '../api';
import { money, shortDate } from '../utils/format';
import { shortBy, tooShort } from '../utils/text';
import { Modal } from './ui';
import { SignaturePad } from './SignaturePad';

interface PayLine {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  basis: string;
  detentionBasis: string | null;
  detentionHours: number;
  detentionCents: number;
  totalCents: number;
  priced: boolean;
}

interface PayStatement {
  driverId: string;
  driverName: string;
  period: { from: string; to: string; label: string };
  payLabel: string;
  lines: PayLine[];
  totals: {
    loads: number;
    unpricedLoads: number;
    miles: number;
    detentionHours: number;
    revenueCents: number;
    totalPayCents: number;
    effectivePayPerMileCents: number | null;
  };
  notes: string[];
}

interface PayQuery {
  id: string;
  reference: string;
  loadId: string | null;
  subject: 'LINE' | 'DETENTION';
  status: 'OPEN' | 'RESOLVED' | 'DECLINED';
  message: string;
  summary: string;
  resolution: string | null;
  periodLabel: string;
  createdAt: string;
}

interface SelfView {
  period: { from: string; to: string; label: string };
  statement: PayStatement;
  yearToDate: PayStatement;
  signature: { signerName: string; signedAt: string; role: string } | null;
  openQueries: number;
}

type PeriodKey = 'current' | 'ytd';

/** Mirrors DISPUTE_MESSAGE_MIN in the pay-query policy — keep the two in step. */
const MIN_QUERY_MESSAGE = 12;

const STATUS_TONE: Record<PayQuery['status'], string> = {
  OPEN: 'badge-amber',
  RESOLVED: 'badge-green',
  DECLINED: 'badge-gray',
};

function statusWord(status: PayQuery['status']): string {
  if (status === 'OPEN') return 'with dispatch';
  if (status === 'RESOLVED') return 'answered';
  return 'declined';
}

/**
 * "What am I on track for this week?" is the question every driver asks
 * dispatch, and the honest answer is a number with its arithmetic attached.
 * This shows the pay, how each load was priced, and the year-to-date figure so
 * a driver can check it against their own tally instead of taking it on faith.
 *
 * When a line does not add up, the driver can question it from here: the query
 * carries the load and the arithmetic it was raised against, so the office is
 * answering the actual number rather than asking them to describe it again on
 * the phone. The same screen hands them the statement as a PDF and takes their
 * signature on it.
 */
export function PayCard() {
  const [period, setPeriod] = useState<PeriodKey>('current');
  const [view, setView] = useState<SelfView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [queries, setQueries] = useState<PayQuery[]>([]);
  const [queryFor, setQueryFor] = useState<PayLine | null>(null);
  const [querySubject, setQuerySubject] = useState<'LINE' | 'DETENTION'>('LINE');
  const [queryMessage, setQueryMessage] = useState('');
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<SelfView>(`/api/settlements/me?period=${period}`));
    } catch {
      // A driver without a pay profile, or an older account, simply has no card.
      setView(null);
    }
  }, [period]);

  const loadQueries = useCallback(async () => {
    try {
      setQueries(await api<PayQuery[]>('/api/settlements/disputes/mine'));
    } catch {
      setQueries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadQueries();
  }, [loadQueries]);

  // A fuel stop or a delivery changes the running total, so the card refreshes
  // with the rest of the dashboard rather than going stale behind it.
  useEffect(() => {
    const refresh = () => {
      void load();
      void loadQueries();
    };
    window.addEventListener('loadwave:trip-updated', refresh);
    return () => window.removeEventListener('loadwave:trip-updated', refresh);
  }, [load, loadQueries]);

  const openQuery = (line: PayLine, subject: 'LINE' | 'DETENTION') => {
    setQueryFor(line);
    setQuerySubject(subject);
    setQueryMessage('');
    setQueryError(null);
  };

  const sendQuery = async () => {
    if (!queryFor || queryBusy) return;
    if (tooShort(queryMessage, MIN_QUERY_MESSAGE)) {
      setQueryError('Add a little more detail — enough for the office to act on.');
      return;
    }
    setQueryBusy(true);
    setQueryError(null);
    try {
      await api('/api/settlements/disputes', {
        method: 'POST',
        body: { loadId: queryFor.loadId, subject: querySubject, message: queryMessage, period },
      });
      setQueryFor(null);
      setNotice('Sent to dispatch — they see the load and the arithmetic you are asking about.');
      await Promise.all([load(), loadQueries()]);
      window.setTimeout(() => setNotice(null), 5000);
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : 'Could not send that query');
    } finally {
      setQueryBusy(false);
    }
  };

  const downloadStatement = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const file = await fetchFile(`/api/settlements/me/statement.pdf?period=${period}`);
      saveBlob(file.blob, file.fileName);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not build the statement');
    } finally {
      setPdfBusy(false);
    }
  };

  if (!view) return null;
  const s = period === 'current' ? view.statement : view.yearToDate;
  const rpm = s.totals.effectivePayPerMileCents;
  const shown = expanded ? s.lines : s.lines.slice(0, 3);
  const isOwnerOperator = s.payLabel.toLowerCase().includes('owner-operator');
  // Queries belong to the week they were raised against; the year view is a
  // running total with no lines of its own to question.
  const periodQueries = queries.filter((q) => q.periodLabel === s.period.label);
  const openCount = periodQueries.filter((q) => q.status === 'OPEN').length;
  const queryTooShort = tooShort(queryMessage, MIN_QUERY_MESSAGE);

  return (
    <div className="card pay-card">
      <div className="hos-head">
        <div>
          <h3 style={{ marginBottom: 2 }}>Your pay</h3>
          <span className="muted small">{s.period.label}</span>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Pay period">
          <button
            role="tab"
            aria-selected={period === 'current'}
            className={period === 'current' ? 'active' : ''}
            onClick={() => setPeriod('current')}
          >
            This week
          </button>
          <button
            role="tab"
            aria-selected={period === 'ytd'}
            className={period === 'ytd' ? 'active' : ''}
            onClick={() => setPeriod('ytd')}
          >
            Year
          </button>
        </div>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="pay-figure">
        <span className="pay-amount">{money(s.totals.totalPayCents / 100)}</span>
        <span className="muted small">{s.payLabel}</span>
      </div>

      <div className="pay-facts">
        <span>
          <strong>{s.totals.loads}</strong> load{s.totals.loads === 1 ? '' : 's'}
        </span>
        <span>
          <strong>{s.totals.miles.toFixed(0)}</strong> mi
        </span>
        <span>
          <strong>{rpm == null ? '—' : `${rpm}¢`}</strong> per mi
        </span>
        {s.totals.detentionHours > 0 && (
          <span>
            <strong>{s.totals.detentionHours.toFixed(1)} h</strong> detention
          </span>
        )}
      </div>

      {isOwnerOperator && (
        <p className="muted small" style={{ marginTop: 10 }}>
          You keep the load revenue, so there is no separate pay figure. Ask dispatch to set a pay
          profile if you would like it tracked here.
        </p>
      )}

      {s.notes.length > 0 && (
        <ul className="settle-notes">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {s.lines.length > 0 && !isOwnerOperator && (
        <ul className="settle-lines">
          {shown.map((l) => (
            <li className="settle-line pay-line" key={l.loadId}>
              <div className="settle-line-main">
                <span className="settle-ref">{l.reference}</span>
                <span className="muted small">{l.lane}</span>
              </div>
              <div className="settle-line-basis">
                <span className={l.priced ? 'muted small' : 'settle-unpriced small'}>{l.basis}</span>
                <span className="muted small">{shortDate(l.deliveredAt)}</span>
                {/* Only offer what is actually on the line: there is no detention
                    figure to argue with on a load that never logged any. */}
                <span className="pay-line-actions">
                  <button className="link-btn" onClick={() => openQuery(l, 'LINE')}>
                    Miles or rate
                  </button>
                  {l.detentionHours > 0 && (
                    <button className="link-btn" onClick={() => openQuery(l, 'DETENTION')}>
                      Detention
                    </button>
                  )}
                </span>
              </div>
              <span className="settle-line-amount">{money(l.totalCents / 100)}</span>
            </li>
          ))}
        </ul>
      )}

      {s.lines.length > 3 && (
        <button className="link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${s.lines.length} loads`}
        </button>
      )}

      {period === 'current' && view.yearToDate.totals.totalPayCents > 0 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {money(view.yearToDate.totals.totalPayCents / 100)} earned year to date.
        </p>
      )}

      {periodQueries.length > 0 && (
        <div className="pay-queries">
          <span className="muted small pay-queries-head">
            {openCount > 0
              ? `${openCount} question${openCount === 1 ? '' : 's'} with dispatch`
              : 'Your questions to dispatch'}
          </span>
          <ul className="settle-lines">
            {periodQueries.slice(0, 4).map((q) => (
              <li className="settle-line pay-line" key={q.id}>
                <div className="settle-line-main">
                  <span className="settle-ref">{q.reference}</span>
                  <span className={`badge ${STATUS_TONE[q.status]}`}>{statusWord(q.status)}</span>
                </div>
                <div className="settle-line-basis">
                  <span className="muted small">{q.summary}</span>
                  <span className="muted small">“{q.message}”</span>
                  {q.resolution && <span className="muted small">Dispatch: {q.resolution}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pay-docs">
        <button className="btn-ghost sm" disabled={pdfBusy} onClick={() => void downloadStatement()}>
          {pdfBusy ? 'Building…' : 'Statement PDF'}
        </button>
        {view.signature ? (
          <span className="muted small">
            Signed {shortDate(view.signature.signedAt)} as {view.signature.signerName}
          </span>
        ) : (
          <button className="btn-sm" onClick={() => setSignOpen(true)}>
            Sign this statement
          </button>
        )}
      </div>

      <Modal
        open={queryFor !== null}
        onClose={() => setQueryFor(null)}
        title="Ask dispatch about this line"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setQueryFor(null)} disabled={queryBusy}>
              Cancel
            </button>
            <button
              className="btn-green"
              onClick={() => void sendQuery()}
              disabled={queryBusy || queryTooShort}
              title={queryTooShort ? 'Say enough for the office to act on' : undefined}
            >
              {queryBusy ? 'Sending…' : 'Send to dispatch'}
            </button>
          </>
        }
      >
        {queryFor && (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              {queryFor.reference} · {queryFor.lane} · {shortDate(queryFor.deliveredAt)}
            </p>
            <div className="form-grid">
              <label>
                What looks wrong
                <select
                  value={querySubject}
                  onChange={(e) => setQuerySubject(e.target.value as 'LINE' | 'DETENTION')}
                >
                  <option value="LINE">The miles or the rate — {queryFor.basis}</option>
                  {queryFor.detentionHours > 0 && (
                    <option value="DETENTION">
                      The detention time — {queryFor.detentionBasis ?? `${queryFor.detentionHours.toFixed(1)} h`}
                    </option>
                  )}
                </select>
              </label>
            </div>
            <label>
              What happened
              <textarea
                rows={4}
                value={queryMessage}
                onChange={(e) => setQueryMessage(e.target.value)}
                placeholder="e.g. I sat at the dock from 08:00 to 11:00 and the timer only shows 45 minutes."
                maxLength={1000}
              />
            </label>
            <p className="muted small">
              Dispatch sees this line, the working and the amount you were shown — you do not have to
              describe it again.
            </p>
            {/* The button says why it is off rather than waiting for a tap that
                does nothing: a driver typing one-handed gets no tooltip. */}
            {queryTooShort && (
              <p className="muted small">
                {queryMessage.trim().length === 0
                  ? 'Tell dispatch what happened before sending.'
                  : `${shortBy(queryMessage, MIN_QUERY_MESSAGE)} more character${
                      shortBy(queryMessage, MIN_QUERY_MESSAGE) === 1 ? '' : 's'
                    } to send.`}
              </p>
            )}
            {queryError && <div className="alert alert-error">{queryError}</div>}
          </>
        )}
      </Modal>

      <SignaturePad
        open={signOpen}
        endpoint={`/api/settlements/drivers/${s.driverId}/signature`}
        extraBody={{ role: 'DRIVER', period }}
        roles={[{ value: 'DRIVER', label: 'Driver — I drove these loads' }]}
        defaultRole="DRIVER"
        title="Sign your statement"
        hint={`Signing confirms the loads, miles and total pay of ${money(
          s.totals.totalPayCents / 100,
        )} for ${s.period.label}. Anything you have queried is printed on the statement as still open.`}
        onClose={() => setSignOpen(false)}
        onSigned={() => {
          setNotice('Signature saved — it is on your statement PDF.');
          void load();
          window.setTimeout(() => setNotice(null), 5000);
        }}
      />
    </div>
  );
}
