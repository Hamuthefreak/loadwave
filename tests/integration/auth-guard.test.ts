import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { fastifyJwt } from '@fastify/jwt';
import { authGuardPlugin } from '../../src/guards/auth.plugin';
import type { JwtUser, UserRole } from '../../src/modules/auth/auth.types';

const SECRET = 'test-access-secret-0123456789abcdef';

function signUser(app: FastifyInstance, overrides: Partial<JwtUser>): string {
  const user: JwtUser = {
    sub: 'user-1',
    tenantId: 'tenant-a',
    roles: ['ADMIN'],
    driverId: null,
    type: 'access',
    ...overrides,
  };
  return app.jwt.sign(user);
}

async function buildGuardApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await (app.register as unknown as (p: unknown, o: Record<string, unknown>) => PromiseLike<unknown>)(
    fastifyJwt,
    { secret: SECRET },
  );
  await app.register(authGuardPlugin as never, { accessType: 'access' });

  app.get<{ Params: { tenantId: string } }>(
    '/protected/tenant/:tenantId',
    {
      preHandler: async (request, reply) => {
        await app.withTenant(request, reply);
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      reply.send({ ok: true, tenantId: request.user.tenantId }),
  );

  app.get<{ Params: { tenantId: string } }>(
    '/dispatcher-only',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN', 'DISPATCHER'] as UserRole[])(request, reply);
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => reply.send({ ok: true }),
  );

  app.setErrorHandler((err: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.code ?? 'ERROR', message: e.message });
  });

  return app;
}

describe('JWT auth + multi-tenant guards (Fastify inject)', () => {
  it('rejects requests without a bearer token', async () => {
    const app = await buildGuardApp();
    const res = await app.inject({ method: 'GET', url: '/dispatcher-only' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
    await app.close();
  });

  it('rejects a tampered / garbage token', async () => {
    const app = await buildGuardApp();
    const res = await app.inject({
      method: 'GET',
      url: '/dispatcher-only',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('enforces tenant isolation on path tenantId', async () => {
    const app = await buildGuardApp();
    const token = signUser(app, { tenantId: 'tenant-a' });

    const own = await app.inject({
      method: 'GET',
      url: '/protected/tenant/tenant-a',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual({ ok: true, tenantId: 'tenant-a' });

    const other = await app.inject({
      method: 'GET',
      url: '/protected/tenant/tenant-b',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'FORBIDDEN' });
    await app.close();
  });

  it('allows a refused user with the DISPATCHER role to access dispatcher routes', async () => {
    const app = await buildGuardApp();
    const dispatcher = signUser(app, { tenantId: 'tenant-a', roles: ['DISPATCHER'] });
    const res = await app.inject({
      method: 'GET',
      url: '/dispatcher-only',
      headers: { authorization: `Bearer ${dispatcher}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('blocks a DRIVER role from dispatcher-only routes', async () => {
    const app = await buildGuardApp();
    const driver = signUser(app, { tenantId: 'tenant-a', roles: ['DRIVER'], driverId: 'driver-1' });
    const res = await app.inject({
      method: 'GET',
      url: '/dispatcher-only',
      headers: { authorization: `Bearer ${driver}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
