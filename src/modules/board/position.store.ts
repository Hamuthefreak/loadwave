import type { PrismaClient } from '@prisma/client';
import type { ViewerPosition } from './board.earning';

/**
 * Where the carrier's truck is, for the purpose of pricing the empty miles to a
 * pickup.
 *
 * Two sources, in this order, and the order is the whole point:
 *
 * 1. **The delivery of the load they are on right now.** A truck in transit to
 *    Ontario is not in Ontario yet; what matters for "which of these loads can I
 *    actually take next" is where it will be *free*, which is the delivery
 *    point. This is a plan, not a measurement, so `at` carries the delivery date
 *    rather than a fix time and the card says so.
 * 2. **The newest position the truck reported.** For a carrier sitting empty,
 *    this is the only honest answer, and it ages — so the timestamp travels with
 *    it and the client can say how old it is.
 *
 * No source produces a position → the board shows exactly what it showed before
 * this feature existed. A guessed starting point would be worse than no number:
 * it would be a confidently wrong ranking, on the page carriers open first.
 */
export interface ViewerPositionStore {
  /** Null when the carrier has neither an active trip nor a reported position. */
  viewerPosition(tenantId: string): Promise<ViewerPosition | null>;
}

interface PositionRow {
  destinationLat: number | null;
  destinationLon: number | null;
  destinationLocality: string | null;
  destinationRegion: string;
  destinationCountry: string;
  deliveryDate: Date | null;
}

interface PointRow {
  lat: number;
  lon: number;
  occurredAt: Date;
  asset: { powerUnitNumber: string | null } | null;
}

export class PrismaViewerPositionStore implements ViewerPositionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async viewerPosition(tenantId: string): Promise<ViewerPosition | null> {
    const active = await this.activeDelivery(tenantId);
    if (active) return active;
    return this.lastReported(tenantId);
  }

  private async activeDelivery(tenantId: string): Promise<ViewerPosition | null> {
    const rows = (await this.prisma.load.findMany({
      where: {
        tenantId,
        status: 'IN_TRANSIT',
        destinationLat: { not: null },
        destinationLon: { not: null },
      },
      orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      select: {
        destinationLat: true,
        destinationLon: true,
        destinationLocality: true,
        destinationRegion: true,
        destinationCountry: true,
        deliveryDate: true,
      },
    })) as unknown as PositionRow[];

    const row = rows[0];
    if (!row || row.destinationLat === null || row.destinationLon === null) return null;
    return {
      point: { lat: Number(row.destinationLat), lon: Number(row.destinationLon) },
      source: 'ACTIVE_LOAD',
      place: placeName(row.destinationLocality, row.destinationRegion, row.destinationCountry),
      at: row.deliveryDate ? row.deliveryDate.toISOString() : null,
    };
  }

  private async lastReported(tenantId: string): Promise<ViewerPosition | null> {
    const row = (await this.prisma.routePoint.findFirst({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      select: {
        lat: true,
        lon: true,
        occurredAt: true,
        asset: { select: { powerUnitNumber: true } },
      },
    })) as unknown as PointRow | null;

    if (!row) return null;
    const unit = row.asset?.powerUnitNumber?.trim();
    return {
      point: { lat: Number(row.lat), lon: Number(row.lon) },
      source: 'LAST_POSITION',
      place: unit ? `unit ${unit}` : null,
      at: row.occurredAt.toISOString(),
    };
  }
}

function placeName(locality: string | null, region: string, country: string): string | null {
  const city = locality?.trim();
  if (city && region) return `${city}, ${region}`;
  if (region) return country && country !== 'CA' ? `${region}, ${country}` : region;
  return null;
}
