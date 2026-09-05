import type { PrismaClient } from '@prisma/client';
import { d, toDb, type Decimal } from '../../utils/decimal';
import { badRequest, notFound } from '../../utils/errors';
import { EVENTS, LoadDispatched, LoadImported, LoadStatusChanged } from '../../events/domain-events';
import type { EventBus } from '../../events/event-bus';
import { assertTransition, driverMayAdvance } from '../dispatch/dispatch.policy';

export interface LoadStopRow {
  id: string;
  kind: string;
  stopOrder: number;
  country: string;
  region: string;
  locality: string | null;
  lat: number | null;
  lon: number | null;
  scheduledAt: string | null;
  notes: string | null;
}

export interface LoadStopInput {
  kind?: string;
  stopOrder?: number;
  country: string;
  region: string;
  locality?: string | null;
  lat?: number | null;
  lon?: number | null;
  scheduledAt?: Date | string | null;
  notes?: string | null;
}

export interface LoadRow {
  id: string;
  tenantId: string;
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  originLat: number | null;
  originLon: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
  distanceKmEstimate: string | null;
  equipmentType: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  pickupFlexible: boolean;
  weightKg: string | null;
  commodity: string | null;
  hazmat: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  teamRequired: boolean;
  detentionRate: string | null;
  accessorials: unknown;
  stopCount: number;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
  exchangeRateToBase: string;
  isInternational: boolean;
  isContinuousInboundOutbound: boolean;
  interliningPartner: string | null;
  status: string;
  marketplaceStatus: string;
  bookedByTenantId: string | null;
  bookedAt: string | null;
  assigneeDriverId: string | null;
  assigneeAssetId: string | null;
  assignedAt: string | null;
  stops: LoadStopRow[];
  createdAt: string;
}

export interface LoadCreateInput {
  externalLoadboardId?: string | null;
  originCountry: string;
  originRegion: string;
  originLocality?: string | null;
  originLat?: number | null;
  originLon?: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality?: string | null;
  destinationLat?: number | null;
  destinationLon?: number | null;
  distanceKmEstimate?: Decimal | string | number | null;
  equipmentType?: string;
  pickupDate?: Date | string | null;
  deliveryDate?: Date | string | null;
  pickupFlexible?: boolean;
  weightKg?: Decimal | string | number | null;
  commodity?: string | null;
  hazmat?: boolean;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  teamRequired?: boolean;
  detentionRate?: Decimal | string | number | null;
  accessorials?: unknown;
  stopCount?: number;
  stops?: LoadStopInput[];
  freightCurrency?: string;
  freightAmountTransaction?: Decimal | string | number | null;
  exchangeRateToBase?: Decimal | string | number | null;
  isInternational?: boolean;
  isContinuousInboundOutbound?: boolean;
  interliningPartner?: string | null;
  status?: string;
  marketplaceStatus?: 'PRIVATE' | 'PUBLIC';
}

export interface LoadListFilters {
  status?: string;
  marketplaceStatus?: string;
  originRegion?: string;
  destinationRegion?: string;
}

export interface LoadService {
  create(tenantId: string, input: LoadCreateInput): Promise<LoadRow>;
  get(tenantId: string, loadId: string): Promise<LoadRow>;
  list(tenantId: string, filters?: LoadListFilters): Promise<LoadRow[]>;
  // Loads dispatched to a specific driver (their "My Trips" inbox).
  listAssignedToDriver(tenantId: string, driverId: string): Promise<LoadRow[]>;
  assign(tenantId: string, loadId: string, driverId: string | null, assetId: string | null): Promise<LoadRow>;
  setStatus(tenantId: string, loadId: string, status: string, actorUserId?: string, actorDriverId?: string | null): Promise<LoadRow>;
}

interface LoadDbRow {
  id: string;
  tenantId: string;
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  originLat: number | null;
  originLon: number | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
  distanceKmEstimate: Decimal | null;
  equipmentType: string | null;
  pickupDate: Date | null;
  deliveryDate: Date | null;
  pickupFlexible: boolean;
  weightKg: Decimal | null;
  commodity: string | null;
  hazmat: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  teamRequired: boolean;
  detentionRate: Decimal | null;
  accessorials: unknown;
  stopCount: number;
  freightCurrency: string;
  freightAmountTransaction: Decimal | null;
  freightAmountBase: Decimal | null;
  exchangeRateToBase: Decimal;
  isInternational: boolean;
  isContinuousInboundOutbound: boolean;
  interliningPartner: string | null;
  status: string;
  marketplaceStatus: string;
  bookedByTenantId: string | null;
  bookedAt: Date | null;
  assigneeDriverId: string | null;
  assigneeAssetId: string | null;
  assignedAt: Date | null;
  stops: Array<{
    id: string;
    kind: string;
    stopOrder: number;
    country: string;
    region: string;
    locality: string | null;
    lat: number | null;
    lon: number | null;
    scheduledAt: Date | null;
    notes: string | null;
  }>;
  createdAt: Date;
}

export class PrismaLoadService implements LoadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
  ) {}

  private select = {
    id: true,
    tenantId: true,
    externalLoadboardId: true,
    originCountry: true,
    originRegion: true,
    originLocality: true,
    originLat: true,
    originLon: true,
    destinationCountry: true,
    destinationRegion: true,
    destinationLocality: true,
    destinationLat: true,
    destinationLon: true,
    distanceKmEstimate: true,
    equipmentType: true,
    pickupDate: true,
    deliveryDate: true,
    pickupFlexible: true,
    weightKg: true,
    commodity: true,
    hazmat: true,
    temperatureMin: true,
    temperatureMax: true,
    teamRequired: true,
    detentionRate: true,
    accessorials: true,
    stopCount: true,
    freightCurrency: true,
    freightAmountTransaction: true,
    freightAmountBase: true,
    exchangeRateToBase: true,
    isInternational: true,
    isContinuousInboundOutbound: true,
    interliningPartner: true,
    status: true,
    marketplaceStatus: true,
    bookedByTenantId: true,
    bookedAt: true,
    assigneeDriverId: true,
    assigneeAssetId: true,
    assignedAt: true,
    stops: { orderBy: { stopOrder: 'asc' } },
    createdAt: true,
  } as const;

  private map(row: LoadDbRow): LoadRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      externalLoadboardId: row.externalLoadboardId,
      originCountry: row.originCountry,
      originRegion: row.originRegion,
      originLocality: row.originLocality,
      originLat: row.originLat,
      originLon: row.originLon,
      destinationCountry: row.destinationCountry,
      destinationRegion: row.destinationRegion,
      destinationLocality: row.destinationLocality,
      destinationLat: row.destinationLat,
      destinationLon: row.destinationLon,
      distanceKmEstimate: row.distanceKmEstimate ? toDb(d(row.distanceKmEstimate)) : null,
      equipmentType: row.equipmentType,
      pickupDate: row.pickupDate ? row.pickupDate.toISOString() : null,
      deliveryDate: row.deliveryDate ? row.deliveryDate.toISOString() : null,
      pickupFlexible: row.pickupFlexible,
      weightKg: row.weightKg ? toDb(d(row.weightKg)) : null,
      commodity: row.commodity,
      hazmat: row.hazmat,
      temperatureMin: row.temperatureMin,
      temperatureMax: row.temperatureMax,
      teamRequired: row.teamRequired,
      detentionRate: row.detentionRate ? toDb(d(row.detentionRate)) : null,
      accessorials: row.accessorials ?? null,
      stopCount: row.stopCount,
      freightCurrency: row.freightCurrency,
      freightAmountTransaction: row.freightAmountTransaction ? toDb(d(row.freightAmountTransaction)) : null,
      freightAmountBase: row.freightAmountBase ? toDb(d(row.freightAmountBase)) : null,
      exchangeRateToBase: toDb(d(row.exchangeRateToBase)),
      isInternational: row.isInternational,
      isContinuousInboundOutbound: row.isContinuousInboundOutbound,
      interliningPartner: row.interliningPartner,
      status: row.status,
      marketplaceStatus: row.marketplaceStatus,
      bookedByTenantId: row.bookedByTenantId,
      bookedAt: row.bookedAt ? row.bookedAt.toISOString() : null,
      assigneeDriverId: row.assigneeDriverId,
      assigneeAssetId: row.assigneeAssetId,
      assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
      stops: row.stops.map((s) => ({
        id: s.id,
        kind: s.kind,
        stopOrder: s.stopOrder,
        country: s.country,
        region: s.region,
        locality: s.locality,
        lat: s.lat,
        lon: s.lon,
        scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
        notes: s.notes,
      })),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(tenantId: string, input: LoadCreateInput): Promise<LoadRow> {
    if (!input.originCountry || !input.originRegion || !input.destinationCountry || !input.destinationRegion) {
      throw badRequest('origin and destination country/region are required');
    }
    const isInternational =
      input.isInternational ?? input.originCountry.toUpperCase() !== input.destinationCountry.toUpperCase();
    const exchangeRateToBase = input.exchangeRateToBase ? d(input.exchangeRateToBase) : d(1);
    const freightAmountTransaction = input.freightAmountTransaction
      ? d(input.freightAmountTransaction)
      : null;

    const row = await this.prisma.load.create({
      data: {
        tenantId,
        externalLoadboardId: input.externalLoadboardId ?? null,
        originCountry: input.originCountry.toUpperCase(),
        originRegion: input.originRegion.toUpperCase(),
        originLocality: input.originLocality ?? null,
        originLat: input.originLat ?? null,
        originLon: input.originLon ?? null,
        destinationCountry: input.destinationCountry.toUpperCase(),
        destinationRegion: input.destinationRegion.toUpperCase(),
        destinationLocality: input.destinationLocality ?? null,
        destinationLat: input.destinationLat ?? null,
        destinationLon: input.destinationLon ?? null,
        distanceKmEstimate: input.distanceKmEstimate ? toDb(d(input.distanceKmEstimate)) : null,
        equipmentType: input.equipmentType ? input.equipmentType.toUpperCase() : null,
        pickupDate: input.pickupDate ? new Date(input.pickupDate) : null,
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
        pickupFlexible: input.pickupFlexible ?? false,
        weightKg: input.weightKg ? toDb(d(input.weightKg)) : null,
        commodity: input.commodity ?? null,
        hazmat: input.hazmat ?? false,
        temperatureMin: input.temperatureMin ?? null,
        temperatureMax: input.temperatureMax ?? null,
        teamRequired: input.teamRequired ?? false,
        detentionRate: input.detentionRate ? toDb(d(input.detentionRate)) : null,
        accessorials: input.accessorials ?? undefined,
        stopCount: input.stopCount ?? (input.stops?.length ?? 1),
        freightCurrency: input.freightCurrency ?? 'CAD',
        freightAmountTransaction: freightAmountTransaction ? toDb(freightAmountTransaction) : null,
        freightAmountBase: freightAmountTransaction
          ? toDb(freightAmountTransaction.times(exchangeRateToBase))
          : null,
        exchangeRateToBase: toDb(exchangeRateToBase),
        isInternational,
        isContinuousInboundOutbound: input.isContinuousInboundOutbound ?? false,
        interliningPartner: input.interliningPartner ?? null,
        status: input.status ?? 'OPEN',
        marketplaceStatus: input.marketplaceStatus ?? 'PRIVATE',
        stops: input.stops?.length
          ? {
              create: input.stops.map((s, idx) => ({
                tenantId,
                kind: s.kind ?? 'DELIVERY',
                stopOrder: s.stopOrder ?? idx + 1,
                country: s.country.toUpperCase(),
                region: s.region.toUpperCase(),
                locality: s.locality ?? null,
                lat: s.lat ?? null,
                lon: s.lon ?? null,
                scheduledAt: s.scheduledAt ? new Date(s.scheduledAt) : null,
                notes: s.notes ?? null,
              })),
            }
          : undefined,
      },
      select: this.select,
    });

    await this.bus.publish(
      EVENTS.LOAD_IMPORTED,
      new LoadImported({
        tenantId,
        loadId: row.id,
        externalLoadboardId: row.externalLoadboardId,
        originCountry: row.originCountry,
        originRegion: row.originRegion,
        destinationCountry: row.destinationCountry,
        destinationRegion: row.destinationRegion,
        isInternational: row.isInternational,
      }).payload,
    );

    return this.map(row as unknown as LoadDbRow);
  }

  async get(tenantId: string, loadId: string): Promise<LoadRow> {
    const row = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: this.select,
    });
    if (!row) throw notFound('load not found');
    return this.map(row as unknown as LoadDbRow);
  }

  async list(tenantId: string, filters?: LoadListFilters): Promise<LoadRow[]> {
    const rows = await this.prisma.load.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.marketplaceStatus ? { marketplaceStatus: filters.marketplaceStatus } : {}),
        ...(filters?.originRegion ? { originRegion: filters.originRegion.toUpperCase() } : {}),
        ...(filters?.destinationRegion ? { destinationRegion: filters.destinationRegion.toUpperCase() } : {}),
      },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return (rows as unknown as LoadDbRow[]).map((r) => this.map(r));
  }

  async listAssignedToDriver(tenantId: string, driverId: string): Promise<LoadRow[]> {
    const rows = await this.prisma.load.findMany({
      where: { tenantId, assigneeDriverId: driverId },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return (rows as unknown as LoadDbRow[]).map((r) => this.map(r));
  }

  async assign(
    tenantId: string,
    loadId: string,
    driverId: string | null,
    assetId: string | null,
  ): Promise<LoadRow> {
    const row = await this.prisma.load.findFirst({ where: { id: loadId, tenantId } });
    if (!row) throw notFound('load not found');
    if (driverId) {
      const driver = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
      if (!driver) throw notFound('driver not found for this tenant');
    }
    if (assetId) {
      const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
      if (!asset) throw notFound('asset not found for this tenant');
    }
    const updated = await this.prisma.load.update({
      where: { id: loadId },
      data: {
        assigneeDriverId: driverId,
        assigneeAssetId: assetId,
        assignedAt: new Date(),
        status: row.status === 'OPEN' ? 'ASSIGNED' : row.status,
      },
      select: this.select,
    });

    // Notify whoever is affected when the driver actually changes: the new
    // assignee, and the displaced one when the trip moved or was unassigned.
    if (driverId !== row.assigneeDriverId) {
      await this.bus.publish(
        EVENTS.LOAD_DISPATCHED,
        new LoadDispatched({
          tenantId,
          loadId,
          driverId,
          prevDriverId: row.assigneeDriverId,
          originCountry: updated.originCountry,
          originRegion: updated.originRegion,
          destinationCountry: updated.destinationCountry,
          destinationRegion: updated.destinationRegion,
        }).payload,
      );
    }

    return this.map(updated as unknown as LoadDbRow);
  }

  async setStatus(
    tenantId: string,
    loadId: string,
    status: string,
    actorUserId?: string,
    actorDriverId?: string | null,
  ): Promise<LoadRow> {
    void actorUserId;
    const row = await this.prisma.load.findFirst({ where: { id: loadId, tenantId } });
    if (!row) throw notFound('load not found');

    assertTransition(row.status, status);

    // DRIVER role may only advance loads assigned to them.
    if (!driverMayAdvance(row.assigneeDriverId, actorDriverId ?? null)) {
      throw badRequest('this load is not assigned to you');
    }

    const updated = await this.prisma.load.update({
      where: { id: loadId },
      data: { status },
      select: this.select,
    });

    await this.bus.publish(
      EVENTS.LOAD_STATUS_CHANGED,
      new LoadStatusChanged({
        tenantId,
        loadId,
        fromStatus: row.status,
        toStatus: status,
        actorDriverId: actorDriverId ?? null,
        assigneeDriverId: updated.assigneeDriverId,
        originCountry: updated.originCountry,
        originRegion: updated.originRegion,
        destinationCountry: updated.destinationCountry,
        destinationRegion: updated.destinationRegion,
      }).payload,
    );

    return this.map(updated as unknown as LoadDbRow);
  }
}