import type { FastifyInstance } from 'fastify';
import type { DriverService } from './driver.service';
import type { UserRole } from '../auth/auth.types';

export interface DriverModuleDeps {
  drivers: DriverService;
}

interface CreateDriverBody {
  externalEldId?: string;
  name: string;
  licenseNumber?: string;
  homeTerminalTz?: string;
  cycleType?: 'CYCLE_1' | 'CYCLE_2';
}

interface UpdateDriverBody {
  name?: string;
  licenseNumber?: string;
  homeTerminalTz?: string;
  cycleType?: 'CYCLE_1' | 'CYCLE_2';
  status?: 'ACTIVE' | 'OFF_DUTY' | 'SUSPENDED';
}

export function registerDriverRoutes(app: FastifyInstance, deps: DriverModuleDeps): void {
  app.get(
    '/api/drivers',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.drivers.list(request.user.tenantId);
      return reply.send(rows);
    },
  );

  app.get<{ Params: { driverId: string } }>(
    '/api/drivers/:driverId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = request.user;
      if (user.roles.includes('DRIVER' as UserRole) && user.driverId !== request.params.driverId) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'drivers may only view their own profile' });
      }
      const row = await deps.drivers.get(user.tenantId, request.params.driverId);
      return reply.send(row);
    },
  );

  app.post<{ Body: CreateDriverBody }>(
    '/api/drivers',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.drivers.create(request.user.tenantId, request.body);
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { driverId: string }; Body: UpdateDriverBody }>(
    '/api/drivers/:driverId',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.drivers.update(request.user.tenantId, request.params.driverId, request.body);
      return reply.send(row);
    },
  );
}
