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

/**
 * True when the caller is the driver the document is filed against. Compared by
 * id rather than by role: a dispatcher who happens to drive occasionally still
 * goes through the office path for someone else's file.
 */
function ownsSubject(
  subject: string,
  subjectId: string,
  user: { driverId: string | null },
): boolean {
  return subject.toUpperCase() === 'DRIVER' && !!user.driverId && user.driverId === subjectId;
}

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
        await app.authenticate(request, reply);
        if (reply.sent) return;
        // A driver may renew their own qualification documents and nothing else:
        // the licence and the medical card are theirs to produce, and waiting
        // until they are next in the yard means the truck sits. Their write lands
        // as pending review, so this is a request to the office rather than a
        // way around the gate.
        if (ownsSubject(request.params.subject, request.params.subjectId, request.user)) return;
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) => {
      const subject = request.params.subject.toUpperCase();
      if (!COMPLIANCE_SUBJECTS.includes(subject as (typeof COMPLIANCE_SUBJECTS)[number])) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: 'unknown subject' });
      }
      const selfService = ownsSubject(request.params.subject, request.params.subjectId, request.user);
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
        pendingReview: selfService,
      });
      return reply.code(201).send(row);
    },
  );

  // The holder's own route, so the app never has to know its own driver id and
  // a driver cannot file against somebody else's file by editing a URL. Writes
  // land pending: this is a request to the office, not a way round the gate.
  app.put<{ Params: { kind: string }; Body: { identifier?: string | null; issuedAt?: string | null; expiresAt?: string | null; notes?: string | null; fileName?: string | null; mimeType?: string | null; data?: string | null } }>(
    '/api/compliance/me/:kind',
    {
      schema: { body: upsertSchema },
      bodyLimit: 16 * 1024 * 1024,
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
      },
    },
    async (request, reply) => {
      const driverId = request.user.driverId;
      if (!driverId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
      }
      const row = await deps.compliance.upsert({
        tenantId: request.user.tenantId,
        subject: 'DRIVER',
        subjectId: driverId,
        kind: request.params.kind.toUpperCase(),
        identifier: request.body.identifier ?? null,
        issuedAt: request.body.issuedAt ?? null,
        expiresAt: request.body.expiresAt ?? null,
        notes: request.body.notes ?? null,
        fileName: request.body.fileName ?? null,
        mimeType: request.body.mimeType ?? null,
        dataBase64: request.body.data ?? null,
        uploadedById: request.user.sub,
        pendingReview: true,
      });
      return reply.code(201).send(row);
    },
  );

  // The office accepting a holder's upload. One tap, because the alternative is
  // retyping the dates that are already on the screen — and a confirmation that
  // is tedious is a confirmation that gets skipped in favour of an override.
  app.post<{ Params: { id: string } }>(
    '/api/compliance/:id/confirm',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(OPS)(request, reply);
      },
    },
    async (request, reply) =>
      reply.send(await deps.compliance.confirm(request.user.tenantId, request.params.id, request.user.sub)),
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
