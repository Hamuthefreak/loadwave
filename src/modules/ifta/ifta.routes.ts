import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { EventBus } from '../../events/event-bus';
import { EVENTS, IftaQuarterComputeRequested } from '../../events/domain-events';
import { quarterOf, type Quarter } from '../../utils/quarters';
import type { FuelService, FuelTransactionInput } from '../fuel/fuel.service';
import type { IftaService } from './ifta.service';
import type { UserRole } from '../auth/auth.types';

export interface IftaModuleDeps {
  prisma: PrismaClient;
  bus: EventBus;
  fuel: FuelService;
  ifta: IftaService;
}

interface IftaComputeBody {
  tenantId: string;
  assetId: string;
  driverId: string;
  quarter: string;
  routePoints: Array<{
    occurredAt: string;
    lat: number;
    lon: number;
    vehicleDistanceKm?: number | string;
    speed?: number | string;
    engineHours?: number | string;
    sourceEventId?: string;
  }>;
  fuelTransactions: Array<{
    occurredAt: string;
    jurisdictionCode: string;
    volumeLitres: string | number;
    transactionCurrency: 'CAD' | 'USD';
    amountTransaction: string | number;
    exchangeRateToBase?: string | number;
  }>;
}

const routePointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['occurredAt', 'lat', 'lon'],
  properties: {
    occurredAt: { type: 'string', format: 'date-time' },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lon: { type: 'number', minimum: -180, maximum: 180 },
    vehicleDistanceKm: { type: ['string', 'number'] },
    speed: { type: ['string', 'number'] },
    engineHours: { type: ['string', 'number'] },
    sourceEventId: { type: 'string' },
  },
} as const;

const fuelTxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['occurredAt', 'jurisdictionCode', 'volumeLitres', 'transactionCurrency', 'amountTransaction'],
  properties: {
    occurredAt: { type: 'string', format: 'date-time' },
    jurisdictionCode: { type: 'string', minLength: 2, maxLength: 4 },
    volumeLitres: { type: ['string', 'number'] },
    transactionCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    amountTransaction: { type: ['string', 'number'] },
    exchangeRateToBase: { type: ['string', 'number'] },
  },
} as const;

const computeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'assetId', 'driverId', 'quarter', 'routePoints'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
    assetId: { type: 'string', minLength: 1 },
    driverId: { type: 'string', minLength: 1 },
    quarter: { type: 'string', pattern: '^\\d{4}-Q[1-4]$' },
    routePoints: { type: 'array', minItems: 2, items: routePointSchema },
    fuelTransactions: { type: 'array', items: fuelTxSchema },
  },
} as const;

export function registerIftaRoutes(app: FastifyInstance, deps: IftaModuleDeps): void {
  app.post<{ Body: IftaComputeBody }>(
    '/api/ifta/compute',
    {
      schema: { body: computeSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request: FastifyRequest<{ Body: IftaComputeBody }>, reply: FastifyReply) => {
      const jwtTenantId = request.user.tenantId;
      const payload = request.body;

      // Tenant isolation: every record and computation is scoped to the JWT tenant.
      if (payload.tenantId !== jwtTenantId) {
        return reply.code(403).send({ error: 'Tenant mismatch' });
      }

      const quarter = payload.quarter as Quarter;

      const now = new Date();
      await deps.prisma.routePoint.createMany({
        data: payload.routePoints.map((rp, i) => ({
          tenantId: jwtTenantId,
          driverId: payload.driverId ?? null,
          assetId: payload.assetId,
          occurredAt: new Date(rp.occurredAt),
          lat: rp.lat,
          lon: rp.lon,
          engineHours: rp.engineHours !== undefined ? String(rp.engineHours) : null,
          vehicleDistanceKm: rp.vehicleDistanceKm !== undefined ? String(rp.vehicleDistanceKm) : null,
          speed: rp.speed !== undefined ? String(rp.speed) : null,
          eldEventType: 'GPS',
          sourceEventId: rp.sourceEventId ?? `${jwtTenantId}:ifta:${quarter}:rp:${now.getTime()}:${i}`,
        })),
        skipDuplicates: true,
      });

      const fuelInputs: FuelTransactionInput[] = (payload.fuelTransactions ?? []).map((ft) => ({
        tenantId: jwtTenantId,
        assetId: payload.assetId,
        driverId: payload.driverId ?? null,
        occurredAt: new Date(ft.occurredAt),
        jurisdictionCode: ft.jurisdictionCode,
        volumeLitres: ft.volumeLitres,
        transactionCurrency: ft.transactionCurrency,
        amountTransaction: ft.amountTransaction,
        exchangeRateToBase: ft.exchangeRateToBase ?? null,
        sourceEventId: `${jwtTenantId}:ifta:${quarter}:fuel:${new Date(ft.occurredAt).toISOString()}:${ft.jurisdictionCode}`,
      }));
      await deps.fuel.importMany(fuelInputs);

      // Fire and forget: the asynchronous IFTA worker computes and persists the
      // quarterly summary (see app worker subscriptions).
      void deps.bus.publish(
        EVENTS.IFTA_QUARTER_COMPUTE_REQUESTED,
        new IftaQuarterComputeRequested({
          tenantId: jwtTenantId,
          assetId: payload.assetId,
          driverId: payload.driverId ?? null,
          quarter,
          reason: 'MANUAL',
        }).payload,
      );

      return reply.code(202).send({
        status: 'accepted',
        message: 'IFTA computation requested',
        quarter: payload.quarter,
      });
    },
  );

  app.get<{ Querystring: { quarter?: string; assetId?: string } }>(
    '/api/ifta/summaries',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const quarter = request.query.quarter as Quarter | undefined;
      const summaries = await deps.ifta.getSummaries(
        tenantId,
        quarter ?? quarterOf(new Date()),
        request.query.assetId,
      );
      return reply.send(summaries);
    },
  );
}
