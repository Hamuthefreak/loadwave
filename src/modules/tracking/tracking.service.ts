import { forbidden, notFound } from '../../utils/errors';
import {
  placeName,
  publicStatus,
  roundPosition,
  trackingProgress,
  type StopMilestone,
  type TrackFix,
} from './tracking.policy';
import type { TrackingLoad, TrackingRepo } from './tracking.repo';
import { trackingLink, verifyTrackingToken } from './tracking.token';
import type { JwtUser } from '../auth/auth.types';

/**
 * Tracking, in two views of the same derived milestones.
 *
 * The line between them is the whole security design:
 *
 * - **Internal** (`forLoad`) is for the company that owns the load. It may show
 *   the load id, the unit, the driver and the raw position, because everyone
 *   looking at it already works here.
 * - **Public** (`publicView`) is for a broker who was sent a link and has no
 *   account, so it is an allow-list, not a filter: only the lane, the stop
 *   milestones and a rounded position are ever assembled. Rates, customer and
 *   driver names, documents, notes and the tenant id have no path into that
 *   object — the surest way to keep a field from leaking is for it not to exist
 *   in the shape.
 */

export interface TrackingSettings {
  secret: string;
  appUrl: string;
}

export interface InternalTrackingView {
  loadId: string;
  status: string;
  lane: string;
  equipmentType: string | null;
  commodity: string | null;
  assigneeAssetId: string | null;
  assigneeDriverId: string | null;
  distanceKmEstimate: number | null;
  stops: StopMilestone[];
  current: StopMilestone | null;
  kmToCurrent: number | null;
  lastFix: TrackFix | null;
  headline: string;
  /** Absolute URL a dispatcher can paste anywhere; the token is derived. */
  link: string;
}

export interface PublicTrackingView {
  reference: string;
  status: { code: string; label: string };
  lane: string;
  stops: Array<{
    place: string;
    kind: string;
    stopOrder: number;
    scheduledAt: string | null;
    arrivedAt: string | null;
    departedAt: string | null;
    dwellMinutes: number | null;
    lateMinutes: number | null;
  }>;
  position: { lat: number; lon: number; at: string } | null;
  current: { place: string; kind: string; arrivedAt: string | null } | null;
  kmToCurrent: number | null;
  headline: string;
  updatedAt: string;
}

export class PrismaTrackingService {
  constructor(
    private readonly repo: TrackingRepo,
    private readonly settings: TrackingSettings,
  ) {}

  async forLoad(user: JwtUser, loadId: string): Promise<InternalTrackingView> {
    const load = await this.requireOwnLoad(user, loadId);
    const progress = trackingProgress(await this.repo.stops(load.id), await this.fixesFor(load));

    return {
      loadId: load.id,
      status: load.status,
      lane: laneLabel(load),
      equipmentType: load.equipmentType,
      commodity: load.commodity,
      assigneeAssetId: load.assigneeAssetId,
      assigneeDriverId: load.assigneeDriverId,
      distanceKmEstimate: load.distanceKmEstimate,
      stops: progress.stops,
      current: progress.current,
      kmToCurrent: progress.kmToCurrent,
      lastFix: progress.lastFix,
      headline: progress.headline,
      link: trackingLink(this.settings.appUrl, load.id, this.settings.secret),
    };
  }

  /**
   * The public page's data. A wrong token and an unknown load get the same
   * answer — the caller turns both into a 404 — so the endpoint cannot be used
   * to learn which load ids exist.
   */
  async publicView(loadId: string, token: string | undefined): Promise<PublicTrackingView | null> {
    if (!verifyTrackingToken(loadId, token, this.settings.secret)) return null;
    const load = await this.repo.load(loadId);
    if (!load) return null;

    const progress = trackingProgress(await this.repo.stops(load.id), await this.fixesFor(load));
    return {
      // The load id is a random uuid and is the reference the broker already has
      // on the ratecon. Nothing else about the company travels with it.
      reference: load.id,
      status: publicStatus(load.status),
      lane: laneLabel(load),
      stops: progress.stops.map((s) => ({
        place: s.place,
        kind: s.kind,
        stopOrder: s.stopOrder,
        scheduledAt: s.scheduledAt,
        arrivedAt: s.arrivedAt,
        departedAt: s.departedAt,
        dwellMinutes: s.dwellMinutes,
        lateMinutes: s.lateMinutes,
      })),
      position: progress.lastFix
        ? { ...roundPosition(progress.lastFix), at: progress.lastFix.at }
        : null,
      current: progress.current
        ? {
            place: progress.current.place,
            kind: progress.current.kind,
            arrivedAt: progress.current.arrivedAt,
          }
        : null,
      kmToCurrent: progress.kmToCurrent === null ? null : Math.round(progress.kmToCurrent * 10) / 10,
      headline: progress.headline,
      updatedAt: new Date().toISOString(),
    };
  }

  /** The assigned unit's positions for the life of the assignment. */
  private async fixesFor(load: TrackingLoad): Promise<TrackFix[]> {
    if (!load.assigneeAssetId) return [];
    return this.repo.fixes(
      load.tenantId,
      load.assigneeAssetId,
      load.assignedAt,
      load.deliveredAt ?? undefined,
    );
  }

  /**
   * Tenant-scoped always; a DRIVER additionally has to be the driver on the
   * load. Hiding the page in the client is not authorisation.
   */
  private async requireOwnLoad(user: JwtUser, loadId: string): Promise<TrackingLoad> {
    if (!loadId) throw notFound('load not found');
    const load = await this.repo.load(loadId);
    if (!load || load.tenantId !== user.tenantId) throw notFound('load not found');
    const driverOnly =
      user.roles.includes('DRIVER') &&
      !user.roles.includes('ADMIN') &&
      !user.roles.includes('DISPATCHER');
    if (driverOnly && load.assigneeDriverId !== user.driverId) {
      throw forbidden('this load is not assigned to you');
    }
    return load;
  }
}

export function laneLabel(load: {
  originLocality: string | null;
  originRegion: string;
  originCountry: string;
  destinationLocality: string | null;
  destinationRegion: string;
  destinationCountry: string;
}): string {
  const origin = placeName({
    locality: load.originLocality,
    region: load.originRegion,
    country: load.originCountry,
  });
  const destination = placeName({
    locality: load.destinationLocality,
    region: load.destinationRegion,
    country: load.destinationCountry,
  });
  return `${origin} to ${destination}`;
}
