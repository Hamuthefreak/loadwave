import type { FastifyInstance } from 'fastify';
import type { MessageService } from './messages.service';

export interface MessageModuleDeps {
  messages: MessageService;
}

const postBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    body: { type: 'string', maxLength: 2000 },
    proposedAmount: { type: 'number', exclusiveMinimum: 0, maximum: 10_000_000 },
    /** Poster only: the carrier this reply is addressed to. */
    toTenantId: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

const paramsSchema = {
  type: 'object',
  required: ['loadId'],
  additionalProperties: false,
  properties: { loadId: { type: 'string', minLength: 1 } },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /** Poster only: which carrier conversation to open. */
    with: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

export function registerMessageRoutes(app: FastifyInstance, deps: MessageModuleDeps): void {
  app.get<{ Params: { loadId: string }; Querystring: { with?: string } }>(
    '/api/board/loads/:loadId/messages',
    { schema: { params: paramsSchema, querystring: listQuerySchema }, preHandler: app.authenticate },
    async (request) => {
      return deps.messages.list(request.user.tenantId, request.params.loadId, request.query.with);
    },
  );

  app.post<{
    Params: { loadId: string };
    Body: { body?: string; proposedAmount?: number; toTenantId?: string };
  }>(
    '/api/board/loads/:loadId/messages',
    { schema: { body: postBodySchema, params: paramsSchema }, preHandler: app.authenticate },
    async (request, reply) => {
      const row = await deps.messages.post(
        request.user.tenantId,
        request.params.loadId,
        {
          body: request.body.body,
          proposedAmount: request.body.proposedAmount,
        },
        request.body.toTenantId,
      );
      return reply.code(201).send(row);
    },
  );

  const acceptSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['counterpartyTenantId'],
    properties: { counterpartyTenantId: { type: 'string', minLength: 1, maxLength: 64 } },
  } as const;

  // Poster accepts a carrier's offer: the asking rate becomes that amount.
  app.post<{ Params: { loadId: string }; Body: { counterpartyTenantId: string } }>(
    '/api/board/loads/:loadId/accept-offer',
    { schema: { body: acceptSchema, params: paramsSchema }, preHandler: app.authenticate },
    async (request) => {
      return deps.messages.acceptOffer(
        request.user.tenantId,
        request.params.loadId,
        request.body.counterpartyTenantId,
      );
    },
  );

  // Unread counts for both sides: `loads` = your posted loads that have
  // unanswered carrier messages (badge on My Loads); `threads` = replies
  // waiting on loads you negotiated (badge on the board).
  app.get('/api/messages/unread', { preHandler: app.authenticate }, async (request) => {
    return deps.messages.unread(request.user.tenantId);
  });
}
