import type { PrismaClient } from '@prisma/client';
import { quarterOf } from '../../utils/quarters';

export interface PeriodFilter {
  tenantId: string;
  assetId?: string | null;
  driverId?: string | null;
  /** inclusive */
  start: Date;
  /** exclusive */
  windowEnd: Date;
}

export interface BuildSegmentsInput extends PeriodFilter {
  gapMinutes?: number;
}

export interface JurisdictionAggregateRow {
  jurisdictionCode: string;
  totalKm: number;
  segmentCount: number;
}

export interface RouteGeometryService {
  buildSegmentsForPeriod(input: BuildSegmentsInput): Promise<number>;
  hasSegmentsInPeriod(input: PeriodFilter): Promise<boolean>;
  aggregateDistanceByJurisdiction(input: PeriodFilter): Promise<JurisdictionAggregateRow[]>;
}

interface SegmentInsertRow {
  id: string;
}

interface AggregateRow {
  jurisdictionCode: string;
  totalKm: string | number;
  segmentCount: number;
}

interface CountRow {
  cnt: number;
}

/**
 * True when Postgres refused the statement because PostGIS is not installed on
 * this database: 0A000 (feature not supported — CREATE EXTENSION / geometry),
 * 42883 (undefined_function — ST_*), 42704 (undefined_object — geometry type).
 */
export function isMissingPostgisError(error: unknown): boolean {
  const err = error as { code?: string; meta?: { code?: string; message?: string }; message?: string };
  const pgCode = err?.meta?.code ?? err?.code ?? '';
  const text = `${err?.meta?.message ?? ''} ${err?.message ?? ''}`;

  // 0A000: feature not supported (CREATE EXTENSION postgis / geometry ops).
  // 42704: type "geometry" does not exist.
  if (pgCode === '0A000' || pgCode === '42704') return true;
  // 42883 is "undefined function", which PostGIS causes for ST_* calls — but
  // it is also what a genuine SQL bug looks like, so require the message to
  // name the extension or an ST_ helper. Otherwise the bug stays visible.
  if (pgCode === '42883') return /postgis|\bST_[A-Za-z]/i.test(text);
  return /postgis/i.test(text);
}

/**
 * PostGIS-backed implementation.
 *
 * buildSegmentsForPeriod is idempotent for a (tenant, asset [, driver], window)
 * triple: it deletes the previous segments in the window and rebuilds them from
 * ordered route_points using ST_MakeLine, computes distance via
 * ST_Length(wkb::geography) / 1000, assigns a jurisdiction by intersecting each
 * segment centroid with JurisdictionBoundary polygons and stores a WKT copy.
 *
 * Run `npm run db:postgis` first to create the geometry column and the
 * JurisdictionBoundary table.
 */
export class PostgisRouteGeometryService implements RouteGeometryService {
  /**
   * Set once we have seen a missing-PostGIS error, so a database without the
   * extension does not pay an error round-trip per ingest. Route geometry is
   * an enhancement: ELD ingest and IFTA must keep working without it.
   */
  private postgisMissing = false;

  constructor(private readonly prisma: PrismaClient) {}

  /** Reports whether route geometry is unusable on this database. */
  get isPostgisMissing(): boolean {
    return this.postgisMissing;
  }

  async buildSegmentsForPeriod(input: BuildSegmentsInput): Promise<number> {
    if (this.postgisMissing) return 0;
    try {
      return await this.buildSegmentsNow(input);
    } catch (error) {
      if (!isMissingPostgisError(error)) throw error;
      this.postgisMissing = true;
      return 0;
    }
  }

  private async buildSegmentsNow(input: BuildSegmentsInput): Promise<number> {
    const gapMinutes = input.gapMinutes ?? 15;
    const quarter = quarterOf(input.start);
    const tenantId = input.tenantId;
    const assetId = input.assetId ?? null;
    const driverId = input.driverId ?? null;

    // Dates are bound as ISO strings, which Postgres sees as text: every
    // comparison against a timestamp column needs an explicit cast or the
    // statement fails with "operator does not exist: timestamp >= text".
    const deleteSql = `
      DELETE FROM "RouteSegment"
      WHERE "tenantId" = $1
        AND ($2::text IS NULL OR "assetId" = $2)
        AND ($3::text IS NULL OR "driverId" = $3)
        AND "startTime" >= $4::timestamp AND "startTime" < $5::timestamp`;

    const insertSql = `
      WITH tenant_param AS (
        SELECT $1::text AS tenant_id, $2::text AS asset_id, $3::text AS driver_id, $4::text AS quarter_label
      ),
      ordered AS (
        SELECT p."id", p."occurredAt",
               ST_SetSRID(ST_MakePoint(p."lon", p."lat"), 4326) AS pt
        FROM "RoutePoint" p, tenant_param t
        WHERE p."tenantId" = t.tenant_id
          AND (t.asset_id IS NULL OR p."assetId" = t.asset_id)
          AND (t.driver_id IS NULL OR p."driverId" = t.driver_id)
          AND p."occurredAt" >= $5::timestamp AND p."occurredAt" < $6::timestamp
        ORDER BY p."occurredAt"
      ),
      flagged AS (
        SELECT "id", "occurredAt", pt,
               CASE
                 WHEN lag("occurredAt") OVER (ORDER BY "occurredAt") IS NULL THEN 0
                 WHEN EXTRACT(EPOCH FROM ("occurredAt" - lag("occurredAt") OVER (ORDER BY "occurredAt"))) <= ${gapMinutes} * 60 THEN 0
                 ELSE 1
               END AS breaker
        FROM ordered
      ),
      seg AS (
        SELECT *, SUM(breaker) OVER (ORDER BY "occurredAt") AS seg_id
        FROM flagged
      ),
      lines AS (
        SELECT seg_id,
               min("occurredAt") AS start_time,
               max("occurredAt") AS end_time,
               count(*) AS n_points,
               ST_MakeLine(pt ORDER BY "occurredAt") AS geom
        FROM seg
        GROUP BY seg_id
      )
      INSERT INTO "RouteSegment"
        ("id", "tenantId", "assetId", "driverId", "startTime", "endTime",
         "distanceKm", "jurisdictionCode", "fuelType", "geomText", "geom", "quarter", "createdAt")
      SELECT gen_random_uuid(),
             t.tenant_id, t.asset_id, t.driver_id,
             l.start_time, l.end_time,
             -- ST_Length returns double precision, and Postgres has no
             -- ROUND(double precision, int): cast to numeric first.
             ROUND((COALESCE(ST_Length(l.geom::geography, true), 0) / 1000.0)::numeric, 4)::numeric(12,4),
             -- geom must be stored too: the jurisdiction lookup joins on it,
             -- and without it every segment keeps a null jurisdiction.
             NULL, 'DSL', ST_AsText(l.geom), l.geom, t.quarter_label, now()
      FROM lines l, tenant_param t
      WHERE l.n_points >= 2
      RETURNING id`;

    let rows: SegmentInsertRow[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        deleteSql,
        tenantId,
        assetId,
        driverId,
        input.start.toISOString(),
        input.windowEnd.toISOString(),
      );

      rows = await tx.$queryRawUnsafe<SegmentInsertRow[]>(
        insertSql,
        tenantId,
        assetId,
        driverId,
        quarter,
        input.start.toISOString(),
        input.windowEnd.toISOString(),
      );

      if (rows.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE "RouteSegment" rs
             SET "jurisdictionCode" = j.iso
             FROM (
               SELECT DISTINCT ON (r.id) r.id AS seg_id, b.iso
               FROM "RouteSegment" r
               JOIN "JurisdictionBoundary" b
                 ON r.geom IS NOT NULL AND ST_Intersects(ST_Centroid(r.geom), b.geom)
               WHERE r."tenantId" = $1
                 AND ($2::text IS NULL OR r."assetId" = $2)
                 AND r."startTime" >= $3::timestamp AND r."startTime" < $4::timestamp
               ORDER BY r.id, ST_Area(ST_Intersection(ST_Centroid(r.geom), b.geom)) DESC
             ) j
             WHERE rs.id = j.seg_id`,
          tenantId,
          assetId,
          input.start.toISOString(),
          input.windowEnd.toISOString(),
        );
      }
    });

    return rows.length;
  }

  async hasSegmentsInPeriod(input: PeriodFilter): Promise<boolean> {
    if (this.postgisMissing) return false;
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::int AS cnt
         FROM "RouteSegment"
         WHERE "tenantId" = $1
           AND ($2::text IS NULL OR "assetId" = $2)
           AND ($3::text IS NULL OR "driverId" = $3)
           AND "startTime" >= $4::timestamp AND "startTime" < $5::timestamp`,
      input.tenantId,
      input.assetId ?? null,
      input.driverId ?? null,
      input.start.toISOString(),
      input.windowEnd.toISOString(),
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  async aggregateDistanceByJurisdiction(input: PeriodFilter): Promise<JurisdictionAggregateRow[]> {
    // No extension: distances by jurisdiction are simply unknown, and IFTA
    // still reports the fuel it can see rather than failing the whole compute.
    if (this.postgisMissing) return [];
    const rows = await this.prisma.$queryRawUnsafe<AggregateRow[]>(
      `SELECT COALESCE("jurisdictionCode", 'UNK') AS "jurisdictionCode",
              COALESCE(SUM("distanceKm"), 0)::numeric(20,4) AS "totalKm",
              COUNT(*)::int AS "segmentCount"
       FROM "RouteSegment"
       WHERE "tenantId" = $1
         AND ($2::text IS NULL OR "assetId" = $2)
         AND ($3::text IS NULL OR "driverId" = $3)
         AND "startTime" >= $4::timestamp AND "startTime" < $5::timestamp
       GROUP BY 1 ORDER BY 1`,
      input.tenantId,
      input.assetId ?? null,
      input.driverId ?? null,
      input.start.toISOString(),
      input.windowEnd.toISOString(),
    );
    return rows.map((r) => ({
      jurisdictionCode: r.jurisdictionCode,
      totalKm: Number(r.totalKm),
      segmentCount: r.segmentCount ?? 0,
    }));
  }
}
