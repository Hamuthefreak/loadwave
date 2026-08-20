import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtUser, UserRole } from '../modules/auth/auth.types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRoles: (roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    withTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
