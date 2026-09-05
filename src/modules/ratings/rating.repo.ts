import type { PrismaClient } from '@prisma/client';

export interface RateableLoadRow {
  id: string;
  tenantId: string;
  bookedByTenantId: string | null;
  status: string;
}

export interface RatingRow {
  id: string;
  loadId: string;
  ratedTenantId: string;
  raterTenantId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
}

export interface RatingView extends RatingRow {
  raterTenantName: string;
  ratedTenantName: string;
}

export interface RatingRepo {
  findLoad(loadId: string): Promise<RateableLoadRow | null>;
  findRating(loadId: string, raterTenantId: string): Promise<{ id: string } | null>;
  insert(input: {
    loadId: string;
    ratedTenantId: string;
    raterTenantId: string;
    stars: number;
    comment?: string;
  }): Promise<RatingRow>;
  /** Recomputes and caches the rated tenant's aggregate; returns the new values. */
  recompute(ratedTenantId: string): Promise<{ ratingCount: number; ratingAvg: number | null }>;
  listFor(tenantId: string): Promise<RatingView[]>;
}

interface PrismaRatingRow {
  id: string;
  loadId: string;
  ratedTenantId: string;
  raterTenantId: string;
  stars: number;
  comment: string | null;
  createdAt: Date;
  raterTenant: { name: string };
  ratedTenant: { name: string };
}

export class PrismaRatingRepo implements RatingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async findLoad(loadId: string): Promise<RateableLoadRow | null> {
    const row = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, tenantId: true, bookedByTenantId: true, status: true },
    });
    return row;
  }

  async findRating(loadId: string, raterTenantId: string): Promise<{ id: string } | null> {
    return this.prisma.carrierRating.findUnique({
      where: { loadId_raterTenantId: { loadId, raterTenantId } },
      select: { id: true },
    });
  }

  async insert(input: {
    loadId: string;
    ratedTenantId: string;
    raterTenantId: string;
    stars: number;
    comment?: string;
  }): Promise<RatingRow> {
    const row = await this.prisma.carrierRating.create({
      data: {
        loadId: input.loadId,
        ratedTenantId: input.ratedTenantId,
        raterTenantId: input.raterTenantId,
        stars: input.stars,
        comment: input.comment?.trim() || null,
      },
    });
    return this.mapBase(row);
  }

  async recompute(ratedTenantId: string): Promise<{ ratingCount: number; ratingAvg: number | null }> {
    const agg = await this.prisma.carrierRating.aggregate({
      where: { ratedTenantId },
      _avg: { stars: true },
      _count: true,
    });
    const updated = await this.prisma.tenant.update({
      where: { id: ratedTenantId },
      data: { ratingCount: agg._count, ratingAvg: agg._avg.stars ?? null },
      select: { ratingCount: true, ratingAvg: true },
    });
    return {
      ratingCount: updated.ratingCount,
      ratingAvg: updated.ratingAvg === null ? null : Number(updated.ratingAvg),
    };
  }

  async listFor(tenantId: string): Promise<RatingView[]> {
    const rows = await this.prisma.carrierRating.findMany({
      where: { ratedTenantId: tenantId },
      select: {
        id: true,
        loadId: true,
        ratedTenantId: true,
        raterTenantId: true,
        stars: true,
        comment: true,
        createdAt: true,
        raterTenant: { select: { name: true } },
        ratedTenant: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.mapView(r as unknown as PrismaRatingRow));
  }

  private mapBase(row: { id: string; loadId: string; ratedTenantId: string; raterTenantId: string; stars: number; comment: string | null; createdAt: Date }): RatingRow {
    return {
      id: row.id,
      loadId: row.loadId,
      ratedTenantId: row.ratedTenantId,
      raterTenantId: row.raterTenantId,
      stars: row.stars,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapView(row: PrismaRatingRow): RatingView {
    return { ...this.mapBase(row), raterTenantName: row.raterTenant.name, ratedTenantName: row.ratedTenant.name };
  }
}
