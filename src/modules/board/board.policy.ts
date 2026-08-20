export const MARKETPLACE_STATUS = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
  BOOKED: 'BOOKED',
} as const;

export type MarketplaceStatus = (typeof MARKETPLACE_STATUS)[keyof typeof MARKETPLACE_STATUS];

export interface BoardFilters {
  originCountry?: string;
  originRegion?: string;
  originLocality?: string;
  originRadiusKm?: number | string;
  destinationCountry?: string;
  destinationRegion?: string;
  destinationLocality?: string;
  destinationRadiusKm?: number | string;
  minFreight?: number | string;
  maxFreight?: number | string;
  pickupAfter?: string;
  pickupBefore?: string;
  deliveryAfter?: string;
  deliveryBefore?: string;
  availableNow?: boolean | string;
  equipmentType?: string;
  minWeightKg?: number | string;
  hazmat?: boolean | string;
  commodity?: string;
  teamRequired?: boolean | string;
  q?: string;
}

export interface BoardSearchable {
  originCountry: string;
  originRegion: string;
  originLat?: number | null;
  originLon?: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLat?: number | null;
  destinationLon?: number | null;
  equipmentType?: string | null;
  pickupDate?: string | Date | null;
  deliveryDate?: string | Date | null;
  freightAmountBase?: string | number | null;
  freightAmountTransaction?: string | number | null;
  weightKg?: string | number | null;
  hazmat?: boolean | null;
  commodity?: string | null;
  teamRequired?: boolean | null;
  vendor?: string;
}

export interface RadiusContext {
  originCentre: { lat: number; lon: number } | null;
  destinationCentre: { lat: number; lon: number } | null;
  withinRadius: (point: { lat: number; lon: number } | null, centre: { lat: number; lon: number }, radiusKm: number) => boolean;
}

/**
 * DAT-style search filter on a load. All comparisons are case-insensitive;
 * state/country matches are exact so `qc` and `QC` both work.
 */
export function matchesFilters(
  row: BoardSearchable,
  filters: BoardFilters,
  radius?: RadiusContext,
): boolean {
  const eq = (a: string | undefined, b: string | undefined): boolean =>
    !a || !b || a.toUpperCase() === b.toUpperCase();

  if (!eq(filters.originCountry, row.originCountry)) return false;
  if (!eq(filters.originRegion, row.originRegion)) return false;
  if (!eq(filters.destinationCountry, row.destinationCountry)) return false;
  if (!eq(filters.destinationRegion, row.destinationRegion)) return false;

  // Radius / locality checks. When a locality is given we resolve it to a
  // coordinate; loads with coordinates must fall inside the radius. Loads
  // without coordinates fall back to the region match already enforced above.
  if (filters.originLocality && radius?.originCentre) {
    if (
      originPoint(row) &&
      !radius.withinRadius(originPoint(row), radius.originCentre, toNum(filters.originRadiusKm))
    ) {
      return false;
    }
  }
  if (filters.destinationLocality && radius?.destinationCentre) {
    if (
      destinationPoint(row) &&
      !radius.withinRadius(destinationPoint(row), radius.destinationCentre, toNum(filters.destinationRadiusKm))
    ) {
      return false;
    }
  }

  if (filters.equipmentType && (row.equipmentType ?? '') !== filters.equipmentType) return false;

  if (filters.minWeightKg !== undefined && row.weightKg != null && toNum(row.weightKg) < toNum(filters.minWeightKg)) {
    return false;
  }
  if (filters.hazmat !== undefined && Boolean(filters.hazmat) && !row.hazmat) return false;
  if (filters.teamRequired !== undefined && Boolean(filters.teamRequired) && !row.teamRequired) return false;
  if (filters.commodity) {
    const c = filters.commodity.toLowerCase();
    const hay = String(row.commodity ?? '').toLowerCase();
    if (!hay.includes(c)) return false;
  }

  const pickup = row.pickupDate ? new Date(row.pickupDate) : null;
  const delivery = row.deliveryDate ? new Date(row.deliveryDate) : null;
  const day = (iso: string | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  if (filters.availableNow) {
    const now = new Date();
    if (pickup && pickup < now) return false;
  }
  if (filters.pickupAfter) {
    const target = day(filters.pickupAfter);
    if (target && pickup && pickup.toISOString().slice(0, 10) < target) return false;
  }
  if (filters.pickupBefore) {
    const target = day(filters.pickupBefore);
    if (target && pickup && pickup.toISOString().slice(0, 10) > target) return false;
  }
  if (filters.deliveryAfter) {
    const target = day(filters.deliveryAfter);
    if (target && delivery && delivery.toISOString().slice(0, 10) < target) return false;
  }
  if (filters.deliveryBefore) {
    const target = day(filters.deliveryBefore);
    if (target && delivery && delivery.toISOString().slice(0, 10) > target) return false;
  }

  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = `${row.originRegion} ${row.originCountry} ${row.destinationRegion} ${row.destinationCountry} ${row.commodity ?? ''} ${row.vendor ?? ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  const freightValue = (v?: string | number | null): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const amount =
    row.freightAmountBase ?? row.freightAmountTransaction ?? null;
  const amountNum = freightValue(amount as number | string | null | undefined);
  if (filters.minFreight !== undefined && amountNum !== null && amountNum < Number(filters.minFreight)) {
    return false;
  }
  if (filters.maxFreight !== undefined && amountNum !== null && amountNum > Number(filters.maxFreight)) {
    return false;
  }
  return true;
}

function originPoint(row: BoardSearchable): { lat: number; lon: number } | null {
  if (row.originLat != null && row.originLon != null) return { lat: Number(row.originLat), lon: Number(row.originLon) };
  return null;
}

function destinationPoint(row: BoardSearchable): { lat: number; lon: number } | null {
  if (row.destinationLat != null && row.destinationLon != null) {
    return { lat: Number(row.destinationLat), lon: Number(row.destinationLon) };
  }
  return null;
}

function toNum(v: number | string | undefined | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function isBookable(status: string | null | undefined): boolean {
  return status === MARKETPLACE_STATUS.PUBLIC;
}

export function bookingAllowed(
  status: string,
  loadOwnerTenantId: string,
  requesterTenantId: string,
): { ok: boolean; reason?: string } {
  if (loadOwnerTenantId === requesterTenantId) {
    return { ok: false, reason: 'you cannot book a load posted by your own company' };
  }
  if (!isBookable(status)) {
    return {
      ok: false,
      reason: status === MARKETPLACE_STATUS.BOOKED ? 'load is already booked' : 'load is not available on the board',
    };
  }
  return { ok: true };
}