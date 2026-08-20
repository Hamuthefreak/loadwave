import type { FastifyInstance } from 'fastify';
import type { MarketService } from './market.service';

export interface MarketModuleDeps {
  market: MarketService;
}

interface ConditionsQuery {
  originRegion?: string;
  equipmentType?: string;
}

export function registerMarketRoutes(app: FastifyInstance, deps: MarketModuleDeps): void {
  app.get<{ Querystring: ConditionsQuery }>(
    '/api/market/conditions',
    { preHandler: app.authenticate },
    async (request) => {
      return deps.market.conditions({
        originRegion: request.query.originRegion,
        equipmentType: request.query.equipmentType,
      });
    },
  );

  app.get<{ Querystring: { days?: string } }>(
    '/api/market/lanes/history',
    { preHandler: app.authenticate },
    async (request) => {
      const days = Number(request.query.days ?? 30);
      return deps.market.laneHistory(Number.isFinite(days) ? days : 30);
    },
  );
}