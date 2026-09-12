/**
 * Plan locks in the UI.
 *
 * The API is the source of truth for entitlements, but the screen decides
 * whether to draw an upgrade wall — and getting that wrong cuts both ways: a
 * paying customer shown a wall is a support ticket, and a free account never
 * seeing one means the paid tier is indistinguishable from the free one. These
 * tests pin the decisions, including the fail-open rule that matters most.
 */
// The root tsc program (Node16 resolution) flags this CJS→ESM import as TS1479.
// ts-jest compiles it fine, so that diagnostic is ignored in jest.config.json —
// while `npm run typecheck` still enforces the directive is genuinely needed.
// Same pattern as tests/unit/authority-badge.test.ts.
// @ts-expect-error — cross-package ESM import from the web workspace
import { featureLocked, planSummary, unlockPlanName } from '../../web/src/utils/planLock';
// @ts-expect-error — same cross-package ESM import, type-only
import type { PlanOverview } from '../../web/src/utils/planLock';

const CATALOG = [
  {
    plan: 'SOLO',
    name: 'Solo',
    priceMonthly: 0,
    features: ['board', 'book', 'trucks', 'fuel', 'ifta', 'mobile'],
    featureLabels: [],
  },
  {
    plan: 'PRO',
    name: 'Pro',
    priceMonthly: 49,
    features: ['board', 'network', 'rates', 'compare', 'route', 'invoicing'],
    featureLabels: [],
  },
  {
    plan: 'FLEET',
    name: 'Fleet',
    priceMonthly: 149,
    features: ['board', 'network', 'rates', 'compare', 'route', 'invoicing'],
    featureLabels: [],
  },
];

const SOLO_FEATURES = ['board', 'book', 'trucks', 'fuel', 'ifta', 'mobile'];

type Overrides = Omit<Partial<PlanOverview>, 'state'> & { state?: Partial<PlanOverview['state']> };

function overview(over: Overrides = {}): PlanOverview {
  const { state: stateOver, ...rest } = over;
  return {
    plan: 'SOLO',
    locked: ['network', 'rates', 'compare', 'route', 'invoicing'],
    catalog: CATALOG,
    trialDays: 30,
    pendingRequest: null,
    activation: 'MANUAL',
    ...rest,
    state: {
      plan: 'SOLO',
      effectivePlan: 'SOLO',
      onTrial: false,
      trialEndsAt: null,
      trialDaysLeft: 0,
      trialExpired: true,
      features: SOLO_FEATURES,
      note: 'Trial ended — on the free Solo plan',
      ...(stateOver ?? {}),
    },
  };
}

describe('featureLocked', () => {
  it('locks the paid tools on the free plan and keeps the core ones', () => {
    const plan = overview();
    expect(featureLocked(plan, 'invoicing')).toBe(true);
    expect(featureLocked(plan, 'rates')).toBe(true);
    // The board is what a free account is here for.
    expect(featureLocked(plan, 'board')).toBe(false);
    expect(featureLocked(plan, 'fuel')).toBe(false);
  });

  it('locks nothing while the plan is unknown — fails open, never walls a payer', () => {
    expect(featureLocked(null, 'invoicing')).toBe(false);
    expect(featureLocked(undefined, 'invoicing')).toBe(false);
    // A payload without a feature list must not read as "nothing granted".
    const empty = overview({ state: { features: [] } });
    expect(featureLocked(empty, 'board')).toBe(false);
  });

  it('falls back to the locked list when the server sent no feature set', () => {
    const noFeatures = overview({
      locked: ['invoicing'],
      state: { features: undefined as unknown as string[] },
    });
    expect(featureLocked(noFeatures, 'invoicing')).toBe(true);
    expect(featureLocked(noFeatures, 'board')).toBe(false);
  });

  it('never locks an unknown feature key', () => {
    // A typo in a feature name must not wall off a tool nobody gated.
    expect(featureLocked(overview(), 'invoicingg')).toBe(false);
    expect(featureLocked(overview(), '')).toBe(false);
  });

  it('unlocks everything on a trial and on a paid plan', () => {
    // A trial is the full product, so the server sends every feature key.
    const onTrial = overview({
      locked: [],
      state: {
        onTrial: true,
        trialExpired: false,
        effectivePlan: 'PRO',
        features: CATALOG[1].features.concat(['fuel', 'ifta', 'mobile', 'book', 'trucks']),
      },
    });
    expect(featureLocked(onTrial, 'invoicing')).toBe(false);
    expect(featureLocked(onTrial, 'route')).toBe(false);

    const pro = overview({
      plan: 'PRO',
      locked: [],
      state: { plan: 'PRO', effectivePlan: 'PRO', trialExpired: false, features: CATALOG[1].features },
    });
    expect(featureLocked(pro, 'invoicing')).toBe(false);
    expect(featureLocked(pro, 'network')).toBe(false);
  });
});

describe('unlockPlanName', () => {
  it('names the cheapest plan that includes the tool', () => {
    expect(unlockPlanName(overview(), 'invoicing')).toBe('Pro');
  });

  it('returns null rather than guessing when nothing includes it', () => {
    expect(unlockPlanName(overview(), 'booking')).toBeNull();
    expect(unlockPlanName(null, 'invoicing')).toBeNull();
    expect(unlockPlanName(overview({ catalog: [] }), 'invoicing')).toBeNull();
  });
});

describe('planSummary', () => {
  it('counts the trial down in days', () => {
    const onTrial = overview({
      state: { onTrial: true, trialExpired: false, trialDaysLeft: 1, effectivePlan: 'PRO' },
    });
    expect(planSummary(onTrial)).toBe('Your PRO trial (1 day left)');
  });

  it('names the free plan plainly once the trial lapses', () => {
    expect(planSummary(overview())).toBe('The free Solo plan');
  });

  it('names a paid plan from the catalog', () => {
    const pro = overview({ plan: 'PRO', state: { trialExpired: false, effectivePlan: 'PRO' } });
    expect(planSummary(pro)).toBe('The Pro plan');
  });
});
