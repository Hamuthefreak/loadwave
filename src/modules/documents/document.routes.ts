import type { FastifyInstance, FastifyReply } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import {
  DOCUMENT_KINDS,
  normalizeDocumentMime,
  type LoadDocumentService,
} from './document.service';
import { SIGNATURE_ROLES, type LoadPaperworkService } from './paperwork.service';

export interface DocumentModuleDeps {
  documents: LoadDocumentService;
  /** Renders the rate confirmation, invoice and signed delivery packet. */
  paperwork: LoadPaperworkService;
}

const signatureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'signerName', 'data'],
  properties: {
    role: { type: 'string', enum: [...SIGNATURE_ROLES] },
    signerName: { type: 'string', minLength: 1, maxLength: 120 },
    /** The drawn signature, as a base64 JPEG straight from the capture canvas. */
    data: { type: 'string', minLength: 1 },
    signedAt: { type: 'string', maxLength: 40 },
  },
} as const;

function isOps(request: { user: { roles: UserRole[] } }): boolean {
  return (request.user.roles as string[]).some((role) => role === 'ADMIN' || role === 'DISPATCHER');
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

  // -------------------------------------------------------------------------
  // Paperwork (PDF)
  //
  // All three are scoped to the caller's own tenant: the service looks the
  // record up by (tenantId, id) and answers 404 otherwise, so a guessed load id
  // cannot pull somebody else's rate confirmation.
  // -------------------------------------------------------------------------
  app.get<{ Params: { loadId: string } }>(
    '/api/loads/:loadId/rate-confirmation.pdf',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const file = await deps.paperwork.rateConfirmation(request.user.tenantId, request.params.loadId);
      return sendPdf(reply, file.fileName, file.pdf);
    },
  );

  app.get<{ Params: { loadId: string } }>(
    '/api/loads/:loadId/packet.pdf',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const file = await deps.paperwork.packet(request.user.tenantId, request.params.loadId);
      return sendPdf(reply, file.fileName, file.pdf);
    },
  );

  app.get<{ Params: { invoiceId: string } }>(
    '/api/invoices/:invoiceId/pdf',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const file = await deps.paperwork.invoicePdf(request.user.tenantId, request.params.invoiceId);
      return sendPdf(reply, file.fileName, file.pdf);
    },
  );

  // -------------------------------------------------------------------------
  // Signatures
  //
  // A DRIVER may sign their own trip (that is the delivery receipt in the
  // packet); ops may sign on the office side. Nobody may sign a load outside
  // their tenant, and a driver may not sign someone else's haul.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { loadId: string };
    Body: { role: string; signerName: string; data: string; signedAt?: string };
  }>(
    '/api/loads/:loadId/signatures',
    {
      schema: { body: signatureSchema },
      bodyLimit: 4 * 1024 * 1024,
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
        if (reply.sent) return;
        if (!isOps(request) && !request.user.driverId) {
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
        }
      },
    },
    async (request, reply) => {
      const assignees = await deps.paperwork.loadAssignees(
        request.user.tenantId,
        request.params.loadId,
      );
      if (!assignees) return reply.code(404).send({ error: 'NOT_FOUND', message: 'load not found' });
      if (!isOps(request) && assignees.driverId !== request.user.driverId) {
        return reply
          .code(403)
          .send({ error: 'FORBIDDEN', message: 'you can only sign for your own trips' });
      }

      const row = await deps.paperwork.captureSignature({
        tenantId: request.user.tenantId,
        loadId: request.params.loadId,
        role: request.body.role,
        signerName: request.body.signerName,
        dataBase64: request.body.data,
        driverId: request.user.driverId,
        capturedById: request.user.sub,
        ...(request.body.signedAt ? { signedAt: new Date(request.body.signedAt) } : {}),
      });
      return reply.code(201).send(row);
    },
  );

  app.get<{ Params: { loadId: string } }>(
    '/api/loads/:loadId/signatures',
    {
      preHandler: async (request, reply) => {
        await app.authenticate(request, reply);
        if (reply.sent) return;
        if (!isOps(request) && !request.user.driverId) {
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'no driver profile is linked to this account' });
        }
      },
    },
    async (request, reply) => {
      const rows = await deps.paperwork.listSignatures(
        request.user.tenantId,
        request.params.loadId,
      );
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
      // Never trust the stored type: rows written before the whitelist existed
      // (or by a future bug) still get served as an opaque download.
      return reply
        .header('Content-Type', normalizeDocumentMime(found.row.mimeType))
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(found.data);
    },
  );
}

/**
 * Serve a generated PDF inline so it previews in a browser tab, with the
 * filename a factor will see if they save it. nosniff because these responses
 * are the one place a crafted load field could otherwise be sniffed as HTML.
 */
function sendPdf(reply: FastifyReply, fileName: string, pdf: Buffer): FastifyReply {
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `inline; filename="${fileName}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(pdf);
}
