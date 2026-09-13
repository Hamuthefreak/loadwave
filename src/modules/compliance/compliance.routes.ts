import type { FastifyInstance } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import { COMPLIANCE_KINDS } from './compliance.policy';
import { COMPLIANCE_SUBJECTS, type ComplianceService } from './compliance.service';
import { normalizeDocumentMime } from '../documents/document.service';

export interface ComplianceModuleDeps {
  compliance: ComplianceService;
}

const OPS: UserRole[] = ['ADMIN', 'DISPATCHER'];

const upsertSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    identifier: { type: ['string', 'null'], maxLength: 120 },
    issuedAt: { type: ['string', 'null'], maxLength: 40 },
    expiresAt: { type: ['string', 'null'], maxLength: 40 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
    fileName: { type: ['string', 'null'], maxLength: 255 },
    mimeType: { type: ['string', 'null'], maxLength: 120 },
    /** Base64 scan. Optional — plenty of carriers only record the dates. */
    data: { type: ['string', 'null'] },
  },
} as const;

export function registerComplianceRoutes(app: FastifyInstance, deps: ComplianceModuleDeps): void {
  // The kind registry, so the UI never hard-codes names that could drift from
  // the policy that actually decides what is required.
  app.get(
    '/api/compliance/kinds',
    {
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
      },
    },
    async (_request, reply) =>
      reply.send({
        kinds: COMPLIANCE_KINDS,
        subjects: COMPLIANCE_SUBJECTS,
      }),
  );

  app.get(
    '/api/compliance',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => reply.send(await deps.compliance.list(request.user.tenantId)),
  );

  // A driver sees their own qualification file — they're the one who has to
  // produce a medical card at a scale, so they should know it's about to lapse.
  app.get(
    '/api/compliance/me',
    {
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
      },
    },
    async (request, reply) => {
      if (!request.user.driverId) return reply.send(null);
      return reply.send(await deps.compliance.forDriver(request.user.tenantId, request.user.driverId));
    },
  );

  app.put<{
    Params: { subject: string; subjectId: string; kind: string };
    Body: {
      identifier?: string | null;
      issuedAt?: string | null;
      expiresAt?: string | null;
      notes?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      data?: string | null;
    };
  }>(
    '/api/compliance/:subject/:subjectId/:kind',
    {
      schema: { body: upsertSchema },
      // A photographed certificate can exceed Fastify's default body limit.
      bodyLimit: 16 * 1024 * 1024,
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const subject = request.params.subject.toUpperCase();
      if (!COMPLIANCE_SUBJECTS.includes(subject as (typeof COMPLIANCE_SUBJECTS)[number])) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: 'unknown subject' });
      }
      const row = await deps.compliance.upsert({
        tenantId: request.user.tenantId,
        subject: subject as (typeof COMPLIANCE_SUBJECTS)[number],
        subjectId: request.params.subjectId,
        kind: request.params.kind.toUpperCase(),
        identifier: request.body.identifier ?? null,
        issuedAt: request.body.issuedAt ?? null,
        expiresAt: request.body.expiresAt ?? null,
        notes: request.body.notes ?? null,
        fileName: request.body.fileName ?? null,
        mimeType: request.body.mimeType ?? null,
        dataBase64: request.body.data ?? null,
        uploadedById: request.user.sub,
      });
      return reply.code(201).send(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/compliance/:id',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      await deps.compliance.remove(request.user.tenantId, request.params.id);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/compliance/:id/file',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const found = await deps.compliance.file(request.user.tenantId, request.params.id);
      if (!found) return reply.code(404).send({ error: 'NOT_FOUND', message: 'document not found' });
      const safeName = (found.row.fileName ?? 'document').replace(/[^\w.\- ]+/g, '_');
      // Never trust the stored type — a scan is served as an opaque download so a
      // crafted upload can't be sniffed into something that executes.
      return reply
        .header('Content-Type', normalizeDocumentMime(found.row.mimeType))
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(found.data);
    },
  );
}
