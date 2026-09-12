import type { FastifyInstance } from 'fastify';
import type { TrustService } from './trust.service';
import { REPORT_CATEGORIES } from './trust.policy';
import type { UserRole } from '../auth/auth.types';

export interface TrustModuleDeps {
  trust: TrustService;
}

const complianceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    authoritySince: { type: ['string', 'null'], maxLength: 40 },
    authorityStatus: { type: 'string', maxLength: 24 },
    insuranceCarrier: { type: ['string', 'null'], maxLength: 120 },
    insurancePolicyNumber: { type: ['string', 'null'], maxLength: 80 },
    cargoInsuranceLimit: { type: ['number', 'null'], minimum: 0, maximum: 100_000_000 },
    insuranceExpiresAt: { type: ['string', 'null'], maxLength: 40 },
  },
} as const;

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subjectTenantId', 'category'],
  properties: {
    subjectTenantId: { type: 'string', minLength: 1, maxLength: 64 },
    loadId: { type: ['string', 'null'], maxLength: 64 },
    category: { type: 'string', enum: [...REPORT_CATEGORIES] },
    details: { type: ['string', 'null'], maxLength: 2000 },
  },
} as const;

const tenantParamSchema = {
  type: 'object',
  required: ['tenantId'],
  additionalProperties: false,
  properties: { tenantId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export function registerTrustRoutes(app: FastifyInstance, deps: TrustModuleDeps): void {
  /** My own signals, exactly as a counterparty sees them, plus what's missing. */
  app.get('/api/trust/me', { preHandler: app.authenticate }, async (request) => {
    return { signals: await deps.trust.signals(request.user.tenantId), reports: await deps.trust.myReports(request.user.tenantId) };
  });

  /** Declare authority and insurance details (self-declared, shown as such). */
  app.patch<{
    Body: {
      authoritySince?: string | null;
      authorityStatus?: string;
      insuranceCarrier?: string | null;
      insurancePolicyNumber?: string | null;
      cargoInsuranceLimit?: number | null;
      insuranceExpiresAt?: string | null;
    };
  }>(
    '/api/trust/me',
    {
      schema: { body: complianceSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request) => {
      return { signals: await deps.trust.setCompliance(request.user.tenantId, request.body ?? {}) };
    },
  );

  /**
   * Aggregate trust signals for another tenant. Amounts, invoices and report
   * text stay private — this is the same shape the board already shows.
   */
  app.get<{ Params: { tenantId: string } }>(
    '/api/trust/tenants/:tenantId',
    { schema: { params: tenantParamSchema }, preHandler: app.authenticate },
    async (request) => {
      return { signals: await deps.trust.signals(request.params.tenantId) };
    },
  );

  /** File a complaint about a counterparty you have actually traded with. */
  app.post<{
    Body: { subjectTenantId: string; loadId?: string | null; category: string; details?: string | null };
  }>(
    '/api/reports',
    { schema: { body: reportSchema }, preHandler: app.authenticate },
    async (request, reply) => {
      const row = await deps.trust.report({
        reporterTenantId: request.user.tenantId,
        subjectTenantId: request.body.subjectTenantId,
        loadId: request.body.loadId ?? null,
        category: request.body.category,
        details: request.body.details ?? null,
      });
      return reply.code(201).send(row);
    },
  );

  app.get('/api/reports/mine', { preHandler: app.authenticate }, async (request) => {
    return { reports: await deps.trust.myReports(request.user.tenantId) };
  });
}
