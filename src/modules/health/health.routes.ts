import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../db/prisma';

export interface HealthModuleDeps {
  prisma: PrismaClient;
}

/**
 * Unauthenticated liveness/readiness probe for load balancers and uptime
 * monitors. Deliberately returns no data beyond a database reachability flag.
 */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthModuleDeps): void {
  app.get('/api/health', async (_request, reply) => {
    let db = false;
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    if (!db) {
      return reply.code(503).send({ status: 'degraded', db: false, uptimeSec: Math.round(process.uptime()) });
    }
    return reply.send({ status: 'ok', db: true, uptimeSec: Math.round(process.uptime()) });
  });
}