import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Spinner } from './ui';
import { money } from '../utils/format';

/**
 * "This week is $400 more than usual — why?"
 *
 * The statement above answers what is owed; this answers what moved. Each driver
 * is measured against their own trailing weeks, the change is split into the
 * three things that cause it (more loads, differently paid loads, waiting time),
 * and the loads that moved it most are listed with the arithmetic behind each
 * one. Nothing here is a benchmark against other companies — a carrier's own
 * history is the only honest comparison until there is real market data.
 */

interface LoadShift {
  loadId: string;
  reference: string;
  lane: string;
  deliveredAt: string;
  payCents: number;
  basis: string;
  reason: string;
  direction: 'UP' | 'DOWN';
  headline: string;
  detail: string;
  impactCents: number;
  estimated: boolean;
  payPerMileCents: number | null;
  laneAveragePerMileCents: number | null;
}

interface DriverVariance {
  driverId: string;
  driverName: string;
  payLabel: string;
  current: {
    totalPayCents: number;
    payCents: number;
    detentionCents: number;
    loads: number;
    miles: number;
    unpricedLoads: number;
    payPerMileCents: number | null;
    payPerLoadCents: number | null;
  };
  basis: {
    weeks: number;
    activeWeeks: number;
    averageTotalPayCents: number;
    averageLoads: number;
    averageMiles: number;
    averagePayPerLoadCents: number | null;
    averagePayPerMileCents: number | null;
    averageDetentionCents: number;
    detentionPerHourCents: number | null;
  };
  components: {
    volumeCents: number;
    rateCents: number;
    detentionCents: number;
    totalCents: number;
  };
  percentChange: number | null;
  shifts: LoadShift[];
  shiftsOmitted: number;
}

interface VarianceReport {
  period: { from: string; to: string; label: string };
  weeks: number;
  drivers: DriverVariance[];
  totals: {
    currentPayCents: number;
    trailingAverageCents: number;
    changeCents: number;
    flaggedLoads: number;
    withoutBasis: number;
  };
  offPayroll: number;
  notes: string[];
}

const dollars = (cents: number): string => money(cents / 100);

/** Signed money, so a component is never mistaken for a total. */
function signed(cents: number): string {
  if (cents === 0) return '—';
  return `${cents > 0 ? '+' : '−'}${dollars(Math.abs(cents))}`;
}

function headlineOf(row: DriverVariance): string {
  if (row.current.loads === 0 && row.basis.activeWeeks === 0) return 'Nothing delivered this period';
  if (row.basis.activeWeeks === 0) return 'No trailing weeks to compare against yet';
  if (row.current.loads === 0) return 'No loads delivered this period';
  if (Math.abs(row.components.totalCents) < 1) return 'In line with the trailing weeks';
  const dir = row.components.totalCents > 0 ? 'above' : 'below';
  return `${signed(row.components.totalCents)} ${dir} the trailing ${row.basis.activeWeeks}-week average`;
}

const WEEK_OPTIONS = [4, 8];

export function VariancePanel({ period }: { period: 'current' | 'last' }) {
  const [weeks, setWeeks] = useState(4);
  const [data, setData] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<VarianceReport>(`/api/settlements/variance?period=${period}&weeks=${weeks}`));
      setFailed(false);
    } catch {
      // The report is an explanation, not the payroll itself: if the call fails
      // the statements below it still stand, so the section says so quietly
      // rather than taking the page down with an error banner.
      setFailed(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = data?.totals.changeCents ?? 0;
  const fleetTone = change > 0 ? 'amber' : change < 0 ? 'cyan' : 'gray';

  return (
    <section className="card variance-panel">
      <div className="variance-panel-head">
        <div>
          <h3 style={{ marginBottom: 2 }}>Why the period moved</h3>
          <span className="muted small">
            Each driver against their own trailing weeks, split into loads, rate and waiting time.
          </span>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Comparison window">
          {WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={weeks === w}
              className={weeks === w ? 'active' : ''}
              onClick={() => setWeeks(w)}
            >
              {w} wk
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Spinner label="Working out what changed…" />}

      {failed && !loading && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          The comparison could not be built just now. The statements below are unaffected.
        </p>
      )}

      {data && (
        <>
          <div className="variance-summary">
            <span className="muted small">
              Payroll this period <strong>{dollars(data.totals.currentPayCents)}</strong> against a
              trailing average of <strong>{dollars(data.totals.trailingAverageCents)}</strong>
            </span>
            <Badge tone={fleetTone}>{`${signed(change)} across ${data.drivers.length} driver${data.drivers.length === 1 ? '' : 's'}`}</Badge>
          </div>

          {data.notes.length > 0 && (
            <ul className="settle-notes">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {data.drivers.length === 0 ? (
            <Empty
              title="No payroll to compare"
              sub="Set how a driver is paid and their variance appears here — owner-operators keep their own revenue, so there is no wage to explain."
            />
          ) : (
            <div className="variance-list">
              {data.drivers.map((row) => {
                const isOpen = open === row.driverId;
                const up = row.components.totalCents > 0;
                const flagged = row.shifts.length + row.shiftsOmitted;
                // With no trailing work there is nothing to decompose: every cent
                // would land in "rate" simply because it is the residual, which
                // would read as a reason when it is only arithmetic.
                const hasBasis = row.basis.activeWeeks > 0;
                return (
                  <article className="variance-row" key={row.driverId}>
                    <header className="variance-row-head">
                      <div className="variance-row-who">
                        <strong>{row.driverName}</strong>
                        <span className="muted small">{headlineOf(row)}</span>
                        <span className="muted small">
                          {row.current.loads} load{row.current.loads === 1 ? '' : 's'} ·{' '}
                          {row.current.miles.toFixed(0)} mi
                          {row.basis.activeWeeks > 0 && (
                            <>
                              {' '}
                              · averaged over {row.basis.activeWeeks} of {row.basis.weeks} weeks
                            </>
                          )}
                        </span>
                      </div>
                      <div className="variance-row-amount">
                        {hasBasis ? (
                          <span
                            className={`variance-delta ${up ? 'variance-up' : row.components.totalCents < 0 ? 'variance-down' : 'muted'}`}
                          >
                            {row.components.totalCents === 0 ? '—' : signed(row.components.totalCents)}
                          </span>
                        ) : (
                          // A figure, not a change: there is no earlier week for it
                          // to be up or down against.
                          <span className="variance-delta muted">
                            {dollars(row.current.totalPayCents)}
                          </span>
                        )}
                        {hasBasis && row.percentChange != null && Math.abs(row.components.totalCents) >= 1 && (
                          <span className="muted small">{`${row.percentChange > 0 ? '+' : ''}${row.percentChange.toFixed(1)}%`}</span>
                        )}
                        {hasBasis && row.percentChange == null && (
                          <span className="muted small">basis too small for a %</span>
                        )}
                      </div>
                    </header>

                    {/* The three causes, always shown together: they sum to the
                        change above, so they are read as arithmetic rather than
                        as three independent observations. */}
                    {hasBasis ? (
                      <div className="variance-parts">
                        <span className="variance-part">
                          <em>Loads</em>
                          <b>{signed(row.components.volumeCents)}</b>
                        </span>
                        <span className="variance-part">
                          <em>Rate</em>
                          <b>{signed(row.components.rateCents)}</b>
                        </span>
                        <span className="variance-part">
                          <em>Waiting</em>
                          <b>{signed(row.components.detentionCents)}</b>
                        </span>
                      </div>
                    ) : (
                      <p className="muted small" style={{ margin: 0 }}>
                        Nothing earlier to measure this against, so the period stands on its own.
                      </p>
                    )}

                    {flagged > 0 ? (
                      <>
                        <button
                          className="link-btn"
                          onClick={() => setOpen(isOpen ? null : row.driverId)}
                        >
                          {isOpen
                            ? 'Hide the loads behind it'
                            : `Show the ${flagged} load${flagged === 1 ? '' : 's'} behind it`}
                        </button>
                        {isOpen && (
                          <ul className="variance-shifts">
                            {row.shifts.map((shift) => (
                              <li
                                className="variance-shift"
                                key={`${shift.loadId}:${shift.reason}`}
                              >
                                <div className="variance-shift-head">
                                  <span className="settle-ref">{shift.reference}</span>
                                  <span className="muted small">{shift.lane}</span>
                                  <Badge tone={shift.direction === 'UP' ? 'amber' : 'gray'}>
                                    {shift.direction === 'UP' ? 'more' : 'less'}{' '}
                                    {dollars(shift.impactCents)}
                                    {shift.estimated ? ' est.' : ''}
                                  </Badge>
                                </div>
                                <strong className="variance-shift-title">{shift.headline}</strong>
                                <span className="muted small">{shift.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {isOpen && row.shiftsOmitted > 0 && (
                          <p className="muted small" style={{ margin: '6px 0 0' }}>
                            {row.shiftsOmitted} smaller movement
                            {row.shiftsOmitted === 1 ? '' : 's'} on this period&rsquo;s loads are not
                            listed.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="muted small" style={{ margin: '6px 0 0' }}>
                        {hasBasis
                          ? 'No single load stands out against the trailing weeks.'
                          : 'Nothing here to compare load by load yet.'}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
