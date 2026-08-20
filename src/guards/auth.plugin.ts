import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../utils/errors';
import type { JwtUser, UserRole } from '../modules/auth/auth.types';

export interface AuthGuardOptions {
  // If the token is not signed for 'access' type, it is rejected.
  accessType: 'access';
}

export const authGuardPlugin = fp<AuthGuardOptions>(
  async (app) => {
    app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify<JwtUser>();
      } catch {
        throw unauthorized('invalid or expired token');
      }
      if (request.user.type !== 'access') {
        throw unauthorized('token type not accepted');
      }
    });

    app.decorate(
      'requireRoles',
      (roles: UserRole[]) =>
        async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
          await app.authenticate(request, reply);
          if (reply.sent) return;
          const user = request.user;
          const ok = user.roles.some((r) => (roles as string[]).includes(r));
          if (!ok) throw forbidden(`requires ${roles.join(' or ')} role`);
        },
    );

    app.decorate('withTenant', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await app.authenticate(request, reply);
      if (reply.sent) return;
      const user = request.user;
      const params = (request.params ?? {}) as Record<string, unknown>;
      const body = (request.body ?? null) as Record<string, unknown> | null;

      const claims: unknown[] = [];
      if (params && typeof params === 'object' && 'tenantId' in params) {
        claims.push(params.tenantId);
      }
      if (body && typeof body === 'object' && 'tenantId' in body) {
        claims.push(body.tenantId);
      }
      for (const claim of claims) {
        if (claim === null || claim === undefined) continue;
        if (String(claim) !== user.tenantId) throw forbidden('tenant mismatch');
      }
    });
  },
  { name: 'loadwave-auth-guards' },
);
