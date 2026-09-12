import { badRequest, conflict, notFound } from '../../utils/errors';
import {
  FEATURE_LABELS,
  FEATURES,
  PLANS,
  PLAN_FEATURES,
  PLAN_NAMES,
  PLAN_PRICES,
  TRIAL_DAYS,
  hasFeature,
  isPlan,
  planStateOf,
  trialEndsAtFrom,
  type Feature,
  type Plan,
  type PlanCode,
  type PlanState,
} from './plan.policy';
import type { BillingRepo, PlanRequestRow } from './billing.repo';

export interface PlanCatalogEntry {
  plan: Plan;
  name: string;
  priceMonthly: number;
  features: Feature[];
  featureLabels: string[];
}

export interface PlanOverview {
  plan: PlanCode;
  state: PlanState;
  /** Feature keys this plan does NOT include, so the UI can lock them. */
  locked: Feature[];
  catalog: PlanCatalogEntry[];
  trialDays: number;
  pendingRequest: PlanRequestRow | null;
  /** True when the deployment cannot take money yet and staff activate plans. */
  activation: 'SELF_SERVE' | 'MANUAL';
}

export interface BillingService {
  overview(tenantId: string, now?: Date): Promise<PlanOverview>;
  state(tenantId: string, now?: Date): Promise<PlanState>;
  hasFeature(tenantId: string, feature: Feature): Promise<boolean>;
  requestPlan(tenantId: string, userId: string | null, plan: string): Promise<PlanOverview>;
  pendingRequests(): Promise<PlanRequestRow[]>;
  decide(requestId: string, approve: boolean, note?: string | null): Promise<PlanRequestRow>;
  /** Used at signup. */
  trialEndsAt(now?: Date): Date;
}

/** Which features each plan is missing — the inverse of PLAN_FEATURES. */
function lockedFor(plan: Plan): Feature[] {
  return FEATURES.filter((f) => !PLAN_FEATURES[plan].includes(f));
}

export function catalog(): PlanCatalogEntry[] {
  return PLANS.map((plan) => ({
    plan,
    name: PLAN_NAMES[plan],
    priceMonthly: PLAN_PRICES[plan],
    features: [...PLAN_FEATURES[plan]],
    featureLabels: PLAN_FEATURES[plan].map((f) => FEATURE_LABELS[f]),
  }));
}

export class PrismaBillingService implements BillingService {
  constructor(
    private readonly repo: BillingRepo,
    /**
     * Manual activation is the honest default: without a payment provider
     * configured, nobody should be able to grant themselves the paid tiers.
     */
    private readonly activation: 'SELF_SERVE' | 'MANUAL' = 'MANUAL',
  ) {}

  trialEndsAt(now: Date = new Date()): Date {
    return trialEndsAtFrom(now, TRIAL_DAYS);
  }

  async state(tenantId: string, now: Date = new Date()): Promise<PlanState> {
    const row = await this.repo.plan(tenantId);
    if (!row) throw notFound('tenant not found');
    return planStateOf({ plan: row.plan, trialEndsAt: row.trialEndsAt, now });
  }

  async hasFeature(tenantId: string, feature: Feature): Promise<boolean> {
    return hasFeature(await this.state(tenantId), feature);
  }

  async overview(tenantId: string, now: Date = new Date()): Promise<PlanOverview> {
    const row = await this.repo.plan(tenantId);
    if (!row) throw notFound('tenant not found');
    const state = planStateOf({ plan: row.plan, trialEndsAt: row.trialEndsAt, now });
    return {
      plan: state.plan,
      state,
      locked: lockedFor(state.effectivePlan),
      catalog: catalog(),
      trialDays: TRIAL_DAYS,
      pendingRequest: await this.repo.openRequest(tenantId),
      activation: this.activation,
    };
  }

  /**
   * A request, not a purchase. Recording it means the intent is durable and
   * the tenant sees a real pending state instead of a button that appears to
   * work and does nothing.
   */
  async requestPlan(tenantId: string, userId: string | null, plan: string): Promise<PlanOverview> {
    const wanted = String(plan ?? '').toUpperCase();
    if (!isPlan(wanted)) {
      throw badRequest(`choose a plan from the pricing page`);
    }

    const current = await this.state(tenantId);
    if (current.plan === wanted) {
      throw conflict(`you are already on the ${PLAN_NAMES[wanted]} plan`);
    }

    const open = await this.repo.openRequest(tenantId);
    if (open) {
      if (open.requestedPlan === wanted) {
        throw conflict('you already have a pending request for that plan');
      }
      // Supersede the stale request rather than stacking a second one.
      await this.repo.decideRequest(open.id, 'DECLINED', 'Superseded by a newer request', new Date());
    }

    await this.repo.createRequest({ tenantId, requestedPlan: wanted, requestedById: userId });
    return this.overview(tenantId);
  }

  async pendingRequests(): Promise<PlanRequestRow[]> {
    return this.repo.listRequests('PENDING');
  }

  /** Operator action: approve flips the tenant onto the plan immediately. */
  async decide(requestId: string, approve: boolean, note?: string | null): Promise<PlanRequestRow> {
    const request = await this.repo.requestById(requestId);
    if (!request) throw notFound('that request does not exist');
    if (request.status !== 'PENDING') throw conflict(`that request is already ${request.status.toLowerCase()}`);

    const at = new Date();
    if (approve) {
      if (!isPlan(request.requestedPlan)) throw badRequest('that request names an unknown plan');
      await this.repo.setPlan(request.tenantId, request.requestedPlan, at);
    }
    await this.repo.decideRequest(requestId, approve ? 'APPROVED' : 'DECLINED', note ?? null, at);
    return { ...request, status: approve ? 'APPROVED' : 'DECLINED', note: note ?? null, decidedAt: at.toISOString() };
  }
}
