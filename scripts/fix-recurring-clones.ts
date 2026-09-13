import { PrismaClient } from '@prisma/client';

/**
 * Repairs data left by the recurring-load bug.
 *
 * `runRecurrenceSweep` used to copy `recurringDays` onto every clone it made, so
 * each weekly occurrence started a series of its own and the tenant's board
 * doubled every week. The code is fixed; this clears the copied schedule off the
 * duplicates so they stay one-off loads.
 *
 * A "series head" is a load with a recurrence. Real series heads are unique per
 * (tenant, lane, schedule, freight) — anything beyond the oldest in a group is a
 * clone that should never have been scheduled. The oldest stays recurring; the
 * rest keep the load but lose the schedule.
 *
 * Dry run by default. Pass --apply to write. Idempotent.
 *
 *   npx tsx scripts/fix-recurring-clones.ts
 *   npx tsx scripts/fix-recurring-clones.ts --apply
 */

interface SeriesRow {
  id: string;
  tenantId: string;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  recurringDays: string | null;
  freightCurrency: string;
  freightAmountTransaction: unknown;
  createdAt: Date;
}

function seriesKey(r: SeriesRow): string {
  return [
    r.tenantId,
    r.originCountry,
    r.originRegion,
    r.destinationCountry,
    r.destinationRegion,
    r.recurringDays,
    r.freightCurrency,
    r.freightAmountTransaction == null ? '' : String(r.freightAmountTransaction),
  ].join('|');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const rows = (await prisma.load.findMany({
      where: { recurringDays: { not: null } },
      select: {
        id: true,
        tenantId: true,
        originCountry: true,
        originRegion: true,
        destinationCountry: true,
        destinationRegion: true,
        recurringDays: true,
        freightCurrency: true,
        freightAmountTransaction: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as SeriesRow[];

    const groups = new Map<string, SeriesRow[]>();
    for (const r of rows) {
      const key = seriesKey(r);
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }

    const demote: SeriesRow[] = [];
    for (const list of groups.values()) {
      // list is oldest-first, so the head is the true recurring load.
      demote.push(...list.slice(1));
    }

    console.log(`Recurring loads on file: ${rows.length}`);
    console.log(`Series with duplicates:  ${[...groups.values()].filter((g) => g.length > 1).length}`);
    console.log(`Clones to de-schedule:   ${demote.length}`);
    for (const r of demote.slice(0, 20)) {
      console.log(
        `  ${r.id}  ${r.originRegion}→${r.destinationRegion}  every ${r.recurringDays}  (kept as a one-off load)`,
      );
    }
    if (demote.length > 20) console.log(`  … and ${demote.length - 20} more`);

    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --apply to de-schedule them.');
      return;
    }
    if (demote.length === 0) {
      console.log('\nNothing to fix.');
      return;
    }

    const result = await prisma.load.updateMany({
      where: { id: { in: demote.map((r) => r.id) } },
      data: { recurringDays: null, nextRecurrenceAt: null },
    });
    console.log(`\nDe-scheduled ${result.count} cloned loads.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
