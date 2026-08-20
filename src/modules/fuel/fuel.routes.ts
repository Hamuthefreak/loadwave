import type { FastifyInstance } from 'fastify';
import type { FuelService, FuelTransactionInput } from './fuel.service';
import type { FxService, SetFxRateInput } from './fx.service';
import type { Quarter } from '../../utils/quarters';
import type { UserRole } from '../auth/auth.types';

export interface FuelModuleDeps {
  fuel: FuelService;
  fx: FxService;
}

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
