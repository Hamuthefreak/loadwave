import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import {
  bookingAllowed,
  matchesFilters,
  type BoardFilters,
  type RadiusContext,
} from './board.policy';
import type { BoardLoadRow, LoadBoardStore } from './board.store';
import type { GeoService } from '../geo/geo.service';
import { haversineKm } from '../geo/haversine';

export interface ILoadBoardService {
  listPublic(tenantId: string, filters: BoardFilters): Promise<BoardLoadRow[]>;
  listOwn(tenantId: string): Promise<BoardLoadRow[]>;
  book(tenantId: string, loadId: string): Promise<BoardLoadRow>;
  makePublic(tenantId: string, loadId: string): Promise<BoardLoadRow>;
}

export class LoadBoardService implements ILoadBoardService {
  constructor(
    private readonly store: LoadBoardStore,
    private readonly geo: GeoService,
  ) {}

  async listPublic(tenantId: string, filters: BoardFilters): Promise<BoardLoadRow[]> {
    const rows = await this.store.findPublic(tenantId, filters);
    const radius = await this.buildRadius(filters);
    return rows.filter((r) => matchesFilters(r, filters, radius ?? undefined));
  }

  async listOwn(tenantId: string): Promise<BoardLoadRow[]> {
    return this.store.findOwned(tenantId);
  }

  async book(tenantId: string, loadId: string): Promise<BoardLoadRow> {
    if (!loadId) throw badRequest('loadId is required');
    const load = await this.store.findById(loadId);
    if (!load) throw notFound('load not found');

    const check = bookingAllowed(load.marketplaceStatus, load.tenantId, tenantId);
    if (!check.ok) throw conflict(check.reason ?? 'load is not bookable');

    const claimed = await this.store.claim(loadId, tenantId, new Date());
    if (!claimed) {
      // Lost the race: the load was just booked by another carrier.
      throw conflict('load was just booked by another carrier');
    }
    const booked = await this.store.findById(loadId);
    if (!booked) throw notFound('load not found');
    return booked;
  }

  async makePublic(tenantId: string, loadId: string): Promise<BoardLoadRow> {
    if (!loadId) throw badRequest('loadId is required');
    const load = await this.store.findById(loadId);
    if (!load) throw notFound('load not found');
    if (load.tenantId !== tenantId) throw forbidden('only the posting carrier can list a load');
    if (load.marketplaceStatus === 'BOOKED') {
      throw conflict('a booked load cannot be re-listed');
    }
    await this.store.makePublic(loadId, tenantId);
    const updated = await this.store.findById(loadId);
    return updated ?? load;
  }

  private async buildRadius(filters: BoardFilters): Promise<RadiusContext | null> {
    const originResolved =
      filters.originLocality && filters.originCountry
        ? await this.geo.resolve(filters.originCountry, filters.originRegion ?? '', filters.originLocality)
        : null;
    const destinationResolved =
      filters.destinationLocality && filters.destinationCountry
        ? await this.geo.resolve(filters.destinationCountry, filters.destinationRegion ?? '', filters.destinationLocality)
        : null;
    return {
      originCentre: originResolved ? { lat: originResolved.latitude, lon: originResolved.longitude } : null,
      destinationCentre: destinationResolved
        ? { lat: destinationResolved.latitude, lon: destinationResolved.longitude }
        : null,
      withinRadius: (point, centre, radiusKm) => {
        if (!point) return true;
        if (!radiusKm || radiusKm <= 0) return true;
        return haversineKm(point, centre) <= radiusKm;
      },
    };
  }
}