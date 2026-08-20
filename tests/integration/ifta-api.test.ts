import { buildApp } from '../../src/app';
import { EventBus } from '../../src/events/event-bus';
import type { PrismaClient } from '@prisma/client';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import type {
  IftaComputeRequest,
  IftaComputedResult,
  IftaService,
} from '../../src/modules/ifta/ifta.service';
import type { IftaSummaryView } from '../../src/modules/ifta/ifta.repo';
import type { Quarter } from '../../src/utils/quarters';

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
};

interface FakePrisma {
  routePoint: { createMany: jest.Mock };
}

interface FakeFuel {
  importMany: jest.Mock;
}

interface FakeIfta {
  requestCompute: jest.Mock<Promise<IftaComputedResult[]>>;
  getSummaries: jest.Mock<Promise<IftaSummaryView[]>>;
}

interface Fakes {
  prisma: FakePrisma;
  fuel: FakeFuel;
  ifta: FakeIfta;
  bus: EventBus;
  computeRequests: IftaComputeRequest[];
}

async function buildWithFakes(): Promise<{ app: Awaited<ReturnType<typeof buildApp>>; fakes: Fakes }> {
  const bus = new EventBus();
  const computeRequests: IftaComputeRequest[] = [];
  const iftaFake = {
    requestCompute: jest.fn(async (input: IftaComputeRequest): Promise<IftaComputedResult[]> => {
      computeRequests.push(input);
      return [];
    }),
    getSummaries: jest.fn(async (): Promise<IftaSummaryView[]> => []),
  };

  const fakes: Fakes = {
    prisma: { routePoint: { createMany: jest.fn(async () => ({ count: 1 })) } },
    fuel: { importMany: jest.fn(async () => []) },
    ifta: iftaFake,
    bus,
    computeRequests,
  };

  const app = await buildApp({
    env: ENV,
    deps: {
      bus,
      prisma: fakes.prisma as unknown as PrismaClient,
      fuel: fakes.fuel as never,
      ifta: fakes.ifta as unknown as IftaService,
    },
  });
  return { app, fakes };
}

function authToken(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string): string {
  const user: JwtUser = { sub: 'u1', tenantId, roles: ['ADMIN'], driverId: null, type: 'access' };
  return app.jwt.sign(user);
}

const basePayload = {
  tenantId: 'tenant-a',
  assetId: 'asset-1',
  driverId: 'driver-1',
  quarter: '2026-Q1',
  routePoints: [
    { occurredAt: '2026-01-10T10:00:00Z', lat: 45.5017, lon: -73.5673, vehicleDistanceKm: 100 },
    { occurredAt: '2026-01-10T12:00:00Z', lat: 45.4215, lon: -75.6972, vehicleDistanceKm: 220 },
  ],
  fuelTransactions: [
    {
      occurredAt: '2026-01-10T11:00:00Z',
      jurisdictionCode: 'QC',
      volumeLitres: '150',
      transactionCurrency: 'CAD',
      amountTransaction: '250.00',
    },
  ],
};

describe('POST /api/ifta/compute', () => {
  it('returns 202 Accepted, persists telemetry and triggers the async worker', async () => {
    const { app, fakes } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ifta/compute',
      headers: { authorization: `Bearer ${authToken(app, 'tenant-a')}` },
      payload: basePayload,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'accepted', quarter: '2026-Q1' });

    // The route persisted route points and fuel before dispatching.
    expect(fakes.prisma.routePoint.createMany).toHaveBeenCalledTimes(1);
    expect(fakes.fuel.importMany).toHaveBeenCalledTimes(1);

    // The worker subscription receives IftaQuarterComputeRequested.
    await new Promise((r) => setTimeout(r, 20));
    expect(fakes.computeRequests).toHaveLength(1);
    expect(fakes.computeRequests[0]).toMatchObject({
      tenantId: 'tenant-a',
      assetId: 'asset-1',
      quarter: '2026-Q1',
      reason: 'MANUAL',
    });
    await app.close();
  });

  it('enforces tenant isolation and returns 403 on a tenant mismatch', async () => {
    const { app, fakes } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ifta/compute',
      headers: { authorization: `Bearer ${authToken(app, 'tenant-a')}` },
      payload: { ...basePayload, tenantId: 'tenant-b' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'Tenant mismatch' });
    expect(fakes.prisma.routePoint.createMany).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(fakes.computeRequests).toHaveLength(0);
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ifta/compute',
      payload: basePayload,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('validates the payload schema (bad quarter format)', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ifta/compute',
      headers: { authorization: `Bearer ${authToken(app, 'tenant-a')}` },
      payload: { ...basePayload, quarter: 'Q1-2026' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('lists IFTA summaries for the quarter via the summaries endpoint', async () => {
    const { app, fakes } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/ifta/summaries?quarter=2026-Q1',
      headers: { authorization: `Bearer ${authToken(app, 'tenant-a')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(fakes.ifta.getSummaries).toHaveBeenCalledWith('tenant-a', '2026-Q1' as Quarter, undefined);
    await app.close();
  });
});
