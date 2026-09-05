import { badRequest, conflict, notFound } from '../../utils/errors';
import { ratingAllowed, starsInRange, RATING_MAX } from './rating.policy';
import type { RatingRepo, RatingView } from './rating.repo';

export interface RateInput {
  loadId: string;
  raterTenantId: string;
  stars: number;
  comment?: string;
}

export interface RatingService {
  rate(input: RateInput): Promise<{ ratedTenantId: string; stars: number; ratingCount: number; ratingAvg: number | null }>;
  received(tenantId: string): Promise<RatingView[]>;
}

export class PrismaRatingService implements RatingService {
  constructor(private readonly repo: RatingRepo) {}

  async rate(input: RateInput): Promise<{
    ratedTenantId: string;
    stars: number;
    ratingCount: number;
    ratingAvg: number | null;
  }> {
    if (!input.loadId) throw badRequest('loadId is required');
    if (!starsInRange(input.stars)) {
      throw badRequest(`stars must be a whole number between 1 and ${RATING_MAX}`);
    }
    const load = await this.repo.findLoad(input.loadId);
    if (!load) throw notFound('load not found');

    const allowed = ratingAllowed(load, input.raterTenantId);
    if (!allowed.ok || !allowed.ratedTenantId) {
      throw conflict(allowed.reason ?? 'this load cannot be rated');
    }
    const ratedTenantId = allowed.ratedTenantId;

    const existing = await this.repo.findRating(input.loadId, input.raterTenantId);
    if (existing) throw conflict('you have already rated this load');

    await this.repo.insert({
      loadId: input.loadId,
      ratedTenantId,
      raterTenantId: input.raterTenantId,
      stars: input.stars,
      comment: input.comment,
    });
    const summary = await this.repo.recompute(ratedTenantId);
    return { ratedTenantId, stars: input.stars, ratingCount: summary.ratingCount, ratingAvg: summary.ratingAvg };
  }

  async received(tenantId: string): Promise<RatingView[]> {
    return this.repo.listFor(tenantId);
  }
}
