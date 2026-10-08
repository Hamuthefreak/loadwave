import { haversineKm } from '../geo/haversine';

/**
 * Milestones derived from the truck's own positions.
 *
 * The alternative design was to write an event row when a position lands inside
 * a stop's fence. This computes the answer from the trail instead, at read time,
 * for three reasons that matter more than the seconds it costs:
 *
 * 1. **Nothing to fall out of sync.** A truck that lost signal in Ontario and
 *    backfilled six hours of points still produces the same milestones, because
 *    the milestones *are* the trail.
 * 2. **Re-running is free.** Tuning the fence radius re-answers history
 *    correctly, where stored events would have to be migrated or accepted as
 *    wrong.
 * 3. **No schema.** `LoadStop` has the coordinates and `RoutePoint` has the
 *    fixes; a milestone table would be a third copy of the same truth.
 *
 * When outbound status webhooks arrive (GAP_ANALYSIS 2.1) this same function
 * decides what to send, on a sweep instead of at ingest.
 *
 * Pure and dependency-free (Haversine only) so it can be unit-tested exactly.
 */

/**
 * How close counts as arrived. 750 m: a truck stop or a dock is bigger than a
 * parking space, GPS in a yard drifts more than the driver thinks, and a fence
 * tight enough to be exact is one that never fires.
 */
export const ARRIVAL_RADIUS_KM = 0.75;

/** Reported positions are rounded to ~110 m before they leave the building. */
export const PUBLIC_POSITION_DECIMALS = 3;

export interface TrackFix {
  lat: number;
  lon: number;
  /** ISO instant of the fix. */
  at: string;
}

export interface TrackStopInput {
  id: string;
  kind: string;
  stopOrder: number;
  country: string;
  region: string;
  locality: string | null;
  lat: number | null;
  lon: number | null;
  /** ISO, when the stop was booked for a time. */
  scheduledAt: string | null;
}

export interface StopMilestone {
  stopId: string;
  kind: string;
  stopOrder: number;
  /** "Toronto, ON" — the geography we already store, never a guessed address. */
  place: string;
  country: string;
  region: string;
  locality: string | null;
  scheduledAt: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  /** Minutes between arrival and departure; null while still on site. */
  dwellMinutes: number | null;
  /** Signed minutes late against the booked time: positive is late, negative early. */
  lateMinutes: number | null;
}

export interface TrackingProgress {
  stops: StopMilestone[];
  /** On site now, or the next stop not yet reached. Null when every stop is done. */
  current: StopMilestone | null;
  /** Straight-line kilometres from the newest fix to `current`. */
  kmToCurrent: number | null;
  lastFix: TrackFix | null;
  /** One plain sentence for a share sheet or a public page. */
  headline: string;
}

/** "Toronto, ON" / "Toronto, ON, US" for the cross-border case. */
export function placeName(stop: {
  locality: string | null;
  region: string;
  country: string;
}): string {
  const city = stop.locality?.trim();
  const parts: string[] = [];
  if (city) parts.push(city);
  if (stop.region) parts.push(stop.region);
  if (stop.country && stop.country !== 'CA') parts.push(stop.country);
  return parts.join(', ') || 'Unnamed stop';
}

function minutes(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

function coordinate(stop: TrackStopInput): { lat: number; lon: number } | null {
  if (stop.lat === null || stop.lon === null) return null;
  return { lat: Number(stop.lat), lon: Number(stop.lon) };
}

/**
 * Arrived = the first fix inside the fence. Departed = the first fix after that
 * outside it. Order in, order out: a driver who arrives, leaves for fuel and
 * returns produces one arrival and one departure, which is what a dock wants to
 * hear, and the loop never rewinds.
 */
export function milestonesFor(
  stops: readonly TrackStopInput[],
  fixes: readonly TrackFix[],
): StopMilestone[] {
  const orderedFixes = [...fixes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return [...stops]
    .sort((a, b) => a.stopOrder - b.stopOrder)
    .map((stop) => {
      const base: StopMilestone = {
        stopId: stop.id,
        kind: stop.kind,
        stopOrder: stop.stopOrder,
        place: placeName(stop),
        country: stop.country,
        region: stop.region,
        locality: stop.locality,
        scheduledAt: stop.scheduledAt,
        arrivedAt: null,
        departedAt: null,
        dwellMinutes: null,
        lateMinutes: null,
      };

      const centre = coordinate(stop);
      if (!centre) return base;

      const arrivedIndex = orderedFixes.findIndex(
        (fix) => haversineKm({ lat: fix.lat, lon: fix.lon }, centre) <= ARRIVAL_RADIUS_KM,
      );
      if (arrivedIndex === -1) return base;

      const arrived = orderedFixes[arrivedIndex];
      const departed = orderedFixes
        .slice(arrivedIndex + 1)
        .find((fix) => haversineKm({ lat: fix.lat, lon: fix.lon }, centre) > ARRIVAL_RADIUS_KM);

      const dwell = departed ? minutes(arrived.at, departed.at) : null;
      const late = stop.scheduledAt ? minutes(stop.scheduledAt, arrived.at) : null;

      return {
        ...base,
        arrivedAt: arrived.at,
        departedAt: departed ? departed.at : null,
        dwellMinutes: dwell !== null && dwell >= 0 ? dwell : null,
        lateMinutes: late,
      };
    });
}

/**
 * Where the load stands, in one sentence, and how far the truck still has to go.
 *
 * The headline is written from the milestones rather than from the status
 * column, because "In transit" is not what a broker phoned to ask.
 */
export function trackingProgress(
  stops: readonly TrackStopInput[],
  fixes: readonly TrackFix[],
): TrackingProgress {
  const ordered = [...fixes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lastFix = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  const milestones = milestonesFor(stops, ordered);

  const onSite = milestones.find((m) => m.arrivedAt !== null && m.departedAt === null) ?? null;
  const upcoming = milestones.find((m) => m.arrivedAt === null) ?? null;
  const current = onSite ?? upcoming;

  const centre = current ? stopCoordinate(stops, current.stopId) : null;
  const kmToCurrent =
    lastFix && centre ? haversineKm({ lat: lastFix.lat, lon: lastFix.lon }, centre) : null;

  return {
    stops: milestones,
    current,
    kmToCurrent,
    lastFix,
    headline: headlineFor(milestones, current, kmToCurrent, lastFix),
  };
}

function stopCoordinate(
  stops: readonly TrackStopInput[],
  stopId: string,
): { lat: number; lon: number } | null {
  const stop = stops.find((s) => s.id === stopId);
  return stop ? coordinate(stop) : null;
}

function headlineFor(
  milestones: readonly StopMilestone[],
  current: StopMilestone | null,
  kmToCurrent: number | null,
  lastFix: TrackFix | null,
): string {
  const departed = [...milestones].reverse().find((m) => m.departedAt !== null);
  if (!current && departed) {
    return departed.kind === 'DELIVERY'
      ? `Delivered — left ${departed.place}`
      : `Departed ${departed.place}`;
  }
  if (!current) return 'No stops on this load yet';
  if (current.departedAt) return `Departed ${current.place}`;
  if (current.arrivedAt) {
    return `On site at ${current.place} since ${clock(current.arrivedAt)}`;
  }
  if (!lastFix) return `No position reported yet — next: ${current.place}`;
  if (kmToCurrent !== null && kmToCurrent <= 25) {
    return `Nearing ${current.place} (${Math.round(kmToCurrent)} km out)`;
  }
  if (kmToCurrent !== null) {
    return `En route to ${current.place} (${Math.round(kmToCurrent)} km out)`;
  }
  return `En route to ${current.place}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}Z`;
}

/** The coarse status a customer is allowed to see, and its plain wording. */
export function publicStatus(status: string): { code: string; label: string } {
  switch (status) {
    case 'IN_TRANSIT':
      return { code: 'IN_TRANSIT', label: 'In transit' };
    case 'DELIVERED':
    case 'INVOICED':
      return { code: 'DELIVERED', label: 'Delivered' };
    default:
      // OPEN and ASSIGNED alike: the load is committed, the truck is not rolling.
      return { code: 'BOOKED', label: 'Booked' };
  }
}

/** Rounded to ~110 m: enough to say where, not enough to be a surveillance feed. */
export function roundPosition(point: { lat: number; lon: number }): { lat: number; lon: number } {
  const factor = 10 ** PUBLIC_POSITION_DECIMALS;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lon: Math.round(point.lon * factor) / factor,
  };
}
