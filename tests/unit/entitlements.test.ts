/**
 * Plans, trials and feature entitlements.
 *
 * These rules are what stand between the pricing page and a customer who
 * expects what they paid for, so the boundaries are pinned: what a trial
 * includes, what an expired trial falls back to, and which plan unlocks which
 * tool.
 */
import {
  FEATURES,
  FEATURE_LABELS,
  PLANS,
  PLAN_FEATURES,
  PLAN_PRICES,
  TRIAL_DAYS,
  cheapestPlanWith,
  hasFeature,
  isFeature,
  isPlan,
  planStateOf,
  trialEndsAtFrom,
} from '../../src/modules/billing/plan.policy';

const NOW = new Date('2026-09-12T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('plan catalog', () => {
  it('every feature has a human label and every paid plan includes them', () => {
    for (const feature of FEATURES) {
      expect(FEATURE_LABELS[feature]).toBeTruthy();
    }
    expect(PLAN_FEATURES.PRO).toEqual(FEATURES);
    expect(PLAN_FEATURES.FLEET).toEqual(FEATURES);
  });

  it('Solo is a genuine subset — the free tier must not silently include paid tools', () => {
    const solo = [...PLAN_FEATURES.SOLO];
    expect(solo.length).toBeGreaterThan(0);
    for (const feature of solo) {
      expect(FEATURES).toContain(feature);
    }
    expect(solo).not.toContain('invoicing');
    expect(solo).not.toContain('rates');
    expect(solo).not.toContain('network');
  });

  it('keeps the advertised prices and the free tier at zero', () => {
    expect(PLAN_PRICES.SOLO).toBe(0);
    for (const plan of PLANS) {
      expect(Number.isFinite(PLAN_PRICES[plan])).toBe(true);
    }
  });

  it('validates plan and feature codes', () => {
    expect(isPlan('PRO')).toBe(true);
    expect(isPlan('pro')).toBe(false);
    expect(isPlan('ENTERPRISE')).toBe(false);
    expect(isFeature('invoicing')).toBe(true);
    expect(isFeature('directory')).toBe(false);
  });
});

describe('planStateOf', () => {
  it('gives a fresh trial the whole product', () => {
    const state = planStateOf({ plan: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + 10 * DAY), now: NOW });
    expect(state.onTrial).toBe(true);
    expect(state.trialExpired).toBe(false);
    expect(state.trialDaysLeft).toBe(10);
    expect(state.features).toEqual(FEATURES);
    expect(hasFeature(state, 'invoicing')).toBe(true);
  });

  it('falls back to Solo when the trial has run out — usable, not bricked', () => {
    const state = planStateOf({ plan: 'TRIAL', trialEndsAt: new Date(NOW.getTime() - DAY), now: NOW });
    expect(state.onTrial).toBe(false);
    expect(state.trialExpired).toBe(true);
    expect(state.effectivePlan).toBe('SOLO');
    expect(hasFeature(state, 'invoicing')).toBe(false);
    // The core product must survive a lapsed trial.
    expect(hasFeature(state, 'board')).toBe(true);
    expect(hasFeature(state, 'book')).toBe(true);
  });

  it('treats a trial with no end date as expired rather than infinite', () => {
    const state = planStateOf({ plan: 'TRIAL', trialEndsAt: null, now: NOW });
    expect(state.trialExpired).toBe(true);
    expect(state.effectivePlan).toBe('SOLO');
  });

  it('honours a paid plan regardless of any leftover trial date', () => {
    const state = planStateOf({ plan: 'PRO', trialEndsAt: new Date(NOW.getTime() + 5 * DAY), now: NOW });
    expect(state.onTrial).toBe(false);
    expect(state.plan).toBe('PRO');
    expect(hasFeature(state, 'invoicing')).toBe(true);
  });

  it('does not treat the trial end instant as still-active', () => {
    const state = planStateOf({ plan: 'TRIAL', trialEndsAt: NOW, now: NOW });
    expect(state.onTrial).toBe(false);
    expect(state.trialExpired).toBe(true);
  });

  it('never leaves a tenant with no plan at all', () => {
    const state = planStateOf({ plan: null, trialEndsAt: null, now: NOW });
    expect(state.effectivePlan).toBe('SOLO');
    expect(state.features.length).toBeGreaterThan(0);
  });

  it('ignores an unknown plan code instead of granting the full product', () => {
    const state = planStateOf({ plan: 'ENTERPRISE_UNLIMITED', trialEndsAt: null, now: NOW });
    expect(state.effectivePlan).toBe('SOLO');
    expect(hasFeature(state, 'invoicing')).toBe(false);
  });
});

describe('cheapestPlanWith', () => {
  it('names the cheapest plan that unlocks a tool', () => {
    expect(cheapestPlanWith('board')).toBe('SOLO');
    expect(cheapestPlanWith('invoicing')).toBe('PRO');
    expect(cheapestPlanWith('network')).toBe('PRO');
    expect(cheapestPlanWith('rates')).toBe('PRO');
  });
});

describe('trialEndsAtFrom', () => {
  it('sets a 30-day window', () => {
    const end = trialEndsAtFrom(NOW);
    expect(end.getTime() - NOW.getTime()).toBe(TRIAL_DAYS * DAY);
  });
});
