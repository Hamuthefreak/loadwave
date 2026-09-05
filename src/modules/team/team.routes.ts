import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../auth/auth.types';
import type { TeamService } from './team.service';

const rolesSchema = {
  type: 'array',
  minItems: 1,
  items: { type: 'string', enum: ['ADMIN', 'DISPATCHER', 'DRIVER'] },
} as const;

const inviteSchema = {
  type: 'object',
  required: ['email', 'roles'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    roles: rolesSchema,
    driverId: { type: 'string' },
  },
} as const;

const acceptSchema = {
  type: 'object',
  required: ['token', 'email', 'password'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
  },
} as const;

interface InviteBody {
  email: string;
  roles: UserRole[];
  driverId?: string;
}

interface AcceptBody {
  token: string;
  email: string;
  password: string;
}

export interface TeamModuleDeps {
  team: TeamService;
}

export function registerTeamRoutes(app: FastifyInstance, deps: TeamModuleDeps): void {
  app.get(
    '/api/team',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const rows = await deps.team.list(request.user.tenantId);
      return reply.send(rows);
    },
  );

  app.post<{ Body: InviteBody }>(
    '/api/team/invites',
    {
      schema: { body: inviteSchema },
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request: FastifyRequest<{ Body: InviteBody }>, reply: FastifyReply) => {
      const created = await deps.team.createInvite(request.user.tenantId, request.user.sub, request.body);
      return reply.code(201).send(created);
    },
  );

  app.post<{ Params: { inviteId: string } }>(
    '/api/team/invites/:inviteId/revoke',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      await deps.team.revoke(request.user.tenantId, request.params.inviteId);
      return reply.send({ ok: true });
    },
  );

  // Rotates the token of a pending invite so the link can be copied/shared
  // again without the raw token ever being persisted server-side.
  app.post<{ Params: { inviteId: string } }>(
    '/api/team/invites/:inviteId/resend',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'] as UserRole[])(request, reply);
      },
    },
    async (request, reply) => {
      const { token } = await deps.team.resend(request.user.tenantId, request.params.inviteId);
      return reply.send({ token });
    },
  );

  // Public: the invitee completes setup. A valid, unexpired invite token is all
  // the proof needed — it is only ever shared with the intended person.
  app.post<{ Body: AcceptBody }>(
    '/api/team/invites/accept',
    {
      schema: { body: acceptSchema },
    },
    async (request: FastifyRequest<{ Body: AcceptBody }>, reply: FastifyReply) => {
      const session = await deps.team.accept(request.body);
      return reply.send({
        user: session.user,
        tenant: session.tenant,
        tokens: session.tokens,
      });
    },
  );
}
