import type { FastifyInstance } from 'fastify';
import type { SavedSearchService } from './saved-search.service';
import type { BoardFilters } from '../board/board.policy';

export interface SearchModuleDeps {
  searches: SavedSearchService;
}

const filtersSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    originCountry: { type: 'string' },
    originRegion: { type: 'string' },
    originLocality: { type: 'string' },
    originRadiusKm: { type: ['string', 'number'] },
    destinationCountry: { type: 'string' },
    destinationRegion: { type: 'string' },
    destinationLocality: { type: 'string' },
    destinationRadiusKm: { type: ['string', 'number'] },
    minFreight: { type: ['string', 'number'] },
    maxFreight: { type: ['string', 'number'] },
    pickupAfter: { type: 'string' },
    pickupBefore: { type: 'string' },
    deliveryAfter: { type: 'string' },
    deliveryBefore: { type: 'string' },
    availableNow: { type: ['boolean', 'string'] },
    equipmentType: { type: 'string' },
    minWeightKg: { type: ['string', 'number'] },
    hazmat: { type: ['boolean', 'string'] },
    commodity: { type: 'string' },
    teamRequired: { type: ['boolean', 'string'] },
    q: { type: 'string' },
  },
} as const;

const createSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    filters: filtersSchema,
    notify: { type: 'boolean', default: false },
  },
} as const;

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    filters: filtersSchema,
    notify: { type: 'boolean' },
  },
} as const;

export function registerSearchRoutes(app: FastifyInstance, deps: SearchModuleDeps): void {
  app.post<{ Body: { name?: string; filters?: BoardFilters; notify?: boolean } }>(
    '/api/searches',
    { schema: { body: createSchema }, preHandler: app.authenticate },
    async (request, reply) => {
      const row = await deps.searches.create(request.user.tenantId, {
        name: request.body?.name,
        filters: request.body?.filters ?? {},
        notify: request.body?.notify ?? false,
      });
      return reply.code(201).send(row);
    },
  );

  app.get(
    '/api/searches',
    { preHandler: app.authenticate },
    async (request) => {
      return deps.searches.list(request.user.tenantId);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/searches/:id',
    { preHandler: app.authenticate },
    async (request) => {
      return deps.searches.get(request.user.tenantId, request.params.id);
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; filters?: BoardFilters; notify?: boolean } }>(
    '/api/searches/:id',
    { schema: { body: updateSchema }, preHandler: app.authenticate },
    async (request) => {
      return deps.searches.update(request.user.tenantId, request.params.id, {
        name: request.body?.name,
        filters: request.body?.filters,
        notify: request.body?.notify,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/searches/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      await deps.searches.remove(request.user.tenantId, request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/searches/:id/match',
    { preHandler: app.authenticate },
    async (request) => {
      return deps.searches.match(request.user.tenantId, request.params.id);
    },
  );
}