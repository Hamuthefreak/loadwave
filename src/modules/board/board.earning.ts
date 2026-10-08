import { haversineKm, type LatLon } from '../geo/haversine';

/**
 * What a load actually pays, once the empty miles to reach it are on the clock.
 *
 * Every board shows `$/mile` for the loaded leg. That number is not what the
 * truck earns: a load 320 km away paying $2.40/mile pays less than one 40 km
 * away paying $2.05, and the carrier only finds out by working the arithmetic
 * themselves. This module does that arithmetic, and — just as important —
 * refuses to guess when the input it needs is missing. An unknown deadhead
 * produces a null, never a zero, because a zero would be a made-up number
 * presented with the same confidence as a measured one.
 *
 * Pure and dependency-free (Haversine only) so the ranking can be unit-tested
 * without a database.
 */

/** km per mile — the same factor `laneRateAverages()` uses, so the figures agree. */
export const KM_PER_MILE = 0.621371;

/** A load pairs with this one when its own pickup is this close to our delivery. */
export const ROUND_TRIP_RADIUS_KM = 150;

/** How many backhauls a card is allowed to quote. More is a result list, not a pairing. */
export const ROUND_TRIP_MAX = 3;

/**
 * A backhaul has to be pick-up-able. A load that closes out before we deliver is
 * not a round trip, it is somebody else's day — but a pickup the same day is
 * normal, so a day of grace is allowed rather than requiring strict ordering.
 */
export const ROUND_TRIP_PICKUP_GRACE_MS = 24 * 60 * 60 * 1000;

export type ViewerPositionSource = 'ACTIVE_LOAD' | 'LAST_POSITION';

export interface ViewerPosition {
  point: LatLon;
  source: ViewerPositionSource;
  /** Where the fix is, in the geography we already store (locality + region). */
  place: string | null;
  /** When the fix was taken, ISO. Null for the delivery of a load (a plan, not a fix). */
  at: string | null;
}

export interface EarningRow {
  distanceKmEstimate?: string | number | null;
  freightAmountBase?: string | number | null;
  freightAmountTransaction?: string | number | null;
  originLat?: number | null;
  originLon?: number | null;
  destinationLat?: number | null;
  destinationLon?: number | null;
}

export interface Earning {
  /** Rate on the loaded leg alone — the number every other board shows. */
  grossPerMile: number | null;
  /** Empty kilometres from the viewer to the pickup. Null when unknowable. */
  deadheadKm: number | null;
  /** Rate over loaded + empty kilometres: what the truck actually earns. */
  netPerMile: number | null;
  /** Which position the deadhead was measured from, for attribution on the card. */
  positionSource: ViewerPositionSource | null;
}

/** Kilometres as miles. */
export function miles(km: number): number {
  return km * KM_PER_MILE;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The amount we actually compare across currencies, exactly as the lane benchmark does. */
export function loadAmount(row: EarningRow): number | null {
  const base = num(row.freightAmountBase);
  if (base !== null && base > 0) return base;
  const tx = num(row.freightAmountTransaction);
  return tx !== null && tx > 0 ? tx : null;
}

function point(lat?: number | null, lon?: number | null): LatLon | null {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
  return { lat: Number(lat), lon: Number(lon) };
}

/** Dollars per mile over a distance, or null when either input is unusable. */
export function ratePerMile(amount: number | null, km: number | null): number | null {
  if (amount === null || km === null || km <= 0) return null;
  return amount / miles(km);
}

/**
 * Gross rate plus deadhead for one load, from one viewing position.
 *
 * Degrades in one direction only: no position, no origin coordinate or no
 * distance leaves the fields null, so the card can show exactly what it showed
 * before rather than a figure with a hidden assumption in it.
 */
export function earning(row: EarningRow, position: ViewerPosition | null): Earning {
  const km = num(row.distanceKmEstimate);
  const amount = loadAmount(row);
  const gross = ratePerMile(amount, km);
  const from = position?.point ?? null;
  const to = point(row.originLat, row.originLon);

  if (from === null || to === null || km === null || km <= 0 || amount === null) {
    return { grossPerMile: gross, deadheadKm: null, netPerMile: null, positionSource: null };
  }

  const deadheadKm = haversineKm(from, to);
  return {
    grossPerMile: gross,
    deadheadKm,
    netPerMile: ratePerMile(amount, km + deadheadKm),
    positionSource: position?.source ?? null,
  };
}

export interface RoundTripCandidate extends EarningRow {
  id: string;
  originRegion: string;
  destinationRegion: string;
  originLocality?: string | null;
  destinationLocality?: string | null;
  equipmentType?: string | null;
  freightCurrency?: string | null;
  pickupDate?: string | null;
  deliveryDate?: string | null;
}

export interface RoundTripOption {
  id: string;
  originRegion: string;
  destinationRegion: string;
  originLocality: string | null;
  destinationLocality: string | null;
  equipmentType: string | null;
  freightCurrency: string;
  /** Loaded kilometres of the second leg. */
  distanceKmEstimate: number;
  /** Empty kilometres between our delivery and its pickup. */
  deadheadKm: number;
  grossPerMile: number | null;
  /** Rate over that leg's loaded + empty kilometres. */
  netPerMile: number | null;
  /** True when its trailer matches ours — ranked first, but never required. */
  sameEquipment: boolean;
  pickupDate: string | null;
}

export interface RoundTripOptions {
  radiusKm?: number;
  max?: number;
  /** Passed through to the ranking's equipment preference. */
  equipmentType?: string | null;
}

/**
 * Loads that pick up where this one delivers — the backhaul every carrier hunts
 * by hand, ranked by what the second leg earns per mile including the empty hop
 * between the two.
 *
 * Candidates without coordinates, a distance or an amount are dropped rather
 * than ranked on a partial figure, and one that cannot be picked up after we
 * deliver is dropped as impossible.
 */
export function roundTrips(
  row: RoundTripCandidate,
  pool: readonly RoundTripCandidate[],
  opts: RoundTripOptions = {},
): RoundTripOption[] {
  const radiusKm = opts.radiusKm ?? ROUND_TRIP_RADIUS_KM;
  const max = opts.max ?? ROUND_TRIP_MAX;
  const deliverAt = point(row.destinationLat, row.destinationLon);
  if (!deliverAt) return [];

  const ourEquipment = opts.equipmentType ?? row.equipmentType ?? null;

  const options: RoundTripOption[] = [];
  for (const candidate of pool) {
    if (candidate.id === row.id) continue;
    const pickupAt = point(candidate.originLat, candidate.originLon);
    if (!pickupAt) continue;

    const km = num(candidate.distanceKmEstimate);
    const amount = loadAmount(candidate);
    if (km === null || km <= 0 || amount === null) continue;

    const deadheadKm = haversineKm(deliverAt, pickupAt);
    if (deadheadKm > radiusKm) continue;
    if (!pickupFits(row.deliveryDate ?? null, candidate.pickupDate ?? null)) continue;

    options.push({
      id: candidate.id,
      originRegion: candidate.originRegion,
      destinationRegion: candidate.destinationRegion,
      originLocality: candidate.originLocality ?? null,
      destinationLocality: candidate.destinationLocality ?? null,
      equipmentType: candidate.equipmentType ?? null,
      freightCurrency: candidate.freightCurrency ?? 'CAD',
      distanceKmEstimate: km,
      deadheadKm,
      grossPerMile: ratePerMile(amount, km),
      netPerMile: ratePerMile(amount, km + deadheadKm),
      sameEquipment:
        ourEquipment !== null && candidate.equipmentType != null
          ? ourEquipment === candidate.equipmentType
          : false,
      pickupDate: candidate.pickupDate ?? null,
    });
  }

  return options
    .sort((a, b) => {
      if (a.sameEquipment !== b.sameEquipment) return a.sameEquipment ? -1 : 1;
      const an = a.netPerMile ?? -1;
      const bn = b.netPerMile ?? -1;
      if (bn !== an) return bn - an;
      return a.id < b.id ? -1 : 1; // stable, deterministic output
    })
    .slice(0, max);
}

/**
 * Can the second leg be picked up after this one is delivered?
 *
 * Compared against the *delivery* date of the current load, not its pickup.
 * Missing dates are treated as compatible: a board is full of loads with a
 * pickup date and no delivery date, and refusing to pair them would hide the
 * feature from exactly the freight that needs it.
 */
function pickupFits(thisDelivery: string | null, candidatePickup: string | null): boolean {
  if (!thisDelivery || !candidatePickup) return true;
  const d = Date.parse(thisDelivery);
  const p = Date.parse(candidatePickup);
  if (Number.isNaN(d) || Number.isNaN(p)) return true;
  return p >= d - ROUND_TRIP_PICKUP_GRACE_MS;
}
