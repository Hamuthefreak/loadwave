import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import {
  bookingAllowed,
  matchesFilters,
  type BoardFilters,
  type RadiusContext,
} from './board.policy';
import type { BoardLoadRow, LoadBoardStore } from './board.store';
import type { GeoService } from '../geo/geo.service';
import type { TrustService } from '../trust/trust.service';
import type { ViewerPositionStore } from './position.store';
import { haversineKm } from '../geo/haversine';
import { earning, roundTrips, type RoundTripCandidate, type ViewerPosition } from './board.earning';

export interface BoardListOptions {
  /**
   * Pair each load with the backhauls near its delivery. On by default because
   * the board is the reason the column exists; the saved-search sweep turns it
   * off, since it reads load ids and never the pairing, and the pairing is the
   * only part of this call that scans the whole public set.
   */
  roundTrips?: boolean;
}

export interface ILoadBoardService {
  listPublic(
    tenantId: string,
    filters: BoardFilters,
    opts?: BoardListOptions,
  ): Promise<BoardLoadRow[]>;
  listOwn(tenantId: string): Promise<BoardLoadRow[]>;
  book(tenantId: string, loadId: string): Promise<BoardLoadRow>;
  makePublic(tenantId: string, loadId: string): Promise<BoardLoadRow>;
}

export class LoadBoardService implements ILoadBoardService {
  constructor(
    private readonly store: LoadBoardStore,
    private readonly geo: GeoService,
    /** Optional: without it the board simply shows no trust chips. */
    private readonly trust?: TrustService,
    /**
     * Optional: where the carrier's truck is. Without it (or without a position)
     * the board shows the loaded rate only, exactly as it did before deadhead
     * existed.
     */
    private readonly positions?: ViewerPositionStore,
  ) {}

  async listPublic(
    tenantId: string,
    filters: BoardFilters,
    opts: BoardListOptions = {},
  ): Promise<BoardLoadRow[]> {
    const rows = await this.store.findPublic(tenantId, filters);
    const radius = await this.buildRadius(filters);
    const filtered = rows.filter((r) => matchesFilters(r, filters, radius ?? undefined));
    const priced = this.withEarnings(filtered, await this.viewerPosition(tenantId));
    // Pair against the whole public set, not the filtered page: a backhaul that
    // the driver's own filters exclude is still the load that fills their empty
    // miles, and it is public data either way.
    const paired =
      opts.roundTrips === false ? priced : this.withRoundTrips(priced, rows);
    return this.withTrustSignals(await this.withLaneAverages(paired));
  }

  private async viewerPosition(tenantId: string): Promise<ViewerPosition | null> {
    if (!this.positions) return null;
    try {
      return await this.positions.viewerPosition(tenantId);
    } catch {
      // A missing position is a smaller loss than a broken board.
      return null;
    }
  }

  /**
   * Price the empty miles to each pickup. Every field is left null when an input
   * is missing, so the card falls back to the plain $/mile rather than showing a
   * figure with an assumption hidden in it.
   */
  private withEarnings(rows: BoardLoadRow[], position: ViewerPosition | null): BoardLoadRow[] {
    for (const row of rows) {
      const e = earning(row, position);
      row.grossPerMile = e.grossPerMile;
      row.deadheadKm = e.deadheadKm;
      row.netPerMile = e.netPerMile;
      row.positionSource = e.positionSource;
      row.positionPlace = e.deadheadKm === null ? null : (position?.place ?? null);
      row.positionAt = e.deadheadKm === null ? null : (position?.at ?? null);
    }
    return rows;
  }

  /** Attach the ranked backhauls for each row, using the whole public set. */
  private withRoundTrips(rows: BoardLoadRow[], pool: BoardLoadRow[]): BoardLoadRow[] {
    if (rows.length === 0) return rows;
    const candidates = pool as unknown as RoundTripCandidate[];
    try {
      for (const row of rows) {
        row.topRoundTrips = roundTrips(row as unknown as RoundTripCandidate, candidates);
      }
    } catch {
      // Pairing is a bonus column: it must never take the board down with it.
      for (const row of rows) row.topRoundTrips = [];
    }
    return rows;
  }

  /**
   * Stamp each row with the posting tenant's trust signals. Batched per page
   * so a board of 500 loads costs a handful of queries, never 500.
   */
  private async withTrustSignals(rows: BoardLoadRow[]): Promise<BoardLoadRow[]> {
    if (!this.trust || rows.length === 0) return rows;
    try {
      const signals = await this.trust.signalsFor(rows.map((r) => r.tenantId));
      for (const row of rows) {
        row.postedByTrust = signals.get(row.tenantId) ?? null;
      }
    } catch {
      // Trust signals are advisory — a failure must never blank the board.
    }
    return rows;
  }

  /** Stamp each row with the marketplace lane benchmark (rate-my-lane). */
  private async withLaneAverages(rows: BoardLoadRow[]): Promise<BoardLoadRow[]> {
    if (rows.length === 0) return rows;
    try {
      const averages = await this.store.laneRateAverages();
      if (averages.length === 0) return rows;
      const byLane = new Map(averages.map((a) => [`${a.originRegion}|${a.destinationRegion}`, a]));
      for (const row of rows) {
        const lane = byLane.get(`${row.originRegion}|${row.destinationRegion}`);
        if (!lane) continue;
        row.laneAvgPerMile = lane.avgPerMile;
        row.laneSamples = lane.samples;
      }
    } catch {
      // Benchmarks are a nice-to-have — never let them break the board.
    }
    return rows;
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