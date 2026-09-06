import type { FastifyInstance } from 'fastify';
import type { ImportService, ExternalLoadInput } from './import.service';

export interface ImportModuleDeps {
  importService: ImportService;
}

// Validate the fields the importer actually reads. Extra fields from external
// boards are tolerated (additionalProperties: true), but bad coordinates,
// rates, dates or a missing external id are rejected up front instead of
// poisoning the loads table.
const importItemSchema = {
  type: 'object',
  required: ['externalLoadboardId', 'originCountry', 'originRegion', 'destinationCountry', 'destinationRegion'],
  additionalProperties: true,
  properties: {
    externalLoadboardId: { type: 'string', minLength: 1, maxLength: 255 },
    originCountry: { type: 'string', minLength: 2, maxLength: 2 },
    originRegion: { type: 'string', minLength: 2, maxLength: 4 },
    originLocality: { type: ['string', 'null'] },
    originLat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
    originLon: { type: ['number', 'null'], minimum: -180, maximum: 180 },
    destinationCountry: { type: 'string', minLength: 2, maxLength: 2 },
    destinationRegion: { type: 'string', minLength: 2, maxLength: 4 },
    destinationLocality: { type: ['string', 'null'] },
    destinationLat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
    destinationLon: { type: ['number', 'null'], minimum: -180, maximum: 180 },
    equipmentType: { type: 'string', maxLength: 60 },
    pickupDate: { type: ['string', 'null'], format: 'date-time' },
    deliveryDate: { type: ['string', 'null'], format: 'date-time' },
    pickupFlexible: { type: 'boolean' },
    weightKg: { type: ['number', 'string', 'null'] },
    commodity: { type: ['string', 'null'], maxLength: 200 },
    hazmat: { type: 'boolean' },
    temperatureMin: { type: ['number', 'null'], minimum: -100, maximum: 100 },
    temperatureMax: { type: ['number', 'null'], minimum: -100, maximum: 100 },
    teamRequired: { type: 'boolean' },
    detentionRate: { type: ['number', 'string', 'null'] },
    distanceKmEstimate: { type: ['number', 'string', 'null'] },
    freightCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    freightAmountTransaction: { type: ['number', 'string', 'null'] },
    marketplaceStatus: { type: 'string', enum: ['PRIVATE', 'PUBLIC'] },
    stops: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          country: { type: 'string', minLength: 2, maxLength: 2 },
          region: { type: 'string', minLength: 2, maxLength: 4 },
          locality: { type: ['string', 'null'] },
          lat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
          lon: { type: ['number', 'null'], minimum: -180, maximum: 180 },
          scheduledAt: { type: ['string', 'null'], format: 'date-time' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

const importSchema = {
  type: ['object', 'array'],
  items: importItemSchema,
  maxItems: 1000,
  additionalProperties: true,
} as const;

export function registerImportRoutes(app: FastifyInstance, deps: ImportModuleDeps): void {
  app.post<{ Body: ExternalLoadInput | ExternalLoadInput[] }>(
    '/api/import/loads',
    {
      schema: { body: importSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'])(request, reply);
      },
    },
    async (request, reply) => {
      const items = Array.isArray(request.body) ? request.body : [request.body];
      const result = await deps.importService.importLoads(request.user.tenantId, items);
      return reply.code(201).send(result);
    },
  );
}