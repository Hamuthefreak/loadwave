import type { FastifyInstance } from 'fastify';
import type { PrismaTrackingService } from './tracking.service';

export interface TrackingModuleDeps {
  tracking: PrismaTrackingService;
}

/**
 * Two routes, and the difference between them is deliberate.
 *
 * `GET /api/loads/:loadId/tracking` is the company's own view: authenticated,
 * tenant-scoped, and it hands back the link to forward.
 *
 * `GET /api/track/:loadId/:token` is the link itself — no session, because the
 * person opening it is a broker or a receiver with no account on this instance,
 * and demanding one would send the check call straight back to the phone. The
 * derived token in the path is the authorisation (see tracking.token.ts), and a
 * bad token is answered exactly like an unknown load so the endpoint cannot be
 * used to enumerate them.
 */
export function registerTrackingRoutes(app: FastifyInstance, deps: TrackingModuleDeps): void {
  app.get<{ Params: { loadId: string } }>(
    '/api/loads/:loadId/tracking',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const view = await deps.tracking.forLoad(request.user, request.params.loadId);
      return reply.send(view);
    },
  );

  app.get<{ Params: { loadId: string; token: string } }>(
    '/api/track/:loadId/:token',
    async (request, reply) => {
      const view = await deps.tracking.publicView(request.params.loadId, request.params.token);
      if (!view) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'this tracking link is not valid',
        });
      }
      // The truck's position is live data about a business, not a public feed:
      // keep it out of every cache between here and the broker's phone.
      return reply.header('cache-control', 'no-store').send(view);
    },
  );
}
