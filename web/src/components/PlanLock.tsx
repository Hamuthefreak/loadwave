import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Spinner } from './ui';
import { usePlan } from '../utils/plan';
import { featureLabel, featureLocked, planSummary, unlockPlanName, type PlanOverview } from '../utils/planLock';

/**
 * The upgrade wall a locked tool shows instead of failing.
 *
 * A plan-gated endpoint answers 402 with a good message, but an error banner is
 * a poor way to explain a plan: this says which tool, which plan unlocks it,
 * and what the current plan keeps — and it is drawn *before* the request, so a
 * free account never fires a call it knows will be refused.
 *
 * Activation is manual until a payment provider exists, so the copy says the
 * request is reviewed rather than implying a card will be charged.
 */
export function UpgradeWall({
  feature,
  overview,
}: {
  feature: string;
  overview: PlanOverview | null;
}) {
  const label = featureLabel(feature);
  const planName = unlockPlanName(overview, feature);
  const manual = overview?.activation !== 'SELF_SERVE';

  // The feature label is used verbatim: lowercasing it mangles acronyms
  // ("GST/HST/QST" became "gst/hst/qst", "IFTA" became "ifta").
  const path = planName ? `${planName} unlocks ${label}.` : 'A paid plan unlocks this.';
  const nextStep = manual
    ? 'Upgrades are reviewed by Loadwave — request one and it is switched on for you.'
    : 'Upgrade and it is available immediately.';

  return (
    <Empty
      title={`${label} isn’t in your current plan`}
      sub={`${planSummary(overview)} keeps the board, booking, trucks, fuel and IFTA. ${path} ${nextStep}`}
      action={
        <Link className="btn-primary" to="/app/billing">
          See plans &amp; request an upgrade
        </Link>
      }
    />
  );
}

/**
 * Renders children only when the tenant's plan includes `feature`, and an
 * upgrade wall otherwise. While the plan is still loading it shows a spinner
 * rather than guessing, so a paying customer never sees the wall flicker.
 */
export function PlanLock({ feature, children }: { feature: string; children: ReactNode }) {
  const { plan, loading } = usePlan();

  if (loading && !plan) return <Spinner label="Checking your plan…" />;
  if (featureLocked(plan, feature)) return <UpgradeWall feature={feature} overview={plan} />;
  return <>{children}</>;
}
