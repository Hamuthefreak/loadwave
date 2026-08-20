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

    await prisma.laneDailyStat.createMany({
      data: [
        { statDate: today, originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 4, trucksSeen: 3, avgRate: 2100 },
        { statDate: today, originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 3, trucksSeen: 5, avgRate: 1450 },
        { statDate: addDays(today, -1), originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 2, trucksSeen: 4, avgRate: 1990 },
        { statDate: addDays(today, -1), originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 2, trucksSeen: 3, avgRate: 1400 },
        { statDate: addDays(today, -2), originRegion: 'QC', destinationRegion: 'NY', equipmentType: 'ALL', loadsSeen: 3, trucksSeen: 2, avgRate: 1950 },
        { statDate: addDays(today, -2), originRegion: 'ON', destinationRegion: 'MI', equipmentType: 'ALL', loadsSeen: 1, trucksSeen: 2, avgRate: 1380 },
      ],
    });

    console.log('Demo tenant seeded:');
    console.log(`  Tenant:   ${tenantName}`);
    console.log(`  Admin:    ${email}`);
    console.log(`  Driver:   driver${stamp}@loadboard.app`);
    console.log(`  Password: ${password}`);
    console.log(`  Board loads: ${loads.length} · Trucks: 2 · Drivers: 2 · Assets: 1`);
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