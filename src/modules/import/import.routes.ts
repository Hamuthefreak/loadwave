import type { FastifyInstance } from 'fastify';
import type { ImportService, ExternalLoadInput } from './import.service';

export interface ImportModuleDeps {
  importService: ImportService;
}

const importSchema = {
  type: ['object', 'array'],
  additionalProperties: true,
} as const;

export function registerImportRoutes(app: FastifyInstance, deps: ImportModuleDeps): void {
  app.post<{ Body: ExternalLoadInput | ExternalLoadInput[] }>(
    '/api/import/loads',
    {
      schema: { body: importSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'])(request, reply);
      },
    },
    async (request, reply) => {
      const items = Array.isArray(request.body) ? request.body : [request.body];
      const result = await deps.importService.importLoads(request.user.tenantId, items);
      return reply.code(201).send(result);
    },
  );
}