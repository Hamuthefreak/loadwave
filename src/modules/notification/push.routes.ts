import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PushService } from './push.service';

// `app.authenticate` (preHandler) guarantees `req.user.sub` exists; the cast
// keeps the handlers' types simple alongside the body generics.
function userIdOf(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: { sub: string } }).user.sub;
}

export interface PushModuleDeps {
  push: PushService;
}

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function registerPushRoutes(app: FastifyInstance, deps: PushModuleDeps): void {
  // Public VAPID key the browser needs before it can create a subscription.
  app.get('/api/push/config', { preHandler: app.authenticate }, async (_request, reply) => {
    return reply.send({ enabled: deps.push.enabled, publicKey: deps.push.publicKey });
  });

  app.post<{ Body: SubscribeBody }>(
    '/api/push/subscribe',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['endpoint', 'keys'],
          properties: {
            endpoint: { type: 'string', minLength: 10 },
            keys: {
              type: 'object',
              additionalProperties: false,
              required: ['p256dh', 'auth'],
              properties: { p256dh: { type: 'string' }, auth: { type: 'string' } },
            },
          },
        },
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      if (!deps.push.enabled) {
        return reply.code(503).send({ error: 'PUSH_DISABLED', message: 'push is not configured' });
      }
      await deps.push.subscribe(userIdOf(request), {
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth,
        userAgent: request.headers['user-agent'],
      });
      return reply.send({ ok: true });
    },
  );

  // Forget this browser's subscription (sign-out / opt-out).
  app.delete<{ Body: { endpoint: string } }>(
    '/api/push/subscribe',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['endpoint'],
          properties: { endpoint: { type: 'string' } },
        },
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      await deps.push.unsubscribe(userIdOf(request), request.body.endpoint);
      return reply.send({ ok: true });
    },
  );
}