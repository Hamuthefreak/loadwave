import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { money, shortDate } from '../utils/format';

interface PayLine {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  miles: number | null;
  basis: string;
  detentionBasis: string | null;
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

interface SelfView {
  period: { from: string; to: string; label: string };
  statement: PayStatement;
  yearToDate: PayStatement;
}

type PeriodKey = 'current' | 'ytd';

/**
 * "What am I on track for this week?" is the question every driver asks
 * dispatch, and the honest answer is a number with its arithmetic attached.
 * This shows the pay, how each load was priced, and the year-to-date figure so
 * a driver can check it against their own tally instead of taking it on faith.
 */
export function PayCard() {
  const [period, setPeriod] = useState<PeriodKey>('current');
  const [view, setView] = useState<SelfView | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<SelfView>(`/api/settlements/me?period=${period}`));
    } catch {
      // A driver without a pay profile, or an older account, simply has no card.
      setView(null);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  // A fuel stop or a delivery changes the running total, so the card refreshes
  // with the rest of the dashboard rather than going stale behind it.
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('loadwave:trip-updated', refresh);
    return () => window.removeEventListener('loadwave:trip-updated', refresh);
  }, [load]);

  if (!view) return null;
  const s = period === 'current' ? view.statement : view.yearToDate;
  const rpm = s.totals.effectivePayPerMileCents;
  const shown = expanded ? s.lines : s.lines.slice(0, 3);
  const isOwnerOperator = s.payLabel.toLowerCase().includes('owner-operator');

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
    </div>
  );
}
