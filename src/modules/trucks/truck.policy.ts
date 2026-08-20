export const TRUCK_STATUS = {
  ACTIVE: 'ACTIVE',
  BOOKED: 'BOOKED',
} as const;

export type TruckStatus = (typeof TRUCK_STATUS)[keyof typeof TRUCK_STATUS];

export interface TruckFilters {
  locationCountry?: string;
  locationRegion?: string;
  locationLocality?: string;
  locationRadiusKm?: number | string;
  equipmentType?: string;
  minRate?: number | string;
  maxRate?: number | string;
  q?: string;
}

export interface TruckSearchable {
  locationCountry: string;
  locationRegion: string;
  locationLat?: number | null;
  locationLon?: number | null;
  equipmentType: string;
  trailerType?: string | null;
  rateAmount?: string | number | null;
  postedByTenantName?: string;
}

export interface TruckRadiusContext {
  centre: { lat: number; lon: number } | null;
  withinRadius: (point: { lat: number; lon: number } | null, centre: { lat: number; lon: number }, radiusKm: number) => boolean;
}

/**
 * DAT-style filter for available equipment. Region/country matches are exact
 * (case-insensitive); free text q matches region, equipment and carrier name.
 */
export function matchesTruckFilters(row: TruckSearchable, filters: TruckFilters, radius?: TruckRadiusContext): boolean {
  const eq = (a: string | undefined, b: string | undefined): boolean =>
    !a || !b || a.toUpperCase() === b.toUpperCase();

  if (!eq(filters.locationCountry, row.locationCountry)) return false;
  if (!eq(filters.locationRegion, row.locationRegion)) return false;
  if (!eq(filters.equipmentType, row.equipmentType)) return false;

  if (filters.locationLocality && radius?.centre) {
    const point =
      row.locationLat != null && row.locationLon != null
        ? { lat: row.locationLat, lon: row.locationLon }
        : null;
    if (point && !radius.withinRadius(point, radius.centre, Number(filters.locationRadiusKm ?? 0))) {
      return false;
    }
  }

  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = `${row.locationRegion} ${row.locationCountry} ${row.equipmentType} ${row.trailerType ?? ''} ${row.postedByTenantName ?? ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  const n = Number(row.rateAmount ?? 0);
  if (Number.isFinite(n) && n > 0) {
    if (filters.minRate !== undefined && n < Number(filters.minRate)) return false;
    if (filters.maxRate !== undefined && n > Number(filters.maxRate)) return false;
  }
  return true;
}

export function bookingTruckAllowed(
  status: string,
  ownerTenantId: string,
  requesterTenantId: string,
): { ok: boolean; reason?: string } {
  if (ownerTenantId === requesterTenantId) {
    return { ok: false, reason: 'you cannot book equipment posted by your own company' };
  }
  if (status !== TRUCK_STATUS.ACTIVE) {
    return { ok: false, reason: 'this equipment is no longer available' };
  }
  return { ok: true };
}