/**
 * PostGIS verification — proves GPS points become route segments with the
 * right jurisdiction and plausible distances, and that IFTA aggregation
 * reports them per jurisdiction.
 *
 * It needs a database that HAS PostGIS and that you are happy to write fixture
 * rows into. It never touches DATABASE_URL by default:
 *
 *   GEO_VERIFY_DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public" \
 *     npm run verify:postgis
 *
 * Only its own fixture tenant (a fixed UUID) is written and deleted, so it is
 * safe to run against a shared database.
 *
 * A one-off PostGIS for a local check:
 *   docker run -d --name loadwave-postgis -p 55432:5432 \
 *     -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
 *     -e POSTGRES_DB=loadwave_geo postgis/postgis:16-3.4
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:55432/loadwave_geo?schema=public" npx prisma db push
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:55432/loadwave_geo?schema=public" npm run db:postgis
 */
import { PrismaClient } from '@prisma/client';
import { PostgisRouteGeometryService } from '../src/modules/postgis/postgis.service';
import { haversineKm } from '../src/modules/geo/haversine';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DRIVER = '22222222-2222-2222-2222-222222222222';
const ASSET = '33333333-3333-3333-3333-333333333333';

/** Two adjacent rectangles split at lon -74.6: QC to the east, ON to the west. */
const BOUNDARIES = [
  { id: 'fffffff1-1111-1111-1111-111111111111', name: 'Verify QC', iso: 'QC', poly: 'SRID=4326;MULTIPOLYGON(((-74.6 45.0, -72.5 45.0, -72.5 46.5, -74.6 46.5, -74.6 45.0)))' },
  { id: 'fffffff2-1111-1111-1111-111111111111', name: 'Verify ON', iso: 'ON', poly: 'SRID=4326;MULTIPOLYGON(((-76.5 45.0, -74.6 45.0, -74.6 46.5, -76.5 46.5, -76.5 45.0)))' },
];

/** Montréal → Ottawa with a one-hour stop in the middle. */
const POINTS = [
  { at: '2026-03-02T08:00:00Z', lat: 45.5019, lon: -73.5674 }, // Montréal (QC)
  { at: '2026-03-02T08:05:00Z', lat: 45.47, lon: -74.3 }, // still QC
  { at: '2026-03-02T09:05:00Z', lat: 45.45, lon: -75.0 }, // after the stop, in ON
  { at: '2026-03-02T09:10:00Z', lat: 45.4215, lon: -75.6972 }, // Ottawa (ON)
];

const ok = (m: string): void => console.log(`ok   ${m}`);
const bad = (m: string): void => {
  console.log(`FAIL ${m}`);
  process.exitCode = 1;
};

type SegRow = { jurisdictionCode: string | null; distanceKm: unknown; quarter: string | null; geom: boolean };

async function main(): Promise<void> {
  const url = process.env.GEO_VERIFY_DATABASE_URL;
  if (!url) {
    console.error(
      'Set GEO_VERIFY_DATABASE_URL to a database WITH PostGIS (this script writes and removes its own fixture rows).',
    );
    process.exit(2);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const start = new Date('2026-03-02T07:00:00Z');
    const windowEnd = new Date('2026-03-02T11:00:00Z');

    // Fixture-scoped cleanup: never truncate a shared table.
    await prisma.load.deleteMany({ where: { tenantId: TENANT } });
    await prisma.routeSegment.deleteMany({ where: { tenantId: TENANT } });
    await prisma.routePoint.deleteMany({ where: { tenantId: TENANT } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "JurisdictionBoundary" WHERE id = ANY($1::text[])`,
      BOUNDARIES.map((b) => b.id),
    );

    await prisma.tenant.create({ data: { id: TENANT, name: 'PostGIS Verify' } });
    await prisma.driver.create({ data: { id: DRIVER, tenantId: TENANT, name: 'Verify Driver', licenseNumber: 'L-VERIFY' } });
    await prisma.asset.create({ data: { id: ASSET, tenantId: TENANT, assetType: 'TRACTOR', powerUnitNumber: 'PU-VERIFY' } });

    for (const b of BOUNDARIES) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "JurisdictionBoundary" (id, name, country, iso, geom) VALUES ($1,$2,$3,$4, ST_GeomFromEWKT($5))`,
        b.id,
        b.name,
        'CA',
        b.iso,
        b.poly,
      );
    }
    ok(`seeded ${BOUNDARIES.length} jurisdiction polygons`);

    for (const p of POINTS) {
      await prisma.routePoint.create({
        data: { tenantId: TENANT, driverId: DRIVER, assetId: ASSET, occurredAt: new Date(p.at), lat: p.lat, lon: p.lon },
      });
    }
    ok(`seeded ${POINTS.length} GPS points with a 60-minute stop mid-route`);

    const geometry = new PostgisRouteGeometryService(prisma as never);
    if (geometry.isPostgisMissing) {
      bad('PostGIS reported as missing on this database — run `npm run db:postgis` first');
      return;
    }

    const built = await geometry.buildSegmentsForPeriod({
      tenantId: TENANT,
      assetId: ASSET,
      driverId: DRIVER,
      start,
      windowEnd,
      gapMinutes: 15,
    });
    if (built === 2) ok(`built ${built} segments (the stop breaks the run in two)`);
    else bad(`expected 2 segments, got ${built}`);

    const segments = await prisma.$queryRawUnsafe<SegRow[]>(
      `SELECT "jurisdictionCode", "distanceKm", "quarter", geom IS NOT NULL AS geom
         FROM "RouteSegment" WHERE "tenantId" = $1 ORDER BY "startTime"`,
      TENANT,
    );
    console.log(
      '     segments:',
      JSON.stringify(segments.map((s) => ({ jurisdiction: s.jurisdictionCode, km: Number(s.distanceKm), geom: s.geom }))),
    );

    const codes = segments.map((s) => s.jurisdictionCode);
    if (codes[0] === 'QC' && codes[1] === 'ON') ok('each segment lands in the right jurisdiction (QC then ON)');
    else bad(`jurisdiction lookup wrong: ${JSON.stringify(codes)}`);

    if (segments.length === 2 && segments.every((s) => s.geom)) ok('the geometry column is populated (jurisdiction lookup depends on it)');
    else bad('a segment has no geometry stored');

    // Compare against the legs actually driven inside each segment. The stop
    // in the middle is deliberately not counted — that is the gap rule.
    const expected = haversineKm(POINTS[0], POINTS[1]) + haversineKm(POINTS[2], POINTS[3]);
    const total = segments.reduce((sum, s) => sum + Number(s.distanceKm), 0);
    const drift = expected > 0 ? Math.abs(total - expected) / expected : 1;
    if (drift < 0.05) ok(`total ${total.toFixed(1)} km matches the driven legs (${expected.toFixed(1)} km, ${(drift * 100).toFixed(1)}% drift)`);
    else bad(`total ${total.toFixed(1)} km does not match the driven legs (${expected.toFixed(1)} km)`);

    const agg = await geometry.aggregateDistanceByJurisdiction({ tenantId: TENANT, assetId: ASSET, start, windowEnd });
    console.log('     aggregate:', JSON.stringify(agg));
    const byCode = new Map(agg.map((a) => [a.jurisdictionCode, a.totalKm]));
    if (agg.length === 2 && (byCode.get('QC') ?? 0) > 0 && (byCode.get('ON') ?? 0) > 0) {
      ok('IFTA aggregation splits distance by jurisdiction');
    } else {
      bad(`aggregation did not produce QC + ON distances: ${JSON.stringify(agg)}`);
    }

    if (await geometry.hasSegmentsInPeriod({ tenantId: TENANT, assetId: ASSET, start, windowEnd })) {
      ok('hasSegmentsInPeriod sees them (IFTA reuses instead of rebuilding)');
    } else {
      bad('hasSegmentsInPeriod returned false');
    }

    const again = await geometry.buildSegmentsForPeriod({
      tenantId: TENANT,
      assetId: ASSET,
      driverId: DRIVER,
      start,
      windowEnd,
      gapMinutes: 15,
    });
    const stored = await prisma.routeSegment.count({ where: { tenantId: TENANT } });
    if (again === 2 && stored === 2) ok('rebuilding is idempotent — no duplicate segments');
    else bad(`rebuild produced ${again} rows / ${stored} stored`);
  } finally {
    await prisma.routeSegment.deleteMany({ where: { tenantId: TENANT } });
    await prisma.routePoint.deleteMany({ where: { tenantId: TENANT } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM "JurisdictionBoundary" WHERE id = ANY($1::text[])`,
      BOUNDARIES.map((b) => b.id),
    );
    await prisma.$disconnect();
  }
}

void main()
  .then(() => {
    console.log(process.exitCode ? '\nPOSTGIS VERIFY FAILED' : '\nPOSTGIS VERIFY PASSED');
    process.exit(process.exitCode ?? 0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
