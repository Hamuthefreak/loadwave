import { PrismaClient } from '@prisma/client';
import { PLACES, type PlaceRow } from './data/places';

/**
 * Seeds PostalPlace rows used by radius/locality search (Canada + US).
 * Run via `npm run db:seed-places`. Safe to run multiple times (upsert).
 * Each postal prefix in a row becomes its own PostalPlace entry so prefix
 * lookups (FSA / ZIP) resolve to a real coordinate.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const rows: PlaceRow[] = [];
    for (const [country, region, placeName, lat, lon, population, prefixes] of PLACES) {
      const list = prefixes.length > 0 ? prefixes : [''];
      for (const prefix of list) {
        rows.push([country, region, placeName, lat, lon, population, [prefix]]);
      }
    }

    const created = await prisma.$transaction(
      rows.map(([country, region, placeName, lat, lon, population, prefixes]) =>
        prisma.postalPlace.upsert({
          where: {
            country_region_placeName_postalPrefix: {
              country,
              region,
              placeName,
              postalPrefix: prefixes[0] ?? '',
            },
          },
          update: { lat, lon, population },
          create: {
            country,
            region,
            placeName,
            lat,
            lon,
            population,
            postalPrefix: prefixes[0] ?? '',
          },
        }),
      ),
    );
    console.log(`Seeded ${created.length} postal places.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});