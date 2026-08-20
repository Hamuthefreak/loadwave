import type { FastifyInstance } from 'fastify';
import type { LoadBoardService } from './board.service';
import type { BoardFilters } from './board.policy';
import type { UserRole } from '../auth/auth.types';

export interface BoardModuleDeps {
  board: LoadBoardService;
}

interface BoardQuery {
  originCountry?: string;
  originRegion?: string;
  originLocality?: string;
  originRadiusKm?: string;
  destinationCountry?: string;
  destinationRegion?: string;
  destinationLocality?: string;
  destinationRadiusKm?: string;
  minFreight?: string;
  maxFreight?: string;
  pickupAfter?: string;
  pickupBefore?: string;
  deliveryAfter?: string;
  deliveryBefore?: string;
  availableNow?: string;
  equipmentType?: string;
  minWeightKg?: string;
  hazmat?: string;
  commodity?: string;
  teamRequired?: string;
  q?: string;
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v === 'true' || v === '1';
}

export function registerBoardRoutes(app: FastifyInstance, deps: BoardModuleDeps): void {
  app.get<{ Querystring: BoardQuery }>(
    '/api/board/loads',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const filters: BoardFilters = {
        originCountry: request.query.originCountry,
        originRegion: request.query.originRegion,
        originLocality: request.query.originLocality,
        originRadiusKm: request.query.originRadiusKm,
        destinationCountry: request.query.destinationCountry,
        destinationRegion: request.query.destinationRegion,
        destinationLocality: request.query.destinationLocality,
        destinationRadiusKm: request.query.destinationRadiusKm,
        minFreight: request.query.minFreight,
        maxFreight: request.query.maxFreight,
        pickupAfter: request.query.pickupAfter,
        pickupBefore: request.query.pickupBefore,
        deliveryAfter: request.query.deliveryAfter,
        deliveryBefore: request.query.deliveryBefore,
        availableNow: bool(request.query.availableNow),
        equipmentType: request.query.equipmentType,
        minWeightKg: request.query.minWeightKg,
        hazmat: bool(request.query.hazmat),
        commodity: request.query.commodity,
        teamRequired: bool(request.query.teamRequired),
        q: request.query.q,
      };
      const rows = await deps.board.listPublic(request.user.tenantId, filters);
      return reply.send(rows);
    },
  );

  app.get(
    '/api/board/loads/my',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const rows = await deps.board.listOwn(request.user.tenantId);
      return reply.send(rows);
    },
  );

  app.post<{ Params: { loadId: string } }>(
    '/api/board/loads/:loadId/book',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER', 'DRIVER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.board.book(request.user.tenantId, request.params.loadId);
      return reply.code(200).send(row);
    },
  );

  app.post<{ Params: { loadId: string } }>(
    '/api/board/loads/:loadId/list',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.board.makePublic(request.user.tenantId, request.params.loadId);
      return reply.code(200).send(row);
    },
  );
}