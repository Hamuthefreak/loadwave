import type { FastifyInstance } from 'fastify';
import type { RatingService } from './rating.service';

export interface RatingModuleDeps {
  ratings: RatingService;
}

const rateBodySchema = {
  type: 'object',
  required: ['loadId', 'stars'],
  additionalProperties: false,
  properties: {
    loadId: { type: 'string', minLength: 1 },
    stars: { type: 'integer', minimum: 1, maximum: 5 },
    comment: { type: 'string', maxLength: 500 },
  },
} as const;

export function registerRatingRoutes(app: FastifyInstance, deps: RatingModuleDeps): void {
  app.post<{ Body: { loadId: string; stars: number; comment?: string } }>(
    '/api/ratings',
    { schema: { body: rateBodySchema }, preHandler: app.authenticate },
    async (request, reply) => {
      const { loadId, stars, comment } = request.body;
      const result = await deps.ratings.rate({
        loadId,
        stars,
        comment,
        raterTenantId: request.user.tenantId,
      });
      return reply.code(201).send(result);
    },
  );

  // Ratings received by the caller's company.
  app.get(
    '/api/ratings/mine',
    { preHandler: app.authenticate },
    async (request) => {
      return deps.ratings.received(request.user.tenantId);
    },
  );
}
