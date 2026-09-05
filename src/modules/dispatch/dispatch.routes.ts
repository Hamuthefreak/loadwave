import type { FastifyInstance } from 'fastify';
import type { LoadService } from '../invoicing/load.service';

export interface DispatchModuleDeps {
  loads: LoadService;
}

const assignSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    driverId: { type: ['string', 'null'] },
    assetId: { type: ['string', 'null'] },
  },
} as const;

const statusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['OPEN', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED'] },
  },
} as const;

export function registerDispatchRoutes(app: FastifyInstance, deps: DispatchModuleDeps): void {
  // Driver trip inbox: loads dispatched to the signed-in driver's linked record.
  app.get(
    '/api/loads/mine',
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.user.driverId) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const rows = await deps.loads.listAssignedToDriver(request.user.tenantId, request.user.driverId);
      return reply.send(rows);
    },
  );

  app.patch<{ Params: { id: string }; Body: { driverId?: string | null; assetId?: string | null } }>(
    '/api/loads/:id/assign',
    {
      schema: { body: assignSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.loads.assign(
        request.user.tenantId,
        request.params.id,
        request.body?.driverId ?? null,
        request.body?.assetId ?? null,
      );
      return reply.send({ ok: true, load: row });
    },
  );

  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/api/loads/:id/status',
    {
      schema: { body: statusSchema },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const row = await deps.loads.setStatus(
        request.user.tenantId,
        request.params.id,
        request.body.status,
        request.user.sub,
        request.user.driverId,
      );
      return reply.send({ ok: true, load: row });
    },
  );
}