import type { FastifyInstance } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import { settlementPeriod, periodFromInputs, type SettlementPeriod } from './settlement.policy';
import type { SettlementService } from './settlement.service';

export interface SettlementModuleDeps {
  settlements: SettlementService;
}

const OPS: UserRole[] = ['ADMIN', 'DISPATCHER'];

/** The pay period a request is asking about. */
type PeriodQuery = { period?: string; from?: string; to?: string };

const periodQuerySchema = {
  type: 'object',
  properties: {
    period: { type: 'string', enum: ['current', 'last', 'ytd'] },
    from: { type: 'string', maxLength: 10 },
    to: { type: 'string', maxLength: 10 },
  },
} as const;

/**
 * Defaults to the week the driver is standing in — the figure they actually ask
 * about. Explicit `from`/`to` win, then `period`, and the week is resolved in
 * the driver's home-terminal timezone so a Sunday-night delivery lands in the
 * week that is ending rather than the next one.
 */
function resolvePeriod(query: PeriodQuery, tz: string): SettlementPeriod {
  if (query.from && query.to) {
    const explicit = periodFromInputs(query.from, query.to, tz);
    if (explicit) return explicit;
  }
  if (query.period === 'last') return settlementPeriod(new Date(), tz, 1);
  return settlementPeriod(new Date(), tz, 0);
}

export function registerSettlementRoutes(app: FastifyInstance, deps: SettlementModuleDeps): void {
  // A driver's own statement. Registered before the fleet route so `/me` can
  // never be read as a driver id.
  app.get<{ Querystring: PeriodQuery }>(
    '/api/settlements/me',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const user = request.user;
      if (!user.driverId) return reply.send(null);
      const tz = await deps.settlements.driverTimezone(user.tenantId, user.driverId);
      return reply.send(await deps.settlements.forSelf(user.tenantId, user.driverId, resolvePeriod(request.query, tz)));
    },
  );

  app.get<{ Querystring: PeriodQuery }>(
    '/api/settlements',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.tenantTimezone(request.user.tenantId);
      return reply.send(await deps.settlements.overview(request.user.tenantId, resolvePeriod(request.query, tz)));
    },
  );

  app.get<{ Params: { driverId: string }; Querystring: PeriodQuery }>(
    '/api/settlements/drivers/:driverId',
    {
      schema: { querystring: periodQuerySchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const tz = await deps.settlements.driverTimezone(request.user.tenantId, request.params.driverId);
      return reply.send(
        await deps.settlements.forDriver(request.user.tenantId, request.params.driverId, resolvePeriod(request.query, tz)),
      );
    },
  );
}
