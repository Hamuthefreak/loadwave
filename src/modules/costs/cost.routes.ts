import type { FastifyInstance } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import type { PrismaCostService } from './cost.service';

export interface CostModuleDeps {
  costs: PrismaCostService;
}

interface PerMileQuery {
  assetId?: string;
  from?: string;
  to?: string;
}

interface DeclaredBody {
  centsPerDay?: number | null;
  note?: string | null;
}

/**
 * Money, so office roles only — the same line every other financial surface in
 * this product draws. A driver sees what they are paid; what the truck costs to
 * own is the owner's business.
 */
export function registerCostRoutes(app: FastifyInstance, deps: CostModuleDeps): void {
  app.get<{ Querystring: PerMileQuery }>(
    '/api/costs/per-mile',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const result = await deps.costs.perMile(request.user.tenantId, {
        assetId: request.query.assetId ?? null,
        from: request.query.from ?? null,
        to: request.query.to ?? null,
      });
      return reply.send(result);
    },
  );

  app.put<{ Params: { assetId: string }; Body: DeclaredBody }>(
    '/api/costs/declared/:assetId',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const declared = await deps.costs.setDeclaredCost(
        request.user.tenantId,
        request.params.assetId,
        {
          centsPerDay: request.body?.centsPerDay ?? null,
          note: request.body?.note ?? null,
        },
      );
      return reply.send({ declared });
    },
  );
}
