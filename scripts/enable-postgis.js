#!/usr/bin/env node
// Enables PostGIS + geometry column + jurisdiction lookup table on the DB.
// Run via `npm run db:postgis`. Safe to run multiple times.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS postgis;');
    await prisma.$executeRawUnsafe(
      // Add geometry column if not present.
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='route_segment' AND column_name='geom'
        ) THEN
          ALTER TABLE "RouteSegment" ADD COLUMN geom geometry(LineString, 4326);
        END IF;
      END$$;`,
    );

    // Jurisdiction polygons table for PostGIS intersection.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "JurisdictionBoundary" (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        country      TEXT NOT NULL,
        iso          TEXT NOT NULL,
        geom          geometry(MultiPolygon, 4326) NOT NULL
      );
    `);

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS route_segment_geom_idx ON "RouteSegment" USING GIST (geom);`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS jurisdiction_boundary_geom_idx ON "JurisdictionBoundary" USING GIST (geom);`,
    );

    console.log('PostGIS enabled, RouteSegment.geom + JurisdictionBoundary ready.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
