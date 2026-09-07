import type { FastifyInstance } from 'fastify';
import type { LoadService } from '../invoicing/load.service';
import type { PrismaDetentionService } from '../detention/detention.service';

export interface DispatchModuleDeps {
  loads: LoadService;
  detention: PrismaDetentionService;
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
      // Detention clock per trip: the running timer + closed waiting time.
      const detention = await deps.detention.liveForLoads(rows.map((r) => r.id));
      return reply.send(
        rows.map((r) => ({
          ...r,
          detention: detention.get(r.id) ?? { openEntryId: null, openSeconds: 0, totalMinutes: 0 },
        })),
      );
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
      preHandler: async (request, reply) => {
        // Any signed-in user may attempt this, but only ops roles or the
        // load's assigned driver (enforced in the service) can actually
        // transition it. An unlinked DRIVER account gets a clean 403 here
        // instead of being silently treated as ops.
        await app.authenticate(request, reply);
        if (reply.sent) return;
        const isOps = (request.user.roles as string[]).some((r) => r === 'ADMIN' || r === 'DISPATCHER');
        if (!isOps && !request.user.driverId) {
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
        }
      },
    },
    async (request, reply) => {
      const isOps = (request.user.roles as string[]).some((r) => r === 'ADMIN' || r === 'DISPATCHER');
      const row = await deps.loads.setStatus(request.user.tenantId, request.params.id, request.body.status, {
        isOps,
        driverId: request.user.driverId,
      });
      return reply.send({ ok: true, load: row });
    },
  );
}