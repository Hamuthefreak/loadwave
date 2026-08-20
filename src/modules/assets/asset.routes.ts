import type { FastifyInstance } from 'fastify';
import type { AssetService } from './asset.service';
import type { UserRole } from '../auth/auth.types';

export interface AssetModuleDeps {
  assets: AssetService;
}

interface CreateAssetBody {
  vin?: string;
  powerUnitNumber?: string;
  assetType?: 'TRACTOR' | 'TRAILER';
  eldDeviceId?: string;
}

export function registerAssetRoutes(app: FastifyInstance, deps: AssetModuleDeps): void {
  app.get(
    '/api/assets',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.assets.list(request.user.tenantId);
      return reply.send(rows);
    },
  );

  app.get<{ Params: { assetId: string } }>(
    '/api/assets/:assetId',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.assets.get(request.user.tenantId, request.params.assetId);
      return reply.send(row);
    },
  );

  app.post<{ Body: CreateAssetBody }>(
    '/api/assets',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.assets.create(request.user.tenantId, request.body);
      return reply.code(201).send(row);
    },
  );
}
