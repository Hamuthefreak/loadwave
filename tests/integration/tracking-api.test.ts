import { buildApp } from '../../src/app';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import { PrismaTrackingService } from '../../src/modules/tracking/tracking.service';
import { trackingToken } from '../../src/modules/tracking/tracking.token';
import type { TrackingLoad, TrackingRepo } from '../../src/modules/tracking/tracking.repo';

/**
 * The public tracking link is the only unauthenticated route in this product
 * that exposes operational data, so these tests are written as an allow-list:
 * one test proves the happy path, one proves a wrong token gets nothing, and one
 * asserts the exact key set of the public body — a field that is not in that
 * list cannot leak because it never exists in the shape.
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

const SECRET = ENV.JWT_ACCESS_SECRET;

const LOAD_A: TrackingLoad = {
  id: 'load-a',
  tenantId: 'tenant-a',
  status: 'IN_TRANSIT',
  originCountry: 'CA',
  originRegion: 'QC',
  originLocality: 'Montréal',
  destinationCountry: 'CA',
  destinationRegion: 'ON',
  destinationLocality: 'Toronto',
  equipmentType: 'DRY_VAN',
  commodity: 'Palletised food',
  weightKg: 18_000,
  stopCount: 2,
  isInternational: false,
  assigneeAssetId: 'asset-1',
  assigneeDriverId: 'driver-1',
  assignedAt: new Date('2026-10-05T07:00:00Z'),
  deliveredAt: null,
  distanceKmEstimate: 540,
};

function fakeRepo(): TrackingRepo {
  return {
    load: async (loadId) => {
      if (loadId === 'load-a') return LOAD_A;
      if (loadId === 'load-b') return { ...LOAD_A, id: 'load-b', tenantId: 'tenant-b' };
      return null;
    },
    stops: async () => [
      {
        id: 's1',
        kind: 'ORIGIN',
        stopOrder: 1,
        country: 'CA',
        region: 'QC',
        locality: 'Montréal',
        lat: 45.5019,
        lon: -73.5674,
        scheduledAt: '2026-10-05T08:00:00Z',
      },
      {
        id: 's2',
        kind: 'DELIVERY',
        stopOrder: 2,
        country: 'CA',
        region: 'ON',
        locality: 'Toronto',
        lat: 43.6532,
        lon: -79.3832,
        scheduledAt: null,
      },
    ],
    fixes: async () => [
      { lat: 45.5019, lon: -73.5674, at: '2026-10-05T08:45:00Z' },
      { lat: 45.6, lon: -73.4, at: '2026-10-05T10:15:00Z' },
      { lat: 43.75, lon: -79.35, at: '2026-10-05T14:00:00Z' },
    ],
  };
}

async function build() {
  return buildApp({
    env: ENV,
    deps: { tracking: new PrismaTrackingService(fakeRepo(), { secret: SECRET, appUrl: ENV.APP_URL }) },
  });
}

function token(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string, roles: JwtUser['roles'], driverId: string | null = null): string {
  const user: JwtUser = { sub: 'u1', tenantId, roles, driverId, type: 'access' };
  return app.jwt.sign(user);
}

describe('GET /api/track/:loadId/:token', () => {
  it('serves the milestones to anybody holding the link, with no session', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: `/api/track/load-a/${trackingToken('load-a', SECRET)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.status).toEqual({ code: 'IN_TRANSIT', label: 'In transit' });
    expect(body.lane).toBe('Montréal, QC to Toronto, ON');
    expect(body.headline).toBe('Nearing Toronto, ON (11 km out)');

    // Arrived and departed at the origin, then back on the road.
    expect(body.stops[0]).toMatchObject({
      place: 'Montréal, QC',
      arrivedAt: '2026-10-05T08:45:00Z',
      departedAt: '2026-10-05T10:15:00Z',
      dwellMinutes: 90,
      lateMinutes: 45,
    });
    expect(body.stops[1]).toMatchObject({ place: 'Toronto, ON', arrivedAt: null });

    // The live position travels rounded, never raw.
    expect(body.position).toEqual({ lat: 43.75, lon: -79.35, at: '2026-10-05T14:00:00Z' });
    await app.close();
  });

  it('carries nothing about the company, the money or the driver', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: `/api/track/load-a/${trackingToken('load-a', SECRET)}`,
    });
    const body = res.json();

    expect(Object.keys(body).sort()).toEqual([
      'current',
      'headline',
      'kmToCurrent',
      'lane',
      'position',
      'reference',
      'status',
      'stops',
      'updatedAt',
    ]);

    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('tenant-a');
    expect(serialised).not.toContain('driver-1');
    expect(serialised).not.toContain('asset-1');
    expect(serialised).not.toContain('freight');
    expect(serialised).not.toContain('Palletised');
    expect(serialised).not.toContain('18000');
    await app.close();
  });

  it('answers a tampered token exactly like an unknown load', async () => {
    const app = await build();
    const good = trackingToken('load-a', SECRET);
    const tampered = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;

    const wrongToken = await app.inject({ method: 'GET', url: `/api/track/load-a/${tampered}` });
    const wrongLoad = await app.inject({ method: 'GET', url: `/api/track/load-z/${good}` });
    const otherLoadsToken = await app.inject({
      method: 'GET',
      url: `/api/track/load-b/${trackingToken('load-a', SECRET)}`,
    });

    expect(wrongToken.statusCode).toBe(404);
    expect(wrongLoad.statusCode).toBe(404);
    // A token issued for one load is not a key to every load.
    expect(otherLoadsToken.statusCode).toBe(404);
    for (const res of [wrongToken, wrongLoad, otherLoadsToken]) {
      expect(res.json()).toEqual({ error: 'NOT_FOUND', message: 'this tracking link is not valid' });
    }
    await app.close();
  });
});

describe('GET /api/loads/:loadId/tracking', () => {
  it('gives the company its own view plus the link to forward', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/loads/load-a/tracking',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['DISPATCHER'])}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.loadId).toBe('load-a');
    expect(body.assigneeDriverId).toBe('driver-1');
    expect(body.current).toMatchObject({ stopId: 's2', place: 'Toronto, ON' });
    expect(body.link).toBe(`https://demo.loadwave.app/track/load-a/${trackingToken('load-a', SECRET)}`);
    await app.close();
  });

  it('lets the assigned driver look, and refuses a different driver', async () => {
    const app = await build();
    const mine = await app.inject({
      method: 'GET',
      url: '/api/loads/load-a/tracking',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['DRIVER'], 'driver-1')}` },
    });
    expect(mine.statusCode).toBe(200);

    const other = await app.inject({
      method: 'GET',
      url: '/api/loads/load-a/tracking',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['DRIVER'], 'driver-2')}` },
    });
    expect(other.statusCode).toBe(403);
    await app.close();
  });

  it('treats another company\'s load as if it did not exist', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/loads/load-b/tracking',
      headers: { authorization: `Bearer ${token(app, 'tenant-a', ['ADMIN'])}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('requires a session', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/loads/load-a/tracking' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
