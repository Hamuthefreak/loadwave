export const RATING_MIN = 1;
export const RATING_MAX = 5;

export interface RateableLoad {
  tenantId: string; // posting carrier
  bookedByTenantId: string | null; // booking carrier
  status: string;
}

export function starsInRange(stars: number): boolean {
  return Number.isInteger(stars) && stars >= RATING_MIN && stars <= RATING_MAX;
}

/**
 * A carrier may rate their marketplace counterpart only after the load has
 * been DELIVERED. The actor must be one of the two participants and rates
 * the other.
 */
export function ratingAllowed(
  load: RateableLoad,
  actorTenantId: string,
): { ok: boolean; ratedTenantId?: string; reason?: string } {
  if (!load.bookedByTenantId) return { ok: false, reason: 'load was never booked' };
  if (load.status !== 'DELIVERED' && load.status !== 'INVOICED') {
    return { ok: false, reason: 'a load can only be rated once it has been delivered' };
  }
  const isPoster = load.tenantId === actorTenantId;
  const isBooker = load.bookedByTenantId === actorTenantId;
  if (!isPoster && !isBooker) {
    return { ok: false, reason: 'only the carriers on this load can rate each other' };
  }
  const ratedTenantId = isPoster ? load.bookedByTenantId : load.tenantId;
  if (ratedTenantId === actorTenantId) {
    return { ok: false, reason: 'you cannot rate yourself' };
  }
  return { ok: true, ratedTenantId };
}
