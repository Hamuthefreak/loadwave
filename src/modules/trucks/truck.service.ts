import { badRequest, conflict, notFound } from '../../utils/errors';
import {
  bookingTruckAllowed,
  matchesTruckFilters,
  type TruckFilters,
  type TruckRadiusContext,
} from './truck.policy';
import type { TruckCreateInput, TruckRow, TruckStore } from './truck.store';
import type { GeoService } from '../geo/geo.service';
import { haversineKm } from '../geo/haversine';

export interface ITruckService {
  listPublic(tenantId: string, filters: TruckFilters): Promise<TruckRow[]>;
  listOwn(tenantId: string): Promise<TruckRow[]>;
  post(tenantId: string, input: TruckCreateInput): Promise<TruckRow>;
  book(tenantId: string, truckId: string): Promise<TruckRow>;
}

export class TruckService implements ITruckService {
  constructor(
    private readonly store: TruckStore,
    private readonly geo: GeoService,
  ) {}

  async listPublic(tenantId: string, filters: TruckFilters): Promise<TruckRow[]> {
    const rows = await this.store.findPublic(tenantId, filters);
    const radius = await this.buildRadius(filters);
    return rows.filter((r) => matchesTruckFilters(r, filters, radius ?? undefined));
  }

  async listOwn(tenantId: string): Promise<TruckRow[]> {
    return this.store.findOwned(tenantId);
  }

  async post(tenantId: string, input: TruckCreateInput): Promise<TruckRow> {
    if (!input.equipmentType) throw badRequest('equipmentType is required');
    if (!input.locationCountry || !input.locationRegion) {
      throw badRequest('location country and region are required');
    }
    if (!input.availableFrom) throw badRequest('availableFrom is required');
    return this.store.create({ ...input, tenantId });
  }

  async book(tenantId: string, truckId: string): Promise<TruckRow> {
    if (!truckId) throw badRequest('truckId is required');
    const truck = await this.store.findById(truckId);
    if (!truck) throw notFound('equipment listing not found');

    const check = bookingTruckAllowed(truck.status, truck.tenantId, tenantId);
    if (!check.ok) throw conflict(check.reason ?? 'equipment is not bookable');

    const claimed = await this.store.claim(truckId, tenantId, new Date());
    if (!claimed) {
      throw conflict('equipment was just booked by another carrier');
    }
    const booked = await this.store.findById(truckId);
    if (!booked) throw notFound('equipment listing not found');
    return booked;
  }

  private async buildRadius(filters: TruckFilters): Promise<TruckRadiusContext | null> {
    if (!filters.locationLocality || !filters.locationCountry) return null;
    const resolved = await this.geo.resolve(
      filters.locationCountry,
      filters.locationRegion ?? '',
      filters.locationLocality,
    );
    return {
      centre: resolved ? { lat: resolved.latitude, lon: resolved.longitude } : null,
      withinRadius: (point, centre, radiusKm) => {
        if (!point) return true;
        if (!radiusKm || radiusKm <= 0) return true;
        return haversineKm(point, centre) <= radiusKm;
      },
    };
  }
}