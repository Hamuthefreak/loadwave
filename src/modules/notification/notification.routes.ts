import type { FastifyInstance } from 'fastify';
import type { NotificationService } from './notification.service';
import type { EmailService } from './email.service';

export interface NotificationModuleDeps {
  notifications: NotificationService;
  email: EmailService;
}

interface NotificationQuery {
  unreadOnly?: string;
  limit?: string;
}

export function registerNotificationRoutes(app: FastifyInstance, deps: NotificationModuleDeps): void {
  app.get<{ Querystring: NotificationQuery }>(
    '/api/notifications',
    { preHandler: app.authenticate },
    async (request) => {
      const unreadOnly = request.query.unreadOnly === 'true';
      const limit = Number(request.query.limit ?? 50);
      const [items, unread] = await Promise.all([
        deps.notifications.list(request.user.tenantId, {
          userId: request.user.sub,
          unreadOnly,
          limit: Number.isFinite(limit) ? limit : 50,
        }),
        deps.notifications.unreadCount(request.user.tenantId, request.user.sub),
      ]);
      return { items, unread };
    },
  );

  app.post(
    '/api/notifications/read-all',
    { preHandler: app.authenticate },
    async (request) => {
      const count = await deps.notifications.markAllRead(request.user.tenantId, request.user.sub);
      return { read: count };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/notifications/:id/read',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const row = await deps.notifications.markRead(request.user.tenantId, request.params.id, request.user.sub);
      if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'notification not found' });
      return reply.send(row);
    },
  );

  // Settings: SMTP + notification prefs
  app.get(
    '/api/settings/notifications',
    { preHandler: app.authenticate },
    async (request) => {
      const [smtp, configured] = await Promise.all([
        deps.email.settings(request.user.tenantId),
        deps.email.isConfigured(request.user.tenantId),
      ]);
      return {
        smtp: { ...smtp, password: smtp.password ? '••••••••' : undefined },
        configured,
      };
    },
  );

  app.patch<{ Body: { enabled?: boolean; host?: string; port?: number; secure?: boolean; user?: string; password?: string; from?: string } }>(
    '/api/settings/notifications',
    {
      preHandler: async (request, reply) => {
        await app.requireRoles(['ADMIN'])(request, reply);
      },
    },
    async (request) => {
      const { enabled, host, port, secure, user, password, from } = request.body ?? {};
      const smtp = await deps.email.save(request.user.tenantId, {
        enabled,
        host,
        port,
        secure,
        user,
        password: password && password !== '••••••••' ? password : undefined,
        from,
      });
      return { smtp: { ...smtp, password: smtp.password ? '••••••••' : undefined }, configured: Boolean(smtp.enabled && smtp.host) };
    },
  );
}