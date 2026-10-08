import type { PrismaClient } from '@prisma/client';
import type { TrackFix, TrackStopInput } from './tracking.policy';

/**
 * Read-only access to what a tracker shows: the load, its stops, and the
 * positions the assigned unit reported. No writes anywhere — milestones are
 * derived (see tracking.policy.ts), so this module can only ever read.
 */

export interface TrackingLoad {
  id: string;
  tenantId: string;
  status: string;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  equipmentType: string | null;
  commodity: string | null;
  weightKg: number | null;
  stopCount: number;
  isInternational: boolean;
  assigneeAssetId: string | null;
  assigneeDriverId: string | null;
  assignedAt: Date | null;
  deliveredAt: Date | null;
  /** Straight-line or practical distance, whichever was stored. */
  distanceKmEstimate: number | null;
}

export interface TrackingRepo {
  load(loadId: string): Promise<TrackingLoad | null>;
  stops(loadId: string): Promise<TrackStopInput[]>;
  /** Positions for a unit since `from`, oldest first, scoped to the company. */
  fixes(tenantId: string, assetId: string, from: Date | null, until?: Date): Promise<TrackFix[]>;
}

interface LoadRow {
  id: string;
  tenantId: string;
  status: string;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  equipmentType: string | null;
  commodity: string | null;
  weightKg: { toString(): string } | null;
  stopCount: number;
  isInternational: boolean;
  assigneeAssetId: string | null;
  assigneeDriverId: string | null;
  assignedAt: Date | null;
  deliveredAt: Date | null;
  distanceKmEstimate: { toString(): string } | null;
}

export class PrismaTrackingRepo implements TrackingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async load(loadId: string): Promise<TrackingLoad | null> {
    const row = (await this.prisma.load.findUnique({
      where: { id: loadId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        originCountry: true,
        originRegion: true,
        originLocality: true,
        destinationCountry: true,
        destinationRegion: true,
        destinationLocality: true,
        equipmentType: true,
        commodity: true,
        weightKg: true,
        stopCount: true,
        isInternational: true,
        assigneeAssetId: true,
        assigneeDriverId: true,
        assignedAt: true,
        deliveredAt: true,
        distanceKmEstimate: true,
      },
    })) as unknown as LoadRow | null;
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      status: row.status,
      originCountry: row.originCountry,
      originRegion: row.originRegion,
      originLocality: row.originLocality,
      destinationCountry: row.destinationCountry,
      destinationRegion: row.destinationRegion,
      destinationLocality: row.destinationLocality,
      equipmentType: row.equipmentType,
      commodity: row.commodity,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      stopCount: row.stopCount,
      isInternational: row.isInternational,
      assigneeAssetId: row.assigneeAssetId,
      assigneeDriverId: row.assigneeDriverId,
      assignedAt: row.assignedAt,
      deliveredAt: row.deliveredAt,
      distanceKmEstimate:
        row.distanceKmEstimate === null ? null : Number(row.distanceKmEstimate),
    };
  }

  async stops(loadId: string): Promise<TrackStopInput[]> {
    const rows = await this.prisma.loadStop.findMany({
      where: { loadId },
      orderBy: [{ stopOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        stopOrder: true,
        country: true,
        region: true,
        locality: true,
        lat: true,
        lon: true,
        scheduledAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      stopOrder: r.stopOrder,
      country: r.country,
      region: r.region,
      locality: r.locality,
      lat: r.lat,
      lon: r.lon,
      scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    }));
  }

  async fixes(tenantId: string, assetId: string, from: Date | null, until?: Date): Promise<TrackFix[]> {
    const rows = await this.prisma.routePoint.findMany({
      where: {
        tenantId,
        assetId,
        ...(from ? { occurredAt: { gte: from } } : {}),
        ...(until ? { occurredAt: { lte: until } } : {}),
      },
      orderBy: { occurredAt: 'asc' },
      // A tracker shows a journey, not a telemetry dump. 2,000 fixes is days of
      // movement and more than any milestone calculation needs.
      take: 2000,
      select: { lat: true, lon: true, occurredAt: true },
    });
    return rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), at: r.occurredAt.toISOString() }));
  }
}
