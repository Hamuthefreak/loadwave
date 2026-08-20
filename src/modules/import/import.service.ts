import type { PrismaClient } from '@prisma/client';
import type { LoadService, LoadCreateInput } from '../invoicing/load.service';
import { badRequest, conflict } from '../../utils/errors';

export interface ExternalLoadInput {
  externalLoadboardId: string;
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
  equipmentType?: string;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  pickupFlexible?: boolean;
  weightKg?: number | string | null;
  commodity?: string | null;
  hazmat?: boolean;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  teamRequired?: boolean;
  detentionRate?: number | string | null;
  stops?: Array<{
    kind?: string;
    stopOrder?: number;
    country: string;
    region: string;
    locality?: string | null;
    lat?: number | null;
    lon?: number | null;
    scheduledAt?: string | null;
    notes?: string | null;
  }>;
  distanceKmEstimate?: number | string | null;
  freightCurrency?: string;
  freightAmountTransaction?: number | string | null;
  marketplaceStatus?: 'PRIVATE' | 'PUBLIC';
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ externalLoadboardId: string; message: string }>;
}

export interface ImportService {
  importLoads(tenantId: string, items: ExternalLoadInput[]): Promise<ImportResult>;
  importLoad(tenantId: string, item: ExternalLoadInput): Promise<{ loadId: string; action: 'created' | 'updated' }>;
}

/**
 * Imports loads from an external load board (JSON). Dedupes on the unique
 * (tenantId, externalLoadboardId) pair: a matching entry is updated in place.
 */
export class PrismaImportService implements ImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly loads: LoadService,
  ) {}

  async importLoads(tenantId: string, items: ExternalLoadInput[]): Promise<ImportResult> {
    if (!Array.isArray(items)) throw badRequest('expected an array of loads');
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (const item of items) {
      try {
        if (!item?.externalLoadboardId?.trim()) {
          throw badRequest('externalLoadboardId is required for import');
        }
        const { action } = await this.importLoad(tenantId, item);
        if (action === 'created') result.created += 1;
        else result.updated += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'import failed';
        if (err instanceof Error && message === 'externalLoadboardId is required for import') {
          result.skipped += 1;
          continue;
        }
        result.errors.push({ externalLoadboardId: item?.externalLoadboardId ?? '', message });
      }
    }
    return result;
  }

  async importLoad(
    tenantId: string,
    item: ExternalLoadInput,
  ): Promise<{ loadId: string; action: 'created' | 'updated' }> {
    if (!item.externalLoadboardId?.trim()) {
      throw badRequest('externalLoadboardId is required for import');
    }
    const exists = await this.prisma.load.findUnique({
      where: { tenantId_externalLoadboardId: { tenantId, externalLoadboardId: item.externalLoadboardId } },
      select: { id: true },
    });
    if (exists) {
      const updated = await this.update(tenantId, exists.id, item);
      return { loadId: updated.id, action: 'updated' };
    }
    const created = await this.create(tenantId, item);
    return { loadId: created.id, action: 'created' };
  }

  private toCreateInput(item: ExternalLoadInput): LoadCreateInput {
    return {
      externalLoadboardId: item.externalLoadboardId,
      originCountry: item.originCountry,
      originRegion: item.originRegion,
      originLocality: item.originLocality,
      originLat: item.originLat,
      originLon: item.originLon,
      destinationCountry: item.destinationCountry,
      destinationRegion: item.destinationRegion,
      destinationLocality: item.destinationLocality,
      destinationLat: item.destinationLat,
      destinationLon: item.destinationLon,
      equipmentType: item.equipmentType,
      pickupDate: item.pickupDate ?? null,
      deliveryDate: item.deliveryDate ?? null,
      pickupFlexible: item.pickupFlexible ?? false,
      weightKg: item.weightKg ?? null,
      commodity: item.commodity ?? null,
      hazmat: item.hazmat ?? false,
      temperatureMin: item.temperatureMin ?? null,
      temperatureMax: item.temperatureMax ?? null,
      teamRequired: item.teamRequired ?? false,
      detentionRate: item.detentionRate ?? null,
      stops: item.stops,
      distanceKmEstimate: item.distanceKmEstimate ?? null,
      freightCurrency: item.freightCurrency ?? 'CAD',
      freightAmountTransaction: item.freightAmountTransaction ?? null,
      marketplaceStatus: item.marketplaceStatus ?? 'PRIVATE',
    };
  }

  private async create(tenantId: string, item: ExternalLoadInput) {
    return this.loads.create(tenantId, this.toCreateInput(item));
  }

  private async update(tenantId: string, loadId: string, item: ExternalLoadInput) {
    const input = this.toCreateInput(item);
    const current = await this.loads.get(tenantId, loadId);
    if (!current) throw conflict('load vanished during import');
    const row = await this.prisma.load.update({
      where: { id: loadId },
      data: {
        originLocality: input.originLocality ?? null,
        originLat: input.originLat ?? null,
        originLon: input.originLon ?? null,
        destinationLocality: input.destinationLocality ?? null,
        destinationLat: input.destinationLat ?? null,
        destinationLon: input.destinationLon ?? null,
        equipmentType: input.equipmentType ? input.equipmentType.toUpperCase() : current.equipmentType,
        pickupDate: input.pickupDate ? new Date(input.pickupDate) : current.pickupDate ? new Date(current.pickupDate) : null,
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : current.deliveryDate ? new Date(current.deliveryDate) : null,
        pickupFlexible: input.pickupFlexible ?? current.pickupFlexible,
        weightKg: input.weightKg != null ? String(input.weightKg) : current.weightKg,
        commodity: input.commodity ?? current.commodity,
        hazmat: input.hazmat ?? current.hazmat,
        temperatureMin: input.temperatureMin ?? current.temperatureMin,
        temperatureMax: input.temperatureMax ?? current.temperatureMax,
        teamRequired: input.teamRequired ?? current.teamRequired,
        detentionRate: input.detentionRate != null ? String(input.detentionRate) : current.detentionRate,
        distanceKmEstimate: input.distanceKmEstimate != null ? String(input.distanceKmEstimate) : current.distanceKmEstimate,
        freightAmountTransaction: input.freightAmountTransaction != null ? String(input.freightAmountTransaction) : current.freightAmountTransaction,
      },
    });
    return row;
  }
}