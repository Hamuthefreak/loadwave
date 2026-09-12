import { useCallback, useEffect, useState } from 'react';
import { api, getTokenUser } from '../api';
import { Spinner } from './ui';
// The feature names and the payload shape live with the plan-lock rules, so the
// card, the board's locked tabs and the API cannot describe entitlements
// differently.
import { featureLabel, type PlanOverview } from '../utils/planLock';
import { writePlanCache } from '../utils/planCache';

/**
 * The plan a tenant is on, what they can actually use, and how to move up.
 *
 * Deliberately blunt about the upgrade being reviewed by Loadwave rather than
 * charged instantly — a button that silently does nothing would be worse than
 * no button, and the pending state is real once it is submitted.
 */
export function PlanCard() {
  const [data, setData] = useState<PlanOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api<PlanOverview>('/api/billing/plan');
      setData(next);
      const tenantId = getTokenUser()?.tenantId;
      if (tenantId) writePlanCache(tenantId, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your plan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async (plan: string) => {
    if (busy) return;
    setBusy(plan);
    setError(null);
    setNotice(null);
    try {
      const next = await api<PlanOverview>('/api/billing/plan', { method: 'POST', body: { plan } });
      setData(next);
      setNotice(
        `Requested the ${plan} plan. Loadwave will activate it once payment is arranged — the tools unlock the moment it does.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that request');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <section className="panel settings-card"><Spinner /></section>;
  if (!data) {
    return (
      <section className="panel settings-card">
        <h3>Plan & trial</h3>
        {error && <div className="alert alert-error">{error}</div>}
      </section>
    );
  }

  const { state, locked, catalog, pendingRequest } = data;
  const payingPlans = catalog.filter((c) => c.priceMonthly > 0);
  // The largest plan defines the full catalogue — not the free tier, which
  // would read as "11 of 6 included" during a trial.
  const totalFeatures = Math.max(state.features.length, ...catalog.map((c) => c.features.length));

  return (
    <section className="panel settings-card">
      <h3>
        Plan & trial{' '}
        {state.onTrial ? (
          <span className="badge badge-amber">Trial</span>
        ) : state.trialExpired ? (
          <span className="badge badge-muted">Free</span>
        ) : (
          <span className="badge badge-green">{state.effectivePlan}</span>
        )}
      </h3>

      <div className="plan-summary">
        <div className="detail-row">
          <dt>Current plan</dt>
          <dd>{state.onTrial ? `Trial — full product` : state.effectivePlan}</dd>
        </div>
        <div className="detail-row">
          <dt>{state.onTrial ? 'Trial ends' : 'Status'}</dt>
          <dd>
            {state.onTrial && state.trialEndsAt
              ? `${new Date(state.trialEndsAt).toLocaleDateString()} · ${state.trialDaysLeft} day${
                  state.trialDaysLeft === 1 ? '' : 's'
                } left`
              : state.note}
          </dd>
        </div>
        <div className="detail-row">
          <dt>Included features</dt>
          <dd>
            {state.features.length} of {totalFeatures}
          </dd>
        </div>
      </div>

      {locked.length > 0 && (
        <div className="plan-locked">
          <span className="muted small">Not in your plan yet</span>
          <ul>
            {locked.map((f) => (
              <li key={f}>
                <span className="plan-lock-icon" aria-hidden>
                  🔒
                </span>{' '}
                {featureLabel(f)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingRequest ? (
        <div className="alert alert-info">
          Pending: your request for the <b>{pendingRequest.requestedPlan}</b> plan is with Loadwave. Nothing changes
          until it is approved.
        </div>
      ) : (
        <>
          <div className="plan-actions">
            {payingPlans.map((p) => {
              const current = state.plan === p.plan && !state.trialExpired;
              return (
                <button
                  key={p.plan}
                  type="button"
                  className={p.plan === 'PRO' ? 'btn-primary' : 'btn-ghost'}
                  disabled={busy !== null || current}
                  onClick={() => void request(p.plan)}
                >
                  {busy === p.plan ? 'Sending…' : current ? `On ${p.name}` : `Request ${p.name} · $${p.priceMonthly}/mo`}
                </button>
              );
            })}
          </div>
          <p className="muted small">
            {state.onTrial
              ? `Your trial ends in ${state.trialDaysLeft} day${
                  state.trialDaysLeft === 1 ? '' : 's'
                }. When it does, the locked tools above switch off — the load board, booking and fuel logging stay free.`
              : 'Upgrades are activated by Loadwave once payment is arranged. Card payment is coming; until then nothing is charged from this page.'}
          </p>
        </>
      )}

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </section>
  );
}
