import type { FastifyInstance } from 'fastify';
import type { TenantService } from './tenant.service';
import type { UserRole } from '../auth/auth.types';

export interface TenantModuleDeps {
  tenants: TenantService;
}

export function registerTenantRoutes(app: FastifyInstance, deps: TenantModuleDeps): void {
  app.get('/api/tenants/me', { preHandler: app.authenticate }, async (request, reply) => {
    const tenant = await deps.tenants.getTenant(request.user.tenantId);
    return reply.send(tenant);
  });

  app.patch<{
    Body: {
      name?: string;
      baseCurrency?: string;
      baseJurisdiction?: string;
      mcNumber?: string;
      usdotNumber?: string;
    };
  }>(
    '/api/tenants/me',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const tenant = await deps.tenants.updateTenant(request.user.tenantId, request.body ?? {});
      return reply.send(tenant);
    },
  );
}
