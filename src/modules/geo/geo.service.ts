import type { PrismaClient } from '@prisma/client';
import { haversineKm } from './haversine';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Place {
  id: string;
  country: string;
  region: string;
  placeName: string;
  postalPrefix: string;
  lat: number;
  lon: number;
  population: number;
}

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  locality: string;
}

export interface GeoService {
  search(country: string, query: string, limit?: number): Promise<Place[]>;
  searchByPrefix(country: string, prefix: string, limit?: number): Promise<Place[]>;
  resolve(country: string, region: string, locality: string): Promise<ResolvedLocation | null>;
  /** True when point is within radiusKm of target, or when radius is unset. */
  withinRadius(point: GeoPoint | null | undefined, target: GeoPoint, radiusKm: number): boolean;
}

interface PlaceRow {
  id: string;
  country: string;
  region: string;
  placeName: string;
  postalPrefix: string;
  lat: number;
  lon: number;
  population: number;
}

/**
 * Radius/geocoding support for the load board. Backed by the seeded
 * PostalPlace table (see scripts/seed-places.ts). PostGIS is not required:
 * great-circle distance is computed with Haversine in app code, so the
 * feature works on a fresh minimal Postgres install.
 */
export class PrismaGeoService implements GeoService {
  constructor(private readonly prisma: PrismaClient) {}

  async search(country: string, query: string, limit = 12): Promise<Place[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const rows = await this.prisma.postalPlace.findMany({
      where: {
        country: country.toUpperCase(),
        OR: [
          { placeName: { contains: q, mode: 'insensitive' } },
          { postalPrefix: { contains: q.slice(0, 3) } },
        ],
      },
      orderBy: [{ population: 'desc' }],
      take: limit,
    });
    return (rows as unknown as PlaceRow[]).map((r) => ({
      id: r.id,
      country: r.country,
      region: r.region,
      placeName: r.placeName,
      postalPrefix: r.postalPrefix,
      lat: r.lat,
      lon: r.lon,
      population: r.population,
    }));
  }

  async searchByPrefix(country: string, prefix: string, limit = 12): Promise<Place[]> {
    const p = prefix.trim().toUpperCase();
    if (!p) return [];
    const rows = await this.prisma.postalPlace.findMany({
      where: {
        country: country.toUpperCase(),
        postalPrefix: { startsWith: p.slice(0, 3) },
      },
      orderBy: [{ population: 'desc' }],
      take: limit,
    });
    return (rows as unknown as PlaceRow[]).map((r) => ({
      id: r.id,
      country: r.country,
      region: r.region,
      placeName: r.placeName,
      postalPrefix: r.postalPrefix,
      lat: r.lat,
      lon: r.lon,
      population: r.population,
    }));
  }

  async resolve(
    country: string,
    region: string,
    locality: string,
  ): Promise<ResolvedLocation | null> {
    const loc = String(locality ?? '').trim().toUpperCase();
    if (!loc) return null;
    const place = await this.prisma.postalPlace.findFirst({
      where: {
        country: country.toUpperCase(),
        region: region.toUpperCase(),
        OR: [{ placeName: loc }, { postalPrefix: loc.slice(0, 3) }],
      },
      orderBy: [{ population: 'desc' }],
    });
    if (!place) return null;
    return {
      latitude: place.lat,
      longitude: place.lon,
      country: place.country,
      region: place.region,
      locality: place.placeName,
    };
  }

  withinRadius(
    point: GeoPoint | null | undefined,
    target: GeoPoint,
    radiusKm: number,
  ): boolean {
    if (!point || !radiusKm || radiusKm <= 0) return true;
    return haversineKm(point, target) <= radiusKm;
  }
}