import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaLoadService } from '../src/modules/invoicing/load.service';
import { PrismaImportService, type ExternalLoadInput } from '../src/modules/import/import.service';
import { EventBus } from '../src/events/event-bus';

/**
 * CLI loader for external load board JSON/CSV.
 *
 * Usage:
 *   npm run import:loads -- path/to/loads.json
 *   npm run import:loads -- path/to/loads.csv
 *
 * JSON: an array of load objects (see scripts/data/loads.sample.json).
 * CSV: headers externalLoadboardId,originCountry,originRegion,destinationCountry,
 *      destinationRegion,equipmentType,freightAmountTransaction
 */
async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run import:loads -- <file.json|file.csv>');
    process.exit(2);
  }
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    console.error('Set TENANT_ID env var to the target tenant.');
    process.exit(2);
  }

  const raw = readFileSync(file, 'utf8').trim();
  const isCsv = file.toLowerCase().endsWith('.csv');
  const items: ExternalLoadInput[] = isCsv ? parseCsv(raw) : (JSON.parse(raw) as ExternalLoadInput[]);

  const prisma = new PrismaClient();
  try {
    const loads = new PrismaLoadService(prisma, new EventBus());
    const importer = new PrismaImportService(prisma, loads);
    const result = await importer.importLoads(tenantId, items);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function parseCsv(raw: string): ExternalLoadInput[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const [header, ...rows] = lines;
  const cols = header.split(',').map((c) => c.trim());
  return rows.map((line) => {
    const v = line.split(',').map((c) => c.trim());
    const o: Record<string, string> = {};
    cols.forEach((c, i) => {
      o[c] = v[i] ?? '';
    });
    const n = (x: string): number | undefined => (x ? Number(x) : undefined);
    return {
      externalLoadboardId: o.externalLoadboardId,
      originCountry: o.originCountry,
      originRegion: o.originRegion,
      destinationCountry: o.destinationCountry,
      destinationRegion: o.destinationRegion,
      equipmentType: o.equipmentType || undefined,
      freightCurrency: o.freightCurrency || 'CAD',
      freightAmountTransaction: n(o.freightAmountTransaction),
      distanceKmEstimate: o.distanceKmEstimate ? n(o.distanceKmEstimate) : undefined,
      marketplaceStatus: (o.marketplaceStatus as 'PRIVATE' | 'PUBLIC') || 'PRIVATE',
    };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});