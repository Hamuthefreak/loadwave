import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthorized } from '../../utils/errors';
import type { EldBatchInput, EldIngestService } from './eld.ingest.service';
import type { UserRole } from '../auth/auth.types';
import type { HosService } from '../hos/hos.service';

export interface EldModuleDeps {
  eldIngest: EldIngestService;
  hos: HosService;
  eldWebhookSecret: string;
}

const eventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceEventId', 'driverEldId', 'eventType', 'occurredAt'],
  properties: {
    sourceEventId: { type: 'string', minLength: 1 },
    driverEldId: { type: 'string', minLength: 1 },
    deviceId: { type: 'string' },
    eventType: { type: 'string', enum: ['GPS', 'DUTY_CHANGE'] },
    occurredAt: { type: 'string', format: 'date-time' },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lon: { type: 'number', minimum: -180, maximum: 180 },
    speed: { type: ['number', 'string'] },
    engineHours: { type: ['number', 'string'] },
    vehicleDistance: { type: ['number', 'string'] },
    vehicleDistanceUnit: { type: 'string', enum: ['KM', 'MI'] },
    dutyStatus: { type: 'string' },
  },
} as const;

const batchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'events'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    ingestSource: { type: 'string', enum: ['WEBHOOK', 'REST_POLL', 'MANUAL'] },
    buildRouteSegments: { type: 'boolean' },
    events: { type: 'array', minItems: 1, items: eventSchema },
  },
} as const;

interface WebhookBody {
  tenantId: string;
  ingestSource?: 'WEBHOOK' | 'REST_POLL' | 'MANUAL';
  events: Array<Record<string, unknown>>;
  buildRouteSegments?: boolean;
}

function verifyWebhook(req: FastifyRequest, secret: string): void {
  const header = (req.headers['x-eld-webhook-secret'] ?? req.headers['webhook-secret']) as string | undefined;
  if (!secret) {
    // Secret not configured: endpoint disabled.
    throw unauthorized('ELD webhooks are not enabled on this instance');
  }
  if (!header || header !== secret) throw unauthorized('invalid ELD webhook secret');
}

export function registerEldRoutes(app: FastifyInstance, deps: EldModuleDeps): void {
  app.post<{ Body: WebhookBody }>(
    '/api/eld/webhook',
    {
      schema: { body: batchSchema },
      preValidation: (req: FastifyRequest) => {
        verifyWebhook(req, deps.eldWebhookSecret);
      },
    },
    async (request, reply) => {
      const input: EldBatchInput = {
        tenantId: request.body.tenantId,
        ingestSource: request.body.ingestSource ?? 'WEBHOOK',
        buildRouteSegments: request.body.buildRouteSegments ?? true,
        events: request.body.events as unknown as EldBatchInput['events'],
      };
      const result = await deps.eldIngest.ingestBatch(input);
      return reply.code(202).send(result);
    },
  );

  app.post<{ Body: Omit<WebhookBody, 'tenantId'> }>(
    '/api/eld/events',
    {
      schema: { body: { ...batchSchema, required: ['events'] } },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const input: EldBatchInput = {
        tenantId: request.user.tenantId,
        ingestSource: 'REST_POLL',
        buildRouteSegments: request.body.buildRouteSegments ?? true,
        events: request.body.events as unknown as EldBatchInput['events'],
      };
      const result = await deps.eldIngest.ingestBatch(input);
      return reply.code(202).send(result);
    },
  );

  app.get<{ Params: { driverId: string } }>(
    '/api/hos/status/:driverId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = request.user;
      const target = request.params.driverId;
      if (user.roles.includes('DRIVER' as UserRole) && user.driverId !== target) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'drivers may only query their own HOS status' });
      }
      const status = await deps.hos.getStatus(user.tenantId, target);
      return reply.send(status);
    },
  );
}
