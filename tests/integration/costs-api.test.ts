import { buildApp } from '../../src/app';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import { PrismaCostService } from '../../src/modules/costs/cost.service';
import { KM_PER_MILE } from '../../src/modules/board/board.earning';
import type { CostRepo } from '../../src/modules/costs/cost.repo';

/**
 * Cost per mile is money, so these tests are as much about who may ask as about
 * the arithmetic. The real service runs against a fake repo, so the window
 * validation, the unit lookup and the declared-cost merge are all exercised
 * through the HTTP surface a client actually reaches.
 */

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
  APP_URL: 'https://demo.loadwave.app',
};

const WINDOW = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' };

interface RecordedCalls {
  declaredWrites: Array<{ tenantId: string; assetId: string; cost: unknown }>;
}

function recordingRepo(): { repo: CostRepo; calls: RecordedCalls } {
  const calls: RecordedCalls = { declaredWrites: [] };
  const repo = fakeRepo({
    setDeclared: async (tenantId, assetId, cost) => {
      calls.declaredWrites.push({ tenantId, assetId, cost });
      return cost === null ? {} : { [assetId]: cost };
    },
  });
  return { repo, calls };
}

function fakeRepo(over: Partial<CostRepo> = {}): CostRepo {
  return {
    units: async () => [
      { id: 'asset-1', label: 'Unit 214', assetType: 'TRACTOR' },
      { id: 'asset-2', label: 'Unit 215', assetType: 'TRACTOR' },
    ],
    fuelCost: async (_tenantId, assetId) => (assetId === 'asset-1' ? 1000 : 500),
    segments: async (_tenantId, assetId) =>
      assetId === 'asset-1'
        ? [
            { startTime: new Date('2026-10-02T10:00:00Z'), distanceKm: 400 }, // assigned: loaded
            { startTime: new Date('2026-10-03T10:00:00Z'), distanceKm: 100 }, // nobody on it: empty
          ]
        : [{ startTime: new Date('2026-10-02T10:00:00Z'), distanceKm: 50 }],
    assignments: async (_tenantId, assetId) =>
      assetId === 'asset-1'
        ? [{ assignedAt: new Date('2026-10-02T08:00:00Z'), deliveredAt: new Date('2026-10-02T20:00:00Z') }]
        : [],
    detention: async () => ({ minutes: 90, recovered: 165 }),
    declared: async () => ({ 'asset-1': { centsPerDay: 5000, note: 'Payment + insurance' } }),
    setDeclared: async () => ({ 'asset-2': { centsPerDay: 2500 } }),
    ...over,
  };
}

async function build(repo: CostRepo = fakeRepo()) {
  return buildApp({
    env: ENV,
    deps: { costs: new PrismaCostService(repo) },
  });
}

function token(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string, roles: JwtUser['roles']): string {
  const user: JwtUser = { sub: 'u1', tenantId, roles, driverId: null, type: 'access' };
  return app.jwt.sign(user);
}

describe('GET /api/costs/per-mile', () => {
  it('prices the fleet from fuel, declared fixed cost and real mileage', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: `/api/costs/per-mile?${new URLSearchParams(WINDOW).toString()}`,
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 30 days at $50/day is the declared fixed bucket.
    expect(body.window.days).toBe(30);
    expect(body.fleet.buckets.fuel).toBe(1500);
    expect(body.fleet.buckets.fixed).toBe(1500);
    // Only the 400 km run under an assignment counts as loaded; the 100 km the
    // first unit ran empty and all 50 km of the unassigned unit do not.
    expect(body.fleet.loadedKm).toBe(400);
    expect(body.fleet.emptyKm).toBe(150);
    expect(body.fleet.totalCost).toBe(3000);
    expect(body.fleet.costPerMile).toBeCloseTo(3000 / (550 * KM_PER_MILE), 6);
    expect(body.fleet.costPerLoadedMile).toBeCloseTo(3000 / (400 * KM_PER_MILE), 6);

    // The unit's own figure still reports what it leaves out.
    const unit = body.units.find((u: { unit: { id: string } }) => u.unit.id === 'asset-1');
    expect(unit.cost.excludedCosts).toEqual(['MAINTENANCE', 'TOLLS']);
    expect(unit.cost.mileageBasis).toBe('ASSIGNMENT_WINDOW');
    expect(unit.cost.detentionRecovered).toBe(165);
    expect(unit.declared).toEqual({ centsPerDay: 5000, note: 'Payment + insurance' });
    await app.close();
  });

  it('narrows to one unit when asked, and refuses a unit from another company', async () => {
    const app = await build();
    const auth = { authorization: `Bearer ${token(app, 'tenant-a', ['DISPATCHER'])}` };

    const one = await app.inject({ method: 'GET', url: `/api/costs/per-mile?assetId=asset-2&${new URLSearchParams(WINDOW)}`, headers: auth });
    expect(one.statusCode).toBe(200);
    expect(one.json().units).toHaveLength(1);
    // No assignment ever covered asset-2, so nothing it ran counts as loaded.
    expect(one.json().fleet.loadedKm).toBe(0);
    expect(one.json().fleet.costPerLoadedMile).toBeNull();

    const unknown = await app.inject({ method: 'GET', url: '/api/costs/per-mile?assetId=asset-9', headers: auth });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it('refuses an owner-operator money report to a driver', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/costs/per-mile',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['DRIVER'])}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('requires a session at all', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/costs/per-mile' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a backwards or unparseable window', async () => {
    const app = await build();
    const auth = { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` };

    const backwards = await app.inject({
      method: 'GET',
      url: '/api/costs/per-mile?from=2026-10-31T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
      headers: auth,
    });
    expect(backwards.statusCode).toBe(400);

    const junk = await app.inject({ method: 'GET', url: '/api/costs/per-mile?from=whenever', headers: auth });
    expect(junk.statusCode).toBe(400);
    await app.close();
  });

  it('caps an absurd window rather than scanning years of segments', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/costs/per-mile?from=2020-01-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().window.days).toBe(366);
    await app.close();
  });
});

describe('PUT /api/costs/declared/:assetId', () => {
  it('records what a unit costs to own, per day, against the right company', async () => {
    const { repo, calls } = recordingRepo();
    const app = await build(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/costs/declared/asset-2',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
      payload: { centsPerDay: 2500, note: 'Payment only' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().declared).toEqual({ 'asset-2': { centsPerDay: 2500, note: 'Payment only' } });
    expect(calls.declaredWrites).toEqual([
      { tenantId: 'tenant-a', assetId: 'asset-2', cost: { centsPerDay: 2500, note: 'Payment only' } },
    ]);
    await app.close();
  });

  it('turns zero into a cleared declaration rather than a stored zero', async () => {
    const { repo, calls } = recordingRepo();
    const app = await build(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/costs/declared/asset-2',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
      payload: { centsPerDay: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(calls.declaredWrites[0].cost).toBeNull();
    await app.close();
  });

  it('refuses a fractional number of cents before it reaches the store', async () => {
    const { repo, calls } = recordingRepo();
    const app = await build(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/costs/declared/asset-2',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
      payload: { centsPerDay: 25.5 },
    });

    expect(res.statusCode).toBe(400);
    expect(calls.declaredWrites).toHaveLength(0);
    await app.close();
  });

  it('keeps the declaration editor away from drivers', async () => {
    const { repo, calls } = recordingRepo();
    const app = await build(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/costs/declared/asset-2',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['DRIVER'])}` },
      payload: { centsPerDay: 2500 },
    });
    expect(res.statusCode).toBe(403);
    expect(calls.declaredWrites).toHaveLength(0);
    await app.close();
  });
});
