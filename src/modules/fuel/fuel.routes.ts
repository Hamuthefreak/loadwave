import type { FastifyInstance } from 'fastify';
import type { FuelService, FuelTransactionInput } from './fuel.service';
import type { FxService, SetFxRateInput } from './fx.service';
import type { Quarter } from '../../utils/quarters';
import type { UserRole } from '../auth/auth.types';

export interface FuelModuleDeps {
  fuel: FuelService;
  fx: FxService;
}

// Compact cab-side payload: a driver logs volume + unit + price at a pump.
// The service handles L/GAL conversion, FX and IFTA bookkeeping.
const driverFuelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdictionCode', 'volume', 'unit', 'amountTransaction'],
  properties: {
    occurredAt: { type: 'string', format: 'date-time' },
    jurisdictionCode: { type: 'string', minLength: 2, maxLength: 4 },
    volume: { type: ['string', 'number'], minimum: 0 },
    unit: { type: 'string', enum: ['L', 'GAL'] },
    amountTransaction: { type: ['string', 'number'], minimum: 0 },
    transactionCurrency: { type: 'string', enum: ['CAD', 'USD'] },
  },
} as const;

const fuelTxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['occurredAt', 'jurisdictionCode', 'amountTransaction'],
  properties: {
    assetId: { type: 'string' },
    driverId: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    jurisdictionCode: { type: 'string', minLength: 2, maxLength: 4 },
    locationLat: { type: 'number' },
    locationLon: { type: 'number' },
    volumeLitres: { type: ['string', 'number'] },
    originalVolume: { type: ['string', 'number'] },
    originalVolumeUnit: { type: 'string', enum: ['L', 'GAL'] },
    transactionCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    amountTransaction: { type: ['string', 'number'] },
    exchangeRateToBase: { type: ['string', 'number'] },
    taxGstRate: { type: ['string', 'number'] },
    taxHstRate: { type: ['string', 'number'] },
    taxQstRate: { type: ['string', 'number'] },
    taxGstAmount: { type: ['string', 'number'] },
    taxHstAmount: { type: ['string', 'number'] },
    taxQstAmount: { type: ['string', 'number'] },
    fuelType: { type: 'string' },
    sourceEventId: { type: 'string' },
  },
} as const;

export function registerFuelRoutes(app: FastifyInstance, deps: FuelModuleDeps): void {
  app.post<{ Body: FuelTransactionInput }>(
    '/api/fuel/transactions',
    {
      schema: { body: fuelTxSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const created = await deps.fuel.importOne({
        ...request.body,
        tenantId: request.user.tenantId,
      });
      return reply.code(201).send(created);
    },
  );

  app.post<{ Body: { transactions: FuelTransactionInput[] } }>(
    '/api/fuel/transactions/batch',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const rows = await deps.fuel.importMany(
        (request.body.transactions ?? []).map((t) => ({ ...t, tenantId })),
      );
      return reply.code(201).send({ imported: rows.length, transactions: rows });
    },
  );

  app.get<{ Querystring: { quarter?: string } }>(
    '/api/fuel/transactions',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.fuel.list(request.user.tenantId, {
        quarter: request.query.quarter as Quarter | undefined,
      });
      return reply.send(rows);
    },
  );

  app.post<{ Body: { occurredAt?: string; jurisdictionCode: string; volume: string | number; unit: 'L' | 'GAL'; amountTransaction: string | number; transactionCurrency?: 'CAD' | 'USD' } }>(
    '/api/fuel/me',
    {
      schema: { body: driverFuelSchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const driverId = request.user.driverId;
      if (!driverId) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const assetId = await deps.fuel.resolveDriverAssetId(request.user.tenantId, driverId);
      const created = await deps.fuel.importOne({
        tenantId: request.user.tenantId,
        driverId,
        assetId,
        occurredAt: request.body.occurredAt ?? new Date().toISOString(),
        jurisdictionCode: request.body.jurisdictionCode,
        originalVolume: request.body.volume,
        originalVolumeUnit: request.body.unit,
        amountTransaction: request.body.amountTransaction,
        transactionCurrency: request.body.transactionCurrency ?? 'CAD',
      });
      return reply.code(201).send(created);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/fuel/me',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const driverId = request.user.driverId;
      if (!driverId) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const limit = Number(request.query.limit ?? 5);
      const rows = await deps.fuel.listForDriver(request.user.tenantId, driverId, Number.isFinite(limit) ? Math.min(50, limit) : 5);
      return reply.send(rows);
    },
  );

  app.post<{ Body: SetFxRateInput }>(
    '/api/fx/rates',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.fx.setRate({
        ...request.body,
        tenantId: request.user.tenantId,
      });
      return reply.code(201).send(row);
    },
  );
}
