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
  constructor(private readonly prisma: PrismaClient) {}

  async buildSegmentsForPeriod(input: BuildSegmentsInput): Promise<number> {
    const gapMinutes = input.gapMinutes ?? 15;
    const quarter = quarterOf(input.start);
    const tenantId = input.tenantId;
    const assetId = input.assetId ?? null;
    const driverId = input.driverId ?? null;

    const deleteSql = `
      DELETE FROM "RouteSegment"
      WHERE "tenantId" = $1
        AND ($2::text IS NULL OR "assetId" = $2)
        AND ($3::text IS NULL OR "driverId" = $3)
        AND "startTime" >= $4 AND "startTime" < $5`;

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
          AND p."occurredAt" >= $5 AND p."occurredAt" < $6
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
         "distanceKm", "jurisdictionCode", "fuelType", "geomText", "quarter", "createdAt")
      SELECT gen_random_uuid(),
             t.tenant_id, t.asset_id, t.driver_id,
             l.start_time, l.end_time,
             ROUND(COALESCE(ST_Length(l.geom::geography, true), 0) / 1000.0, 4)::numeric(12,4),
             NULL, 'DSL', ST_AsText(l.geom), t.quarter_label, now()
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
                 AND r."startTime" >= $3 AND r."startTime" < $4
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
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::int AS cnt
         FROM "RouteSegment"
         WHERE "tenantId" = $1
           AND ($2::text IS NULL OR "assetId" = $2)
           AND ($3::text IS NULL OR "driverId" = $3)
           AND "startTime" >= $4 AND "startTime" < $5`,
      input.tenantId,
      input.assetId ?? null,
      input.driverId ?? null,
      input.start.toISOString(),
      input.windowEnd.toISOString(),
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  async aggregateDistanceByJurisdiction(input: PeriodFilter): Promise<JurisdictionAggregateRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<AggregateRow[]>(
      `SELECT COALESCE("jurisdictionCode", 'UNK') AS "jurisdictionCode",
              COALESCE(SUM("distanceKm"), 0)::numeric(20,4) AS "totalKm",
              COUNT(*)::int AS "segmentCount"
       FROM "RouteSegment"
       WHERE "tenantId" = $1
         AND ($2::text IS NULL OR "assetId" = $2)
         AND ($3::text IS NULL OR "driverId" = $3)
         AND "startTime" >= $4 AND "startTime" < $5
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
