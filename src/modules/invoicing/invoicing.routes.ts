import type { FastifyInstance } from 'fastify';
import type { LoadCreateInput, LoadService } from './load.service';
import type { InvoiceCreateInput, InvoiceService } from './invoice.service';
import type { Quarter } from '../../utils/quarters';
import type { UserRole } from '../auth/auth.types';

export interface InvoicingModuleDeps {
  loads: LoadService;
  invoices: InvoiceService;
}

const loadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['originCountry', 'originRegion', 'destinationCountry', 'destinationRegion'],
  properties: {
    externalLoadboardId: { type: 'string' },
    originCountry: { type: 'string', minLength: 2, maxLength: 2 },
    originRegion: { type: 'string', minLength: 2, maxLength: 4 },
    destinationCountry: { type: 'string', minLength: 2, maxLength: 2 },
    destinationRegion: { type: 'string', minLength: 2, maxLength: 4 },
    distanceKmEstimate: { type: ['string', 'number'] },
    equipmentType: { type: 'string' },
    pickupDate: { type: 'string', format: 'date-time' },
    deliveryDate: { type: 'string', format: 'date-time' },
    freightCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    freightAmountTransaction: { type: ['string', 'number'] },
    exchangeRateToBase: { type: ['string', 'number'] },
    isInternational: { type: 'boolean' },
    isContinuousInboundOutbound: { type: 'boolean' },
    interliningPartner: { type: 'string' },
    status: { type: 'string' },
  },
} as const;

const invoiceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['customerId'],
  properties: {
    customerId: { type: 'string' },
    loadId: { type: 'string' },
    issueDate: { type: 'string', format: 'date-time' },
    dueDate: { type: 'string', format: 'date-time' },
    currencyTransaction: { type: 'string', enum: ['CAD', 'USD'] },
    subtotalTransaction: { type: ['string', 'number'] },
    exchangeRateToBase: { type: ['string', 'number'] },
  },
} as const;

export function registerInvoicingRoutes(app: FastifyInstance, deps: InvoicingModuleDeps): void {
  app.patch<{ Params: { invoiceId: string }; Body: { paid?: boolean; paidAt?: string } }>(
    '/api/invoices/:invoiceId/pay',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            paid: { type: 'boolean', default: true },
            paidAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.invoices.setPaid(request.user.tenantId, request.params.invoiceId, {
        paid: request.body?.paid ?? true,
        paidAt: request.body?.paidAt,
      });
      return reply.send(row);
    },
  );

  app.get(
    '/api/ar/aging',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const report = await deps.invoices.aging(request.user.tenantId);
      return reply.send(report);
    },
  );

  app.post<{ Body: LoadCreateInput }>(
    '/api/loads',
    {
      schema: { body: loadSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.loads.create(request.user.tenantId, request.body);
      return reply.code(201).send(row);
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    '/api/loads',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.loads.list(request.user.tenantId, {
        status: request.query.status,
      });
      return reply.send(rows);
    },
  );

  app.post<{ Body: InvoiceCreateInput }>(
    '/api/invoices',
    {
      schema: { body: invoiceSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.invoices.createForLoad({
        tenantId: request.user.tenantId,
        customerId: request.body.customerId,
        loadId: request.body.loadId ?? null,
        issueDate: request.body.issueDate,
        dueDate: request.body.dueDate,
        currencyTransaction: request.body.currencyTransaction,
        subtotalTransaction: request.body.subtotalTransaction,
        exchangeRateToBase: request.body.exchangeRateToBase ?? null,
      });
      return reply.code(201).send(row);
    },
  );

  app.get<{ Querystring: { quarter?: string } }>(
    '/api/invoices',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.invoices.list(request.user.tenantId, {
        quarter: request.query.quarter as Quarter | undefined,
      });
      return reply.send(rows);
    },
  );
}
