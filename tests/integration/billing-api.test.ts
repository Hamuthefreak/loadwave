/**
 * Plans and entitlements over HTTP.
 *
 * The pricing page has advertised tiers, trials and locked features for a
 * while; this suite is the proof they are real. The real service runs behind
 * the real routes, so the guarantees pinned here are the ones a customer would
 * hit: a lapsed plan cannot use a paid endpoint, nobody can grant themselves a
 * paid plan, and an upgrade request is a durable, reviewable thing.
 */
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/events/event-bus';
import type { PrismaClient } from '@prisma/client';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import { PrismaBillingService } from '../../src/modules/billing/billing.service';
import type {
  BillingRepo,
  PlanRequestRow,
  TenantPlanRow,
} from '../../src/modules/billing/billing.repo';
import type { Plan } from '../../src/modules/billing/plan.policy';

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
};

const ME = 'tenant-me';
const OPERATOR_KEY = 'operator-secret-abc';

/** In-memory stand-in for the Prisma billing repo (which is pure mapping). */
class FakeBillingRepo implements BillingRepo {
  plans = new Map<string, TenantPlanRow>([
    [ME, { tenantId: ME, plan: 'SOLO', trialEndsAt: null, planChangedAt: null }],
  ]);
  requests: PlanRequestRow[] = [];
  private seq = 0;

  async plan(tenantId: string): Promise<TenantPlanRow | null> {
    return this.plans.get(tenantId) ?? null;
  }

  async setPlan(tenantId: string, plan: string, at: Date): Promise<void> {
    const row = this.plans.get(tenantId);
    if (!row) return;
    this.plans.set(tenantId, { ...row, plan, planChangedAt: at });
  }

  async openRequest(tenantId: string): Promise<PlanRequestRow | null> {
    return this.requests.find((r) => r.tenantId === tenantId && r.status === 'PENDING') ?? null;
  }

  async createRequest(input: {
    tenantId: string;
    requestedPlan: Plan;
    requestedById: string | null;
    note?: string | null;
  }): Promise<PlanRequestRow> {
    this.seq += 1;
    const row: PlanRequestRow = {
      id: `req-${this.seq}`,
      tenantId: input.tenantId,
      tenantName: 'Me Carrier',
      requestedPlan: input.requestedPlan,
      status: 'PENDING',
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    this.requests.push(row);
    return row;
  }

  async requestById(id: string): Promise<PlanRequestRow | null> {
    return this.requests.find((r) => r.id === id) ?? null;
  }

  async listRequests(status: string): Promise<PlanRequestRow[]> {
    return this.requests.filter((r) => r.status === status);
  }

  async decideRequest(
    id: string,
    status: 'APPROVED' | 'DECLINED',
    note: string | null,
    at: Date,
  ): Promise<void> {
    const row = this.requests.find((r) => r.id === id);
    if (!row) return;
    row.status = status;
    row.note = note;
    row.decidedAt = at.toISOString();
  }
}

async function buildWithFakes(opts: { adminKey?: string } = {}): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  repo: FakeBillingRepo;
}> {
  const bus = new EventBus();
  const repo = new FakeBillingRepo();
  const billing = new PrismaBillingService(repo);
  const market = {
    conditions: jest.fn(async () => ({ lanes: [], equipment: [] })),
  };

  const app = await buildApp({
    env: { ...ENV, BILLING_ADMIN_KEY: opts.adminKey ?? OPERATOR_KEY },
    deps: {
      bus,
      // Only the billing routes and the market gate are exercised; the fake
      // prisma keeps the unrelated services constructible without a database.
      prisma: {} as unknown as PrismaClient,
      billing: billing as never,
      market: market as never,
    },
  });
  await app.ready();
  return { app, repo };
}

function token(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  roles: JwtUser['roles'] = ['ADMIN'],
) {
  return app.jwt.sign({ sub: `user-${tenantId}`, tenantId, roles, driverId: null, type: 'access' } as JwtUser);
}

function auth(app: Awaited<ReturnType<typeof buildApp>>, tenantId = ME) {
  return { authorization: `Bearer ${token(app, tenantId)}` };
}

describe('GET /api/billing/plan', () => {
  it('reports the plan, the locked tools and the honest upgrade path', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({ method: 'GET', url: '/api/billing/plan', headers: auth(app) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBe('SOLO');
    expect(body.state.effectivePlan).toBe('SOLO');
    expect(body.locked).toContain('invoicing');
    expect(body.locked).toContain('rates');
    // Solo keeps the core product.
    expect(body.state.features).toContain('board');
    // With no payment provider wired up, activation is not self-serve.
    expect(body.activation).toBe('MANUAL');
    expect(body.pendingRequest).toBeNull();
    await app.close();
  });

  it('requires authentication', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({ method: 'GET', url: '/api/billing/plan' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('feature gating', () => {
  it('refuses a paid endpoint on the free plan, naming the plan that unlocks it', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({ method: 'GET', url: '/api/market/conditions', headers: auth(app) });

    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error).toBe('PLAN_UPGRADE_REQUIRED');
    expect(body.message).toMatch(/Rate insights/i);
    expect(body.message).toMatch(/Pro/);
    await app.close();
  });

  it('still returns 401 rather than 402 for an anonymous caller', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({ method: 'GET', url: '/api/market/conditions' });
    // An unknown caller must not be told to upgrade.
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('lets the same endpoint through once the plan includes it', async () => {
    const { app, repo } = await buildWithFakes();
    await repo.setPlan(ME, 'PRO', new Date());

    const res = await app.inject({ method: 'GET', url: '/api/market/conditions', headers: auth(app) });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('billing never holds the core product hostage', () => {
  /**
   * The load routes share invoicing.routes.ts with the invoice routes, and it
   * would be easy to gate the whole module by accident. Dispatch and trip
   * management are what a carrier does every day; locking them because a
   * subscription lapsed would take the product hostage to a billing question
   * and strand a driver mid-trip. Pinned on the free plan, where it matters.
   */
  it('leaves dispatch and load management usable on the free plan', async () => {
    const bus = new EventBus();
    const loads = { list: async () => [] };
    const app = await buildApp({
      env: { ...ENV, BILLING_ADMIN_KEY: OPERATOR_KEY },
      deps: {
        bus,
        prisma: {} as unknown as PrismaClient,
        billing: new PrismaBillingService(new FakeBillingRepo()) as never,
        loads: loads as never,
      },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/loads', headers: auth(app) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    // ...while the invoice half of the same module is properly gated.
    const invoices = await app.inject({ method: 'GET', url: '/api/invoices', headers: auth(app) });
    expect(invoices.statusCode).toBe(402);
    expect(invoices.json().message).toMatch(/Invoicing/i);
    await app.close();
  });
});

describe('upgrade requests', () => {
  it('records a request and shows it as pending without changing the plan', async () => {
    const { app, repo } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: auth(app),
      payload: { plan: 'PRO' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pendingRequest.requestedPlan).toBe('PRO');
    // The plan must NOT have changed — that is the whole point of review.
    expect(body.plan).toBe('SOLO');
    expect((await repo.plan(ME))?.plan).toBe('SOLO');
    expect(body.locked).toContain('invoicing');
    await app.close();
  });

  it('refuses a second open request for the same plan', async () => {
    const { app } = await buildWithFakes();
    await app.inject({ method: 'POST', url: '/api/billing/plan', headers: auth(app), payload: { plan: 'PRO' } });
    const again = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: auth(app),
      payload: { plan: 'PRO' },
    });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('supersedes a stale request instead of stacking a second one', async () => {
    const { app, repo } = await buildWithFakes();
    await app.inject({ method: 'POST', url: '/api/billing/plan', headers: auth(app), payload: { plan: 'PRO' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: auth(app),
      payload: { plan: 'FLEET' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().pendingRequest.requestedPlan).toBe('FLEET');
    expect(repo.requests.filter((r) => r.status === 'PENDING')).toHaveLength(1);
    expect(repo.requests.some((r) => r.status === 'DECLINED')).toBe(true);
    await app.close();
  });

  it('rejects an unknown plan and a plan the tenant is already on', async () => {
    const { app } = await buildWithFakes();
    const bogus = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: auth(app),
      payload: { plan: 'ENTERPRISE' },
    });
    expect(bogus.statusCode).toBe(400);

    const same = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: auth(app),
      payload: { plan: 'SOLO' },
    });
    expect(same.statusCode).toBe(409);
    await app.close();
  });

  it('does not let a non-admin request a plan change', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/plan',
      headers: { authorization: `Bearer ${token(app, ME, ['DRIVER'])}` },
      payload: { plan: 'PRO' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('operator activation', () => {
  it('hides the activation surface from anyone without the operator key', async () => {
    const { app } = await buildWithFakes();
    const anon = await app.inject({ method: 'GET', url: '/api/billing/requests' });
    expect(anon.statusCode).toBe(403);

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/billing/requests',
      headers: { 'x-billing-key': 'not-the-key' },
    });
    expect(wrong.statusCode).toBe(403);
    await app.close();
  });

  it('approving a request switches the tenant onto the plan for real', async () => {
    const { app, repo } = await buildWithFakes();
    await app.inject({ method: 'POST', url: '/api/billing/plan', headers: auth(app), payload: { plan: 'PRO' } });

    const queue = await app.inject({
      method: 'GET',
      url: '/api/billing/requests',
      headers: { 'x-billing-key': OPERATOR_KEY },
    });
    expect(queue.statusCode).toBe(200);
    const [pending] = queue.json().requests;
    expect(pending.requestedPlan).toBe('PRO');

    const decided = await app.inject({
      method: 'POST',
      url: `/api/billing/requests/${pending.id}/decide`,
      headers: { 'x-billing-key': OPERATOR_KEY },
      payload: { approve: true },
    });
    expect(decided.statusCode).toBe(200);

    // The tenant is now genuinely on PRO: the previously locked tool works.
    expect((await repo.plan(ME))?.plan).toBe('PRO');
    const unlocked = await app.inject({
      method: 'GET',
      url: '/api/market/conditions',
      headers: auth(app),
    });
    expect(unlocked.statusCode).toBe(200);

    const overview = await app.inject({ method: 'GET', url: '/api/billing/plan', headers: auth(app) });
    expect(overview.json().locked).toEqual([]);
    await app.close();
  });

  it('declining leaves the tenant where they were', async () => {
    const { app, repo } = await buildWithFakes();
    await app.inject({ method: 'POST', url: '/api/billing/plan', headers: auth(app), payload: { plan: 'FLEET' } });
    const queue = await app.inject({
      method: 'GET',
      url: '/api/billing/requests',
      headers: { 'x-billing-key': OPERATOR_KEY },
    });
    const [pending] = queue.json().requests;

    const decided = await app.inject({
      method: 'POST',
      url: `/api/billing/requests/${pending.id}/decide`,
      headers: { 'x-billing-key': OPERATOR_KEY },
      payload: { approve: false, note: 'no payment on file' },
    });
    expect(decided.statusCode).toBe(200);
    expect((await repo.plan(ME))?.plan).toBe('SOLO');

    // And the request cannot be decided twice.
    const again = await app.inject({
      method: 'POST',
      url: `/api/billing/requests/${pending.id}/decide`,
      headers: { 'x-billing-key': OPERATOR_KEY },
      payload: { approve: true },
    });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('refuses activation entirely when no operator key is configured', async () => {
    const { app } = await buildWithFakes({ adminKey: '' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/billing/requests',
      // Even a caller who guesses the shape gets nowhere: unconfigured means closed.
      headers: { 'x-billing-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
