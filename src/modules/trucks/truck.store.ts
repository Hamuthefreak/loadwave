import type { PrismaClient } from '@prisma/client';
import type { TruckFilters } from './truck.policy';

export interface TruckRow {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  equipmentType: string;
  trailerType: string | null;
  locationCountry: string;
  locationRegion: string;
  locationLocality: string | null;
  locationLat: number | null;
  locationLon: number | null;
  availableFrom: string;
  availableTo: string | null;
  rateCurrency: string;
  rateAmount: string | null;
  notes: string | null;
  status: string;
  bookedByTenantId: string | null;
  bookedAt: string | null;
  createdAt: string;
}

export interface TruckCreateInput {
  equipmentType: string;
  trailerType?: string | null;
  locationCountry: string;
  locationRegion: string;
  locationLocality?: string | null;
  locationLat?: number | null;
  locationLon?: number | null;
  availableFrom: Date | string;
  availableTo?: Date | string | null;
  rateCurrency?: string;
  rateAmount?: string | number | null;
  notes?: string | null;
}

export interface TruckStore {
  findPublic(tenantId: string, filters: TruckFilters): Promise<TruckRow[]>;
  findOwned(tenantId: string): Promise<TruckRow[]>;
  findById(truckId: string): Promise<TruckRow | null>;
  create(input: TruckCreateInput & { tenantId: string }): Promise<TruckRow>;
  /** Atomically flips ACTIVE -> BOOKED; false when already taken. */
  claim(truckId: string, tenantId: string, now: Date): Promise<boolean>;
}

interface StoreRow {
  id: string;
  tenantId: string;
  tenant: { name: string };
  equipmentType: string;
  trailerType: string | null;
  locationCountry: string;
  locationRegion: string;
  locationLocality: string | null;
  locationLat: number | null;
  locationLon: number | null;
  availableFrom: Date;
  availableTo: Date | null;
  rateCurrency: string;
  rateAmount: { toString(): string } | null;
  notes: string | null;
  status: string;
  bookedByTenantId: string | null;
  bookedAt: Date | null;
  createdAt: Date;
}

export class PrismaTruckStore implements TruckStore {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: StoreRow): TruckRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      postedByTenantName: row.tenant.name,
      equipmentType: row.equipmentType,
      trailerType: row.trailerType,
      locationCountry: row.locationCountry,
      locationRegion: row.locationRegion,
      locationLocality: row.locationLocality,
      locationLat: row.locationLat,
      locationLon: row.locationLon,
      availableFrom: row.availableFrom.toISOString(),
      availableTo: row.availableTo ? row.availableTo.toISOString() : null,
      rateCurrency: row.rateCurrency,
      rateAmount: row.rateAmount ? row.rateAmount.toString() : null,
      notes: row.notes,
      status: row.status,
      bookedByTenantId: row.bookedByTenantId,
      bookedAt: row.bookedAt ? row.bookedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private select = {
    id: true,
    tenantId: true,
    tenant: { select: { name: true } },
    equipmentType: true,
    trailerType: true,
    locationCountry: true,
    locationRegion: true,
    locationLocality: true,
    locationLat: true,
    locationLon: true,
    availableFrom: true,
    availableTo: true,
    rateCurrency: true,
    rateAmount: true,
    notes: true,
    status: true,
    bookedByTenantId: true,
    bookedAt: true,
    createdAt: true,
  } as const;

  async findPublic(tenantId: string, _filters: TruckFilters): Promise<TruckRow[]> {
    const rows = await this.prisma.truckPost.findMany({
      where: {
        tenantId: { not: tenantId },
        status: { in: ['ACTIVE', 'BOOKED'] },
      },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.map(r as unknown as StoreRow));
  }

  async findOwned(tenantId: string): Promise<TruckRow[]> {
    const rows = await this.prisma.truckPost.findMany({
      where: { tenantId },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.map(r as unknown as StoreRow));
  }

  async findById(truckId: string): Promise<TruckRow | null> {
    const row = await this.prisma.truckPost.findUnique({
      where: { id: truckId },
      select: this.select,
    });
    return row ? this.map(row as unknown as StoreRow) : null;
  }

  async create(input: TruckCreateInput & { tenantId: string }): Promise<TruckRow> {
    const row = await this.prisma.truckPost.create({
      data: {
        tenantId: input.tenantId,
        equipmentType: input.equipmentType.toUpperCase(),
        trailerType: input.trailerType ?? null,
        locationCountry: input.locationCountry.toUpperCase(),
        locationRegion: input.locationRegion.toUpperCase(),
        locationLocality: input.locationLocality ?? null,
        locationLat: input.locationLat ?? null,
        locationLon: input.locationLon ?? null,
        availableFrom: new Date(input.availableFrom),
        availableTo: input.availableTo ? new Date(input.availableTo) : null,
        rateCurrency: input.rateCurrency ?? 'CAD',
        rateAmount: input.rateAmount != null ? String(input.rateAmount) : null,
        notes: input.notes ?? null,
      },
      select: this.select,
    });
    return this.map(row as unknown as StoreRow);
  }

  async claim(truckId: string, tenantId: string, now: Date): Promise<boolean> {
    const res = await this.prisma.truckPost.updateMany({
      where: { id: truckId, status: 'ACTIVE' },
      data: { status: 'BOOKED', bookedByTenantId: tenantId, bookedAt: now },
    });
    return res.count > 0;
  }
}