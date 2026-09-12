/**
 * Plan-lock decisions for the UI — pure, no React, no fetch, no clock.
 *
 * The API is the source of truth for entitlements (it returns 402 for a tool a
 * plan does not include). This module only decides whether to *draw* an upgrade
 * wall, so the screens and the API cannot disagree about which plan a customer
 * is on. Unit-tested in tests/unit/plan-lock.test.ts.
 */

/** Mirrors the API's entitlement catalog — see src/modules/billing/plan.policy.ts. */
export const FEATURE_KEYS = [
  'board',
  'book',
  'trucks',
  'network',
  'rates',
  'compare',
  'route',
  'invoicing',
  'fuel',
  'ifta',
  'mobile',
] as const;

export const FEATURE_LABELS: Record<string, string> = {
  board: 'Live load board',
  book: 'One-tap load booking',
  trucks: 'Post capacity / trucks',
  network: 'Private network loads',
  rates: 'Rate insights & market maps',
  compare: 'Load comparison tool',
  route: 'Route & trip planning',
  invoicing: 'Invoicing with GST/HST/QST',
  fuel: 'Fuel logging',
  ifta: 'IFTA quarterly summaries',
  mobile: 'Mobile app (phone + tablet)',
};

export interface PlanCatalogEntry {
  plan: string;
  name: string;
  priceMonthly: number;
  features: string[];
  featureLabels: string[];
}

export interface PlanOverview {
  plan: string;
  state: {
    plan: string;
    effectivePlan: string;
    onTrial: boolean;
    trialEndsAt: string | null;
    trialDaysLeft: number | null;
    trialExpired: boolean;
    features: string[];
    note: string;
  };
  locked: string[];
  catalog: PlanCatalogEntry[];
  trialDays: number;
  pendingRequest: { id: string; requestedPlan: string; status: string; createdAt: string } | null;
  activation: 'SELF_SERVE' | 'MANUAL';
}

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

/**
 * Whether this feature should be walled off for this tenant.
 *
 * Fails OPEN. While the plan is unknown — still loading, or the request failed
 * — nothing is locked. Briefly letting a free account tap a tool the API will
 * refuse with a friendly 402 is a far better failure than showing an upgrade
 * wall to a customer who has already paid.
 */
export function featureLocked(overview: PlanOverview | null | undefined, feature: string): boolean {
  if (!overview) return false;
  // An unrecognised key would otherwise read as "not granted" and wall off a
  // tool nobody gated. Only the catalog's own keys may lock.
  if (!(FEATURE_KEYS as readonly string[]).includes(feature)) return false;

  const granted = overview.state?.features;
  if (Array.isArray(granted) && granted.length > 0) return !granted.includes(feature);

  return Array.isArray(overview.locked) && overview.locked.includes(feature);
}

/** Cheapest plan that includes a feature — what an upgrade prompt should name. */
export function unlockPlanName(
  overview: PlanOverview | null | undefined,
  feature: string,
): string | null {
  const catalog = overview?.catalog;
  if (!Array.isArray(catalog)) return null;
  const candidates = catalog
    .filter((entry) => Array.isArray(entry.features) && entry.features.includes(feature))
    .sort((a, b) => a.priceMonthly - b.priceMonthly);
  return candidates[0]?.name ?? null;
}

/** One-line description of where the account stands, for upgrade copy. */
export function planSummary(overview: PlanOverview | null | undefined): string {
  const state = overview?.state;
  if (!state) return 'Your account';
  if (state.onTrial && state.trialDaysLeft != null) {
    const days = state.trialDaysLeft;
    return `Your ${state.effectivePlan} trial (${days} day${days === 1 ? '' : 's'} left)`;
  }
  if (state.trialExpired) return 'The free Solo plan';
  const name =
    overview?.catalog?.find((entry) => entry.plan === state.effectivePlan)?.name ??
    state.effectivePlan;
  return `The ${name} plan`;
}
