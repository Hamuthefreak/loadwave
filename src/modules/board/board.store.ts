import type { PrismaClient } from '@prisma/client';
import type { BoardFilters, MarketplaceStatus } from './board.policy';
import type { TrustSignals } from '../trust/trust.service';

export interface BoardLoadRow {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  postedByMcNumber: string | null;
  postedByUsdotNumber: string | null;
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  originLat: number | null;
  originLon: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
  distanceKmEstimate: string | null;
  equipmentType: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  pickupFlexible: boolean;
  weightKg: string | null;
  commodity: string | null;
  hazmat: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  teamRequired: boolean;
  detentionRate: string | null;
  accessorials: unknown;
  stopCount: number;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
  isInternational: boolean;
  status: string;
  marketplaceStatus: MarketplaceStatus;
  bookedByTenantId: string | null;
  bookedAt: string | null;
  createdAt: string;
  /** Lane benchmark: marketplace-wide avg $/mile for this O→D lane. */
  laneAvgPerMile?: number | null;
  laneSamples?: number;
  /** Trust signals from the posting carrier (rating aggregates + verification). */
  postedByRatingAvg?: number | null;
  postedByRatingCount?: number;
  postedByVerified?: boolean;
  /** Authority, insurance, payment record and reports — stamped by the service. */
  postedByTrust?: TrustSignals | null;
}

export interface LaneRateAverage {
  originRegion: string;
  destinationRegion: string;
  avgPerMile: number;
  samples: number;
}

export interface LoadBoardStore {
  findPublic(tenantId: string, filters: BoardFilters): Promise<BoardLoadRow[]>;
  findOwned(tenantId: string): Promise<BoardLoadRow[]>;
  findById(loadId: string): Promise<BoardLoadRow | null>;
  /** Atomically flips PUBLIC -> BOOKED; false when already taken. */
  claim(loadId: string, tenantId: string, now: Date): Promise<boolean>;
  /** Owner marks a PRIVATE load as PUBLIC (no-op if already PUBLIC). */
  makePublic(loadId: string, tenantId: string): Promise<boolean>;
  /** Marketplace-wide avg $/mile per lane over recent history (rate-my-lane). */
  laneRateAverages(): Promise<LaneRateAverage[]>;
}

interface StoreRow {
  id: string;
  tenantId: string;
  tenant: {
    name: string;
    mcNumber?: string | null;
    usdotNumber?: string | null;
    ratingAvg?: { toString(): string } | null;
    ratingCount?: number;
  };
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  originLat: number | null;
  originLon: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
  distanceKmEstimate: { toString(): string } | null;
  equipmentType: string | null;
  pickupDate: Date | null;
  deliveryDate: Date | null;
  pickupFlexible: boolean;
  weightKg: { toString(): string } | null;
  commodity: string | null;
  hazmat: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  teamRequired: boolean;
  detentionRate: { toString(): string } | null;
  accessorials: unknown;
  stopCount: number;
  freightCurrency: string;
  freightAmountTransaction: { toString(): string } | null;
  freightAmountBase: { toString(): string } | null;
  isInternational: boolean;
  status: string;
  marketplaceStatus: string;
  bookedByTenantId: string | null;
  bookedAt: Date | null;
  createdAt: Date;
}

export class PrismaLoadBoardStore implements LoadBoardStore {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: StoreRow): BoardLoadRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      postedByTenantName: row.tenant.name,
      postedByMcNumber: row.tenant.mcNumber ?? null,
      postedByUsdotNumber: row.tenant.usdotNumber ?? null,
      postedByRatingAvg: row.tenant.ratingAvg != null ? Number(row.tenant.ratingAvg) : null,
      postedByRatingCount: row.tenant.ratingCount ?? 0,
      // Same derivation the tenants service uses for /api/tenants/me.
      postedByVerified: Boolean(row.tenant.mcNumber || row.tenant.usdotNumber),
      externalLoadboardId: row.externalLoadboardId,
      originCountry: row.originCountry,
      originRegion: row.originRegion,
      originLocality: row.originLocality,
      originLat: row.originLat,
      originLon: row.originLon,
      destinationCountry: row.destinationCountry,
      destinationRegion: row.destinationRegion,
      destinationLocality: row.destinationLocality,
      destinationLat: row.destinationLat,
      destinationLon: row.destinationLon,
      distanceKmEstimate: row.distanceKmEstimate ? row.distanceKmEstimate.toString() : null,
      equipmentType: row.equipmentType ?? null,
      pickupDate: row.pickupDate ? row.pickupDate.toISOString() : null,
      deliveryDate: row.deliveryDate ? row.deliveryDate.toISOString() : null,
      pickupFlexible: row.pickupFlexible,
      weightKg: row.weightKg ? row.weightKg.toString() : null,
      commodity: row.commodity,
      hazmat: row.hazmat,
      temperatureMin: row.temperatureMin,
      temperatureMax: row.temperatureMax,
      teamRequired: row.teamRequired,
      detentionRate: row.detentionRate ? row.detentionRate.toString() : null,
      accessorials: row.accessorials ?? null,
      stopCount: row.stopCount,
      freightCurrency: row.freightCurrency,
      freightAmountTransaction: row.freightAmountTransaction ? row.freightAmountTransaction.toString() : null,
      freightAmountBase: row.freightAmountBase ? row.freightAmountBase.toString() : null,
      isInternational: row.isInternational,
      status: row.status,
      marketplaceStatus: row.marketplaceStatus as MarketplaceStatus,
      bookedByTenantId: row.bookedByTenantId,
      bookedAt: row.bookedAt ? row.bookedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private select = {
    id: true,
    tenantId: true,
    tenant: {
      select: { name: true, mcNumber: true, usdotNumber: true, ratingAvg: true, ratingCount: true },
    },
    externalLoadboardId: true,
    originCountry: true,
    originRegion: true,
    originLocality: true,
    originLat: true,
    originLon: true,
    destinationCountry: true,
    destinationRegion: true,
    destinationLocality: true,
    destinationLat: true,
    destinationLon: true,
    distanceKmEstimate: true,
    equipmentType: true,
    pickupDate: true,
    deliveryDate: true,
    pickupFlexible: true,
    weightKg: true,
    commodity: true,
    hazmat: true,
    temperatureMin: true,
    temperatureMax: true,
    teamRequired: true,
    detentionRate: true,
    accessorials: true,
    stopCount: true,
    freightCurrency: true,
    freightAmountTransaction: true,
    freightAmountBase: true,
    isInternational: true,
    status: true,
    marketplaceStatus: true,
    bookedByTenantId: true,
    bookedAt: true,
    createdAt: true,
  } as const;

  async laneRateAverages(): Promise<LaneRateAverage[]> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.load.findMany({
      where: {
        marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] },
        createdAt: { gte: since },
      },
      select: {
        originRegion: true,
        destinationRegion: true,
        freightAmountBase: true,
        freightAmountTransaction: true,
        distanceKmEstimate: true,
      },
    });
    // Aggregate in JS: per-lane mean of $/mile (groupBy can't average a ratio).
    const lanes = new Map<string, { rates: number[] }>();
    for (const r of rows) {
      const amount = Number(r.freightAmountBase ?? r.freightAmountTransaction ?? 0);
      const km = Number(r.distanceKmEstimate ?? 0);
      if (amount <= 0 || km <= 0) continue;
      const key = `${r.originRegion}|${r.destinationRegion}`;
      const cur = lanes.get(key) ?? { rates: [] };
      cur.rates.push(amount / (km * 0.621371)); // $/mile
      lanes.set(key, cur);
    }
    return [...lanes.entries()]
      .filter(([, v]) => v.rates.length >= 2) // one sample is not a benchmark
      .map(([key, v]) => {
        const [originRegion, destinationRegion] = key.split('|');
        return {
          originRegion,
          destinationRegion,
          avgPerMile: v.rates.reduce((a, b) => a + b, 0) / v.rates.length,
          samples: v.rates.length,
        };
      });
  }

  async findPublic(tenantId: string, _filters: BoardFilters): Promise<BoardLoadRow[]> {
    const rows = await this.prisma.load.findMany({
      where: {
        tenantId: { not: tenantId },
        marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] },
      },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.map(r as unknown as StoreRow));
  }

  async findOwned(tenantId: string): Promise<BoardLoadRow[]> {
    const rows = await this.prisma.load.findMany({
      where: { tenantId, marketplaceStatus: { in: ['PRIVATE', 'PUBLIC', 'BOOKED'] } },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.map(r as unknown as StoreRow));
  }

  async findById(loadId: string): Promise<BoardLoadRow | null> {
    const row = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: this.select,
    });
    return row ? this.map(row as unknown as StoreRow) : null;
  }

  async claim(loadId: string, tenantId: string, now: Date): Promise<boolean> {
    const res = await this.prisma.load.updateMany({
      where: { id: loadId, marketplaceStatus: 'PUBLIC' },
      data: { marketplaceStatus: 'BOOKED', bookedByTenantId: tenantId, bookedAt: now },
    });
    return res.count > 0;
  }

  async makePublic(loadId: string, tenantId: string): Promise<boolean> {
    const res = await this.prisma.load.updateMany({
      where: { id: loadId, tenantId, marketplaceStatus: 'PRIVATE' },
      data: { marketplaceStatus: 'PUBLIC' },
    });
    return res.count > 0;
  }
}