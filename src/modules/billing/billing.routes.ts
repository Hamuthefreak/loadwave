import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import type { BillingService } from './billing.service';
import type { UserRole } from '../auth/auth.types';

export interface BillingModuleDeps {
  billing: BillingService;
  /** Operator key. Empty disables plan activation entirely rather than opening it. */
  adminKey: string;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerBillingRoutes(app: FastifyInstance, deps: BillingModuleDeps): void {
  /**
   * Operator-only surface. With no key configured this refuses to serve at
   * all: an unconfigured deployment must never let anyone grant themselves a
   * paid plan.
   */
  async function requireOperator(request: FastifyRequest): Promise<void> {
    const configured = (deps.adminKey ?? '').trim();
    if (!configured) throw notFound('billing administration is not configured on this deployment');
    const provided = String(request.headers['x-billing-key'] ?? '');
    if (!provided || !safeEqual(provided, configured)) {
      throw forbidden('a valid billing key is required');
    }
  }

  /** Current plan, trial clock, entitlement catalog and locked features. */
  app.get('/api/billing/plan', { preHandler: app.authenticate }, async (request) => {
    return deps.billing.overview(request.user.tenantId);
  });

  /**
   * Ask to move onto a paid plan. Recorded durably and shown as pending; the
   * plan only changes when Loadwave activates it, because there is no payment
   * provider wired up yet.
   */
  app.post<{ Body: { plan?: string } }>(
    '/api/billing/plan',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request) => {
      const plan = request.body?.plan;
      if (!plan) throw badRequest('plan is required');
      return deps.billing.requestPlan(request.user.tenantId, request.user.sub ?? null, plan);
    },
  );

  /** Operator queue of pending upgrade requests. */
  app.get('/api/billing/requests', async (request, reply) => {
    await requireOperator(request);
    return reply.send({ requests: await deps.billing.pendingRequests() });
  });

  /** Approve (which switches the tenant onto the plan) or decline. */
  app.post<{ Params: { id: string }; Body: { approve?: boolean; note?: string | null } }>(
    '/api/billing/requests/:id/decide',
    async (request, reply) => {
      await requireOperator(request);
      const approve = request.body?.approve;
      if (typeof approve !== 'boolean') throw badRequest('approve must be true or false');
      const row = await deps.billing.decide(request.params.id, approve, request.body?.note ?? null);
      return reply.send({ request: row });
    },
  );
}

export type { FastifyReply };
