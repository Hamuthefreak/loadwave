import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.service';
import type { UserRole } from './auth.types';

const registerSchema = {
  type: 'object',
  required: ['tenantName', 'email', 'password'],
  additionalProperties: false,
  properties: {
    tenantName: { type: 'string', minLength: 1, maxLength: 120 },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    roles: { type: 'array', items: { type: 'string', enum: ['ADMIN', 'DISPATCHER', 'DRIVER'] } },
    tenantBaseCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    tenantBaseJurisdiction: { type: 'string' },
    mcNumber: { type: 'string' },
    usdotNumber: { type: 'string' },
  },
} as const;

const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
} as const;

const refreshSchema = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string', minLength: 1 },
  },
} as const;

interface RegisterBody {
  tenantName: string;
  email: string;
  password: string;
  roles?: UserRole[];
  tenantBaseCurrency?: string;
  tenantBaseJurisdiction?: string;
  mcNumber?: string;
  usdotNumber?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

export interface AuthModuleDeps {
  auth: AuthService;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthModuleDeps): void {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: { body: registerSchema },
    },
    async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const session = await deps.auth.register(req.body);
      return reply.code(201).send({
        user: session.user,
        tenant: session.tenant,
        tokens: session.tokens,
      });
    },
  );

  app.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: { body: loginSchema },
    },
    async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const session = await deps.auth.login(req.body);
      return reply.send({
        user: session.user,
        tenant: session.tenant,
        tokens: session.tokens,
      });
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/auth/refresh',
    {
      schema: { body: refreshSchema },
    },
    async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      const session = await deps.auth.refresh(req.body.refreshToken);
      return reply.send({ user: session.user, tokens: session.tokens });
    },
  );
}
