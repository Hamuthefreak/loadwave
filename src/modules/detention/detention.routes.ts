import type { FastifyInstance } from 'fastify';
import type { PrismaDetentionService } from './detention.service';

export interface DetentionModuleDeps {
  detention: PrismaDetentionService;
}

export function registerDetentionRoutes(app: FastifyInstance, deps: DetentionModuleDeps): void {
  app.post(
    '/api/loads/:id/detention/start',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const entry = await deps.detention.start(request.user, id);
      return reply.send(entry);
    },
  );

  app.post(
    '/api/detention/:id/stop',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const entry = await deps.detention.stop(request.user, id);
      return reply.send(entry);
    },
  );

  app.get(
    '/api/loads/:id/detention',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await deps.detention.forLoad(request.user, id));
    },
  );
}
