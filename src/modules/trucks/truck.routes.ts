import type { FastifyInstance } from 'fastify';
import type { ITruckService } from './truck.service';
import type { TruckFilters } from './truck.policy';
import type { TruckCreateInput } from './truck.store';
import type { UserRole } from '../auth/auth.types';

export interface TruckModuleDeps {
  trucks: ITruckService;
}

interface TruckQuery {
  locationCountry?: string;
  locationRegion?: string;
  locationLocality?: string;
  locationRadiusKm?: string;
  equipmentType?: string;
  minRate?: string;
  maxRate?: string;
  q?: string;
}

const truckCreateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['equipmentType', 'locationCountry', 'locationRegion', 'availableFrom'],
  properties: {
    equipmentType: { type: 'string', minLength: 1, maxLength: 40 },
    trailerType: { type: 'string' },
    locationCountry: { type: 'string', minLength: 2, maxLength: 2 },
    locationRegion: { type: 'string', minLength: 2, maxLength: 4 },
    locationLocality: { type: 'string' },
    locationLat: { type: ['number', 'null'] },
    locationLon: { type: ['number', 'null'] },
    availableFrom: { type: 'string', format: 'date-time' },
    availableTo: { type: 'string', format: 'date-time' },
    rateCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    rateAmount: { type: ['string', 'number'] },
    notes: { type: 'string' },
  },
} as const;

export function registerTruckRoutes(app: FastifyInstance, deps: TruckModuleDeps): void {
  app.post<{ Body: TruckCreateInput }>(
    '/api/trucks',
    {
      schema: { body: truckCreateSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.trucks.post(request.user.tenantId, request.body);
      return reply.code(201).send(row);
    },
  );

  app.get<{ Querystring: TruckQuery }>(
    '/api/trucks',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const filters: TruckFilters = {
        locationCountry: request.query.locationCountry,
        locationRegion: request.query.locationRegion,
        locationLocality: request.query.locationLocality,
        locationRadiusKm: request.query.locationRadiusKm,
        equipmentType: request.query.equipmentType,
        minRate: request.query.minRate,
        maxRate: request.query.maxRate,
        q: request.query.q,
      };
      const rows = await deps.trucks.listPublic(request.user.tenantId, filters);
      return reply.send(rows);
    },
  );

  app.get(
    '/api/trucks/my',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const rows = await deps.trucks.listOwn(request.user.tenantId);
      return reply.send(rows);
    },
  );

  app.post<{ Params: { truckId: string } }>(
    '/api/trucks/:truckId/book',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const row = await deps.trucks.book(request.user.tenantId, request.params.truckId);
      return reply.code(200).send(row);
    },
  );
}