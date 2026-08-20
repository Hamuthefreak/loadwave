export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in kilometres between two points (Haversine).
 * Pure and dependency-free so it can run anywhere (PostGIS is optional).
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** True when the point is within `radiusKm` of the centre, or when radius is 0/unset. */
export function withinRadius(point: LatLon | null | undefined, centre: LatLon, radiusKm: number): boolean {
  if (!point) return false;
  if (!radiusKm || radiusKm <= 0) return true; // no radius constraint
  return haversineKm(point, centre) <= radiusKm;
}