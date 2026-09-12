/**
 * Plans and feature entitlements — pure functions, no database, no clock.
 *
 * The pricing page has always advertised tiers, a free trial and locked
 * features. This module is the thing that makes those claims true: one place
 * that decides what a tenant is actually entitled to at a given moment, so the
 * API and the UI cannot drift from the plans we sell.
 *
 * Feature keys mirror the pricing page's comparison table one-to-one. If a key
 * is added here the pricing page is the consumer that must be updated with it,
 * which is why the table lives in one obvious list below.
 */

export const PLANS = ['SOLO', 'PRO', 'FLEET'] as const;
export type Plan = (typeof PLANS)[number];
/** A tenant starts here: full product, time-boxed. */
export const TRIAL_PLAN = 'TRIAL';
export type PlanCode = Plan | typeof TRIAL_PLAN;

export const FEATURES = [
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
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
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

/**
 * The matrix the pricing page sells. Solo is deliberately narrow (it is the
 * free tier), Pro and Fleet are the full product — Fleet differs today by
 * seat count and support, which are not feature flags.
 */
export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = {
  SOLO: ['board', 'book', 'trucks', 'fuel', 'ifta', 'mobile'],
  PRO: FEATURES,
  FLEET: FEATURES,
};

export const PLAN_PRICES: Record<Plan, number> = { SOLO: 0, PRO: 49, FLEET: 149 };
export const PLAN_NAMES: Record<Plan, string> = {
  SOLO: 'Solo',
  PRO: 'Pro',
  FLEET: 'Fleet',
};

export const TRIAL_DAYS = 30;
/** How long an expired trial keeps working before premium features hard-lock. */
export const TRIAL_GRACE_DAYS = 0;

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

export function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}

export interface PlanStateInput {
  plan: string | null | undefined;
  trialEndsAt: Date | null | undefined;
  now: Date;
}

export interface PlanState {
  /** What the tenant is being billed for. */
  plan: PlanCode;
  /** What they can actually use right now. */
  effectivePlan: Plan;
  onTrial: boolean;
  trialEndsAt: Date | null;
  /** Whole days left in the trial; 0 once it has passed. Null when not on trial. */
  trialDaysLeft: number | null;
  trialExpired: boolean;
  features: readonly Feature[];
  /** Why the entitlement looks the way it does — shown in the UI. */
  note: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetweenCeil(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * An expired trial falls back to Solo rather than locking the account out
 * entirely: the board stays usable, the paid tools stop. Turning a lapsed
 * trial into a bricked login loses the customer we were trying to convert.
 */
export function planStateOf(input: PlanStateInput): PlanState {
  const declared = (input.plan ?? TRIAL_PLAN).toUpperCase();
  const trialEndsAt = input.trialEndsAt ?? null;

  if (declared === TRIAL_PLAN) {
    const onTrial = Boolean(trialEndsAt && trialEndsAt.getTime() > input.now.getTime());
    if (onTrial) {
      const end = trialEndsAt as Date;
      return {
        plan: TRIAL_PLAN,
        effectivePlan: 'PRO',
        onTrial: true,
        trialEndsAt: end,
        trialDaysLeft: daysBetweenCeil(input.now, end),
        trialExpired: false,
        features: FEATURES,
        note: `Trial — full product for ${daysBetweenCeil(input.now, end)} more day${
          daysBetweenCeil(input.now, end) === 1 ? '' : 's'
        }`,
      };
    }
    return {
      plan: TRIAL_PLAN,
      effectivePlan: 'SOLO',
      onTrial: false,
      trialEndsAt,
      trialDaysLeft: 0,
      trialExpired: true,
      features: PLAN_FEATURES.SOLO,
      note: trialEndsAt ? 'Trial ended — on the free Solo plan' : 'No trial on file — on the free Solo plan',
    };
  }

  const plan: Plan = isPlan(declared) ? declared : 'SOLO';
  return {
    plan,
    effectivePlan: plan,
    onTrial: false,
    trialEndsAt,
    trialDaysLeft: null,
    trialExpired: false,
    features: PLAN_FEATURES[plan],
    note: `On the ${PLAN_NAMES[plan]} plan`,
  };
}

export function hasFeature(state: PlanState, feature: Feature): boolean {
  return state.features.includes(feature);
}

/** Cheapest plan that includes a feature — what an upgrade prompt should name. */
export function cheapestPlanWith(feature: Feature): Plan | null {
  for (const plan of PLANS) {
    if (PLAN_FEATURES[plan].includes(feature)) return plan;
  }
  return null;
}

export const TRIAL_GRACE_MS = TRIAL_GRACE_DAYS * DAY_MS;

export function trialEndsAtFrom(now: Date, days: number = TRIAL_DAYS): Date {
  return new Date(now.getTime() + days * DAY_MS);
}
