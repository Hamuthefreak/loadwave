import { ratingAllowed, starsInRange } from '../../src/modules/ratings/rating.policy';
import { PrismaRatingService } from '../../src/modules/ratings/rating.service';
import type { RatingRepo, RatingRow, RatingView, RateableLoadRow } from '../../src/modules/ratings/rating.repo';

class MemoryRatingRepo implements RatingRepo {
  loads: RateableLoadRow[] = [];
  ratings: RatingRow[] = [];
  summary: { ratingCount: number; ratingAvg: number | null } = { ratingCount: 0, ratingAvg: null };

  addLoad(row: RateableLoadRow): void {
    this.loads.push(row);
  }

  async findLoad(loadId: string): Promise<RateableLoadRow | null> {
    return this.loads.find((l) => l.id === loadId) ?? null;
  }

  async findRating(loadId: string, raterTenantId: string): Promise<{ id: string } | null> {
    return this.ratings.find((r) => r.loadId === loadId && r.raterTenantId === raterTenantId) ?? null;
  }

  async insert(input: {
    loadId: string;
    ratedTenantId: string;
    raterTenantId: string;
    stars: number;
    comment?: string;
  }): Promise<RatingRow> {
    const row: RatingRow = {
      id: `r-${this.ratings.length + 1}`,
      loadId: input.loadId,
      ratedTenantId: input.ratedTenantId,
      raterTenantId: input.raterTenantId,
      stars: input.stars,
      comment: input.comment ?? null,
      createdAt: new Date().toISOString(),
    };
    this.ratings.push(row);
    this.summary = { ratingCount: this.ratings.length, ratingAvg: this.ratings.length / 2 };
    return row;
  }

  async recompute(): Promise<{ ratingCount: number; ratingAvg: number | null }> {
    return this.summary;
  }

  async listFor(): Promise<RatingView[]> {
    return this.ratings as unknown as RatingView[];
  }
}

describe('rating.policy', () => {
  const load = { tenantId: 'poster', bookedByTenantId: 'hauler', status: 'DELIVERED' };

  it('validates star bounds', () => {
    expect(starsInRange(1)).toBe(true);
    expect(starsInRange(5)).toBe(true);
    expect(starsInRange(0)).toBe(false);
    expect(starsInRange(6)).toBe(false);
    expect(starsInRange(3.5)).toBe(false);
  });

  it('lets either participant rate the other after delivery', () => {
    expect(ratingAllowed(load, 'hauler')).toEqual({ ok: true, ratedTenantId: 'poster' });
    expect(ratingAllowed(load, 'poster')).toEqual({ ok: true, ratedTenantId: 'hauler' });
  });

  it('rejects outsiders, undelivered loads and self ratings', () => {
    expect(ratingAllowed(load, 'stranger')).toMatchObject({ ok: false });
    expect(ratingAllowed({ ...load, status: 'IN_TRANSIT' }, 'hauler')).toMatchObject({ ok: false });
    expect(ratingAllowed({ ...load, bookedByTenantId: null }, 'poster')).toMatchObject({ ok: false });
    expect(ratingAllowed({ tenantId: 'a', bookedByTenantId: 'a', status: 'DELIVERED' }, 'a')).toMatchObject({ ok: false });
  });
});

describe('PrismaRatingService', () => {
  it('stores a rating and returns the refreshed aggregate', async () => {
    const repo = new MemoryRatingRepo();
    repo.addLoad({ id: 'load-1', tenantId: 'poster', bookedByTenantId: 'hauler', status: 'DELIVERED' });
    const svc = new PrismaRatingService(repo);

    const result = await svc.rate({ loadId: 'load-1', raterTenantId: 'hauler', stars: 5, comment: 'Great partner' });
    expect(result).toMatchObject({ ratedTenantId: 'poster', stars: 5 });
    expect(repo.ratings).toHaveLength(1);
    expect(repo.ratings[0].comment).toBe('Great partner');
  });

  it('rejects a second rating for the same load by the same carrier', async () => {
    const repo = new MemoryRatingRepo();
    repo.addLoad({ id: 'load-1', tenantId: 'poster', bookedByTenantId: 'hauler', status: 'DELIVERED' });
    const svc = new PrismaRatingService(repo);

    await svc.rate({ loadId: 'load-1', raterTenantId: 'hauler', stars: 5 });
    await expect(svc.rate({ loadId: 'load-1', raterTenantId: 'hauler', stars: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects ratings from carriers not on the load', async () => {
    const repo = new MemoryRatingRepo();
    repo.addLoad({ id: 'load-1', tenantId: 'poster', bookedByTenantId: 'hauler', status: 'DELIVERED' });
    const svc = new PrismaRatingService(repo);
    await expect(svc.rate({ loadId: 'load-1', raterTenantId: 'lurker', stars: 5 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
