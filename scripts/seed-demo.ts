import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

/**
 * Seeds a demo tenant with loads, trucks, drivers, assets and fuel so the
 * dashboard and board show real content. Run via `npm run db:seed-demo`.
 * Creates a fresh tenant each run (suffix included) to keep it idempotent.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const stamp = Date.now().toString().slice(-6);
    const email = process.env.DEMO_EMAIL ?? `demo${stamp}@loadboard.app`;
    const password = process.env.DEMO_PASSWORD ?? 'DemoPass123!';
    const tenantName = process.env.DEMO_TENANT ?? `Demo Carrier ${stamp}`;

    const passwordHash = await hash(password, 10);

    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName,
        baseCurrency: 'CAD',
        baseJurisdiction: 'QC',
        mcNumber: `MC${stamp}`,
        usdotNumber: `USDOT${stamp}`,
        users: {
          create: [
            { email, passwordHash, roles: 'ADMIN,DISPATCHER' },
            { email: `driver${stamp}@loadboard.app`, passwordHash, roles: 'DRIVER' },
          ],
        },
      },
    });

    const [driverA, driverB] = await Promise.all([
      prisma.driver.create({
        data: { tenantId: tenant.id, name: 'Alex Tremblay', licenseNumber: 'L-1001', cycleType: 'CYCLE_1', externalEldId: 'ELD-A001' },
      }),
      prisma.driver.create({
        data: { tenantId: tenant.id, name: 'Maria Chen', licenseNumber: 'L-1002', cycleType: 'CYCLE_2', externalEldId: 'ELD-A002' },
      }),
    ]);

    // Link the demo DRIVER login to Maria Chen — she carries the private load
    // seeded below, so signing in as the driver shows My Trips immediately.
    await prisma.user.update({
      where: { email: `driver${stamp}@loadboard.app` },
      data: { driverId: driverB.id },
    });

    const tractor = await prisma.asset.create({
      data: { tenantId: tenant.id, assetType: 'TRACTOR', powerUnitNumber: 'PU-100', vin: '1HDT12345STAMP01', eldDeviceId: 'ELD-A001' },
    });

    const now = new Date();

    type DemoLoad = {
      originCountry: string;
      originRegion: string;
      originLocality: string;
      originLat: number;
      originLon: number;
      destinationCountry: string;
      destinationRegion: string;
      destinationLocality: string;
      destinationLat: number;
      destinationLon: number;
      equipmentType: string;
      pickupDate: Date;
      deliveryDate: Date;
      distanceKmEstimate: number;
      freightCurrency: string;
      freightAmountTransaction: number;
      commodity?: string;
      weightKg?: number;
      hazmat?: boolean;
      temperatureMin?: number;
      temperatureMax?: number;
      marketplaceStatus: 'PRIVATE' | 'PUBLIC';
      status: string;
      assignDriver?: boolean;
    };

    const loads: DemoLoad[] = [
      {
        originCountry: 'CA', originRegion: 'QC', originLocality: 'Montréal', originLat: 45.5019, originLon: -73.5674,
        destinationCountry: 'US', destinationRegion: 'NY', destinationLocality: 'New York City', destinationLat: 40.7128, destinationLon: -74.006,
        equipmentType: 'DRY_VAN', pickupDate: addDays(now, 1), deliveryDate: addDays(now, 2),
        distanceKmEstimate: 590, freightCurrency: 'USD', freightAmountTransaction: 2250,
        commodity: 'Auto parts', weightKg: 18000, marketplaceStatus: 'PUBLIC', status: 'OPEN',
      },
      {
        originCountry: 'CA', originRegion: 'ON', originLocality: 'Toronto', originLat: 43.6532, originLon: -79.3832,
        destinationCountry: 'US', destinationRegion: 'MI', destinationLocality: 'Detroit', destinationLat: 42.3314, destinationLon: -83.0458,
        equipmentType: 'REEFER', pickupDate: addDays(now, 1), deliveryDate: addDays(now, 3),
        distanceKmEstimate: 380, freightCurrency: 'USD', freightAmountTransaction: 1450,
        commodity: 'Pharmaceuticals', temperatureMin: 2, temperatureMax: 8, weightKg: 9000, marketplaceStatus: 'PUBLIC', status: 'OPEN',
      },
      {
        originCountry: 'US', originRegion: 'IL', originLocality: 'Chicago', originLat: 41.8781, originLon: -87.6298,
        destinationCountry: 'CA', destinationRegion: 'ON', destinationLocality: 'Toronto', destinationLat: 43.6532, destinationLon: -79.3832,
        equipmentType: 'FLATBED', pickupDate: addDays(now, 2), deliveryDate: addDays(now, 5),
        distanceKmEstimate: 760, freightCurrency: 'USD', freightAmountTransaction: 2680,
        commodity: 'Machinery', weightKg: 12000, hazmat: true, marketplaceStatus: 'PUBLIC', status: 'OPEN',
      },
      {
        originCountry: 'CA', originRegion: 'QC', originLocality: 'Québec', originLat: 46.8139, originLon: -71.208,
        destinationCountry: 'CA', destinationRegion: 'ON', destinationLocality: 'Ottawa', destinationLat: 45.4215, destinationLon: -75.6972,
        equipmentType: 'DRY_VAN', pickupDate: addDays(now, 1), deliveryDate: addDays(now, 2),
        distanceKmEstimate: 420, freightCurrency: 'CAD', freightAmountTransaction: 980,
        commodity: 'Mail & parcels', weightKg: 6000, marketplaceStatus: 'PRIVATE', status: 'OPEN', assignDriver: true,
      },
    ];

    for (let i = 0; i < loads.length; i++) {
      const l = loads[i];
      const driver = l.assignDriver ? (i % 2 === 0 ? driverA : driverB) : null;
      await prisma.load.create({
        data: {
          tenantId: tenant.id,
          originCountry: l.originCountry,
          originRegion: l.originRegion,
          originLocality: l.originLocality,
          originLat: l.originLat,
          originLon: l.originLon,
          destinationCountry: l.destinationCountry,
          destinationRegion: l.destinationRegion,
          destinationLocality: l.destinationLocality,
          destinationLat: l.destinationLat,
          destinationLon: l.destinationLon,
          equipmentType: l.equipmentType,
          pickupDate: l.pickupDate,
          deliveryDate: l.deliveryDate,
          distanceKmEstimate: String(l.distanceKmEstimate),
          commodity: l.commodity ?? null,
          weightKg: l.weightKg != null ? String(l.weightKg) : null,
          hazmat: l.hazmat ?? false,
          temperatureMin: l.temperatureMin ?? null,
          temperatureMax: l.temperatureMax ?? null,
          freightCurrency: l.freightCurrency,
          freightAmountTransaction: String(l.freightAmountTransaction),
          freightAmountBase: String(
            l.freightCurrency === 'CAD'
              ? l.freightAmountTransaction
              : Math.round(l.freightAmountTransaction * 1.36),
          ),
          isInternational: l.originCountry !== l.destinationCountry,
          status: l.status,
          marketplaceStatus: l.marketplaceStatus,
          assigneeDriverId: driver?.id ?? null,
          assigneeAssetId: driver ? tractor.id : null,
          assignedAt: driver ? now : null,
        },
      });
    }

    await prisma.truckPost.createMany({
      data: [
        {
          tenantId: tenant.id,
          equipmentType: 'DRY_VAN',
          trailerType: '53ft dry van',
          locationCountry: 'CA',
          locationRegion: 'QC',
          locationLocality: 'Montréal',
          locationLat: 45.5019,
          locationLon: -73.5674,
          availableFrom: new Date(),
          availableTo: addDays(now, 10),
          rateCurrency: 'CAD',
          rateAmount: 1800,
          notes: 'Available after delivery in Montreal',
        },
        {
          tenantId: tenant.id,
          equipmentType: 'REEFER',
          trailerType: '53ft reefer',
          locationCountry: 'US',
          locationRegion: 'NY',
          locationLocality: 'Buffalo',
          locationLat: 42.8864,
          locationLon: -78.8784,
          availableFrom: new Date(),
          availableTo: addDays(now, 7),
          rateCurrency: 'USD',
          rateAmount: 2100,
          notes: 'Reefer with backup unit, 2-8C',
        },
      ],
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const laneStats = [
      { statDate: today, originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 4, trucksSeen: 3, avgRate: 2100 },
      { statDate: today, originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 3, trucksSeen: 5, avgRate: 1450 },
      { statDate: addDays(today, -1), originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 2, trucksSeen: 4, avgRate: 1990 },
      { statDate: addDays(today, -1), originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 2, trucksSeen: 3, avgRate: 1400 },
      { statDate: addDays(today, -2), originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 3, trucksSeen: 2, avgRate: 1950 },
      { statDate: addDays(today, -2), originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 1, trucksSeen: 2, avgRate: 1380 },
    ];

    // Upsert so the seed is idempotent even when the market worker has
    // already snapshotted today's lane stats.
    for (const row of laneStats) {
      await prisma.laneDailyStat.upsert({
        where: {
          statDate_originRegion_destinationRegion_equipmentType: {
            statDate: row.statDate,
            originRegion: row.originRegion,
            destinationRegion: row.destinationRegion,
            equipmentType: row.equipmentType,
          },
        },
        update: { loadsSeen: row.loadsSeen, trucksSeen: row.trucksSeen, avgRate: row.avgRate },
        create: row,
      });
    }

    console.log('Demo tenant seeded:');
    console.log(`  Tenant:   ${tenantName}`);
    console.log(`  Admin:    ${email}`);
    console.log(`  Driver:   driver${stamp}@loadboard.app`);
    console.log(`  Password: ${password}`);
    console.log(`  Board loads: ${loads.length} · Trucks: 2 · Drivers: 2 · Assets: 1`);

    // -------------------------------------------------------------------
    // Partner carrier: the board hides your own loads (you can't book
    // them), so a fresh demo tenant would see an empty marketplace without
    // a second tenant posting PUBLIC loads on overlapping lanes.
    // -------------------------------------------------------------------
    // Reuse the partner tenant across runs: re-seeding must not keep adding
    // "Northline Partners" (and its loads) to the shared marketplace.
    const existingPartner = await prisma.tenant.findFirst({
      where: { name: 'Northline Partners' },
      select: { id: true },
    });
    const partnerStamp = Date.now().toString().slice(-6);
    const partner =
      existingPartner ??
      (await prisma.tenant.create({
        data: {
          name: 'Northline Partners',
          baseCurrency: 'CAD',
          baseJurisdiction: 'ON',
          mcNumber: `MC${partnerStamp}`,
          usdotNumber: `USDOT${partnerStamp}`,
          ratingAvg: 4.5,
          ratingCount: 2,
          users: {
            create: [
              // A login on the partner tenant so demos can negotiate from both
              // sides of the board (poster ↔ booker rate messages).
              { email: `partner${partnerStamp}@loadboard.app`, passwordHash, roles: 'ADMIN,DISPATCHER' },
            ],
          },
        },
        select: { id: true },
      }));

    // Give the existing partner a login too, so an earlier seed leaves a
    // usable poster account behind.
    const partnerUser =
      (await prisma.user.findFirst({ where: { tenantId: partner.id }, select: { id: true } })) ??
      (await prisma.user.create({
        data: {
          tenantId: partner.id,
          email: `partner${partnerStamp}@loadboard.app`,
          passwordHash,
          roles: 'ADMIN,DISPATCHER',
        },
        select: { id: true },
      }));
    void partnerUser;

    // Aggregate ratings live on the tenant row (CarrierRating rows need a
    // real delivered load); the board UI reads the aggregates.

    const partnerLoads = [
      {
        originCountry: 'CA', originRegion: 'QC', originLocality: 'Montréal', originLat: 45.5019, originLon: -73.5674,
        destinationCountry: 'CA', destinationRegion: 'ON', destinationLocality: 'Ottawa', destinationLat: 45.4215, destinationLon: -75.6972,
        equipmentType: 'DRY_VAN', pickupDate: addDays(now, 1), deliveryDate: addDays(now, 2),
        distanceKmEstimate: 420, freightCurrency: 'CAD', freightAmountTransaction: 1050,
        commodity: 'Retail goods', weightKg: 14000, postedHoursAgo: 3,
      },
      {
        originCountry: 'CA', originRegion: 'QC', originLocality: 'Québec', originLat: 46.8139, originLon: -71.208,
        destinationCountry: 'CA', destinationRegion: 'ON', destinationLocality: 'Kingston', destinationLat: 44.2312, destinationLon: -76.486,
        equipmentType: 'REEFER', pickupDate: addDays(now, 2), deliveryDate: addDays(now, 3),
        distanceKmEstimate: 400, freightCurrency: 'CAD', freightAmountTransaction: 1180,
        commodity: 'Frozen food', temperatureMin: -18, temperatureMax: -12, weightKg: 11000, postedHoursAgo: 7,
      },
      {
        originCountry: 'CA', originRegion: 'ON', originLocality: 'Toronto', originLat: 43.6532, originLon: -79.3832,
        destinationCountry: 'CA', destinationRegion: 'QC', destinationLocality: 'Montréal', destinationLat: 45.5019, destinationLon: -73.5674,
        equipmentType: 'DRY_VAN', pickupDate: addDays(now, 1), deliveryDate: addDays(now, 2),
        distanceKmEstimate: 540, freightCurrency: 'CAD', freightAmountTransaction: 890,
        commodity: 'Building supplies', weightKg: 16000, postedHoursAgo: 26,
      },
      {
        originCountry: 'CA', originRegion: 'QC', originLocality: 'Montréal', originLat: 45.5019, originLon: -73.5674,
        destinationCountry: 'US', destinationRegion: 'NY', destinationLocality: 'New York City', destinationLat: 40.7128, destinationLon: -74.006,
        equipmentType: 'DRY_VAN', pickupDate: addDays(now, 3), deliveryDate: addDays(now, 4),
        distanceKmEstimate: 590, freightCurrency: 'USD', freightAmountTransaction: 2350,
        commodity: 'Consumer electronics', weightKg: 9000, postedHoursAgo: 1,
      },
    ];

    // Only the first run populates the partner board — re-seeding reuses what
    // is already there instead of filling the marketplace with duplicates.
    const partnerBoardLoads = await prisma.load.count({
      where: { tenantId: partner.id, marketplaceStatus: 'PUBLIC' },
    });

    for (const l of partnerLoads) {
      if (partnerBoardLoads > 0) break;
      await prisma.load.create({
        data: {
          tenantId: partner.id,
          originCountry: l.originCountry,
          originRegion: l.originRegion,
          originLocality: l.originLocality,
          originLat: l.originLat,
          originLon: l.originLon,
          destinationCountry: l.destinationCountry,
          destinationRegion: l.destinationRegion,
          destinationLocality: l.destinationLocality,
          destinationLat: l.destinationLat,
          destinationLon: l.destinationLon,
          equipmentType: l.equipmentType,
          pickupDate: l.pickupDate,
          deliveryDate: l.deliveryDate,
          distanceKmEstimate: String(l.distanceKmEstimate),
          commodity: l.commodity ?? null,
          weightKg: l.weightKg != null ? String(l.weightKg) : null,
          temperatureMin: l.temperatureMin ?? null,
          temperatureMax: l.temperatureMax ?? null,
          freightCurrency: l.freightCurrency,
          freightAmountTransaction: String(l.freightAmountTransaction),
          freightAmountBase: String(
            l.freightCurrency === 'CAD' ? l.freightAmountTransaction : Math.round(l.freightAmountTransaction * 1.36),
          ),
          isInternational: l.originCountry !== l.destinationCountry,
          status: 'OPEN',
          marketplaceStatus: 'PUBLIC',
          createdAt: new Date(now.getTime() - l.postedHoursAgo * 3600_000),
        },
      });
    }

    console.log(
      partnerBoardLoads > 0
        ? `  Partner:  Northline Partners — reused ${partnerBoardLoads} existing PUBLIC board loads`
        : `  Partner:  Northline Partners — 4 PUBLIC board loads (ratings + lane benchmarks live)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});