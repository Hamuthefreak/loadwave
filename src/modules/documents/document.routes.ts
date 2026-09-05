import type { FastifyInstance } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import {
  DOCUMENT_KINDS,
  type LoadDocumentService,
} from './document.service';

export interface DocumentModuleDeps {
  documents: LoadDocumentService;
}

const documentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'fileName', 'data'],
  properties: {
    kind: { type: 'string', enum: DOCUMENT_KINDS },
    fileName: { type: 'string', minLength: 1, maxLength: 255 },
    mimeType: { type: 'string', maxLength: 120 },
    data: { type: 'string', minLength: 1 }, // base64 payload
  },
} as const;

export function registerDocumentRoutes(app: FastifyInstance, deps: DocumentModuleDeps): void {
  app.post<{ Params: { loadId: string }; Body: { kind: string; fileName: string; mimeType?: string; data: string } }>(
    '/api/loads/:loadId/documents',
    {
      schema: { body: documentSchema },
      // Base64 of a POD photo can exceed Fastify's default 1 MB body limit.
      bodyLimit: 16 * 1024 * 1024,
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const row = await deps.documents.upload({
        tenantId: request.user.tenantId,
        loadId: request.params.loadId,
        kind: request.body.kind as typeof DOCUMENT_KINDS[number],
        fileName: request.body.fileName,
        mimeType: request.body.mimeType,
        dataBase64: request.body.data,
        uploadedById: request.user.sub,
      });
      return reply.code(201).send(row);
    },
  );

  app.get<{ Params: { loadId: string } }>(
    '/api/loads/:loadId/documents',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.documents.list(request.user.tenantId, request.params.loadId);
      return reply.send(rows);
    },
  );

  app.get<{ Params: { loadId: string; documentId: string } }>(
    '/api/loads/:loadId/documents/:documentId',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const found = await deps.documents.get(
        request.user.tenantId,
        request.params.loadId,
        request.params.documentId,
      );
      if (!found) return reply.code(404).send({ error: 'NOT_FOUND', message: 'document not found' });
      const safeName = found.row.fileName.replace(/[^\w.\- ]+/g, '_');
      return reply
        .header('Content-Type', found.row.mimeType)
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .send(found.data);
    },
  );
}
