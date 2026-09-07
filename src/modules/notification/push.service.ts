import webpush from 'web-push';

// Narrow structural slice of Prisma's pushSubscription delegate so tests can
// substitute a trivial in-memory fake.
export interface PushSubscriptionStore {
  upsert(args: {
    where: { endpoint: string };
    create: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent?: string | null };
    update: { userId: string; p256dh: string; auth: string; userAgent?: string | null };
  }): Promise<unknown>;
  findMany(args: {
    where: { userId: string };
  }): Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>;
  deleteMany(args: {
    where: { id?: { in: string[] }; userId?: string; endpoint?: string };
  }): Promise<unknown>;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

export interface PushService {
  /** True when VAPID keys are configured and push can be delivered. */
  readonly enabled: boolean;
  /** Public VAPID key the client uses to create its subscription. */
  readonly publicKey: string | null;
  /** Upsert a browser subscription for a user (keyed by endpoint). */
  subscribe(userId: string, input: PushSubscriptionInput): Promise<void>;
  /** Push a notification to every subscription a user has; prunes dead ones. */
  sendToUser(userId: string, payload: PushPayload): Promise<number>;
  /** Forget one of the user's subscriptions (opt-out / sign-out). */
  unsubscribe(userId: string, endpoint: string): Promise<void>;
}

interface SendFn {
  (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options?: unknown): Promise<unknown>;
}

export interface PushServiceDeps {
  prisma: PushSubscriptionStore;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  /** Injectable for tests; defaults to web-push's sendNotification. */
  send?: SendFn;
  logger?: { error(obj: Record<string, unknown>, msg?: string): void };
}

export function createPushService(deps: PushServiceDeps): PushService {
  const { prisma, send } = deps;
  const enabled = Boolean(deps.vapidPublicKey && deps.vapidPrivateKey);
  const deliver = send ?? webpush.sendNotification.bind(webpush);

  if (enabled) {
    webpush.setVapidDetails(deps.vapidSubject, deps.vapidPublicKey, deps.vapidPrivateKey);
  }

  return {
    enabled,
    get publicKey() {
      return enabled ? deps.vapidPublicKey : null;
    },

    async subscribe(userId, input) {
      if (!input.endpoint || !input.p256dh || !input.auth) {
        throw new Error('incomplete push subscription');
      }
      await prisma.upsert({
        where: { endpoint: input.endpoint },
        create: { userId, ...input },
        update: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null },
      });
    },

    async unsubscribe(userId, endpoint) {
      await prisma.deleteMany({ where: { userId, endpoint } });
    },

    async sendToUser(userId, payload) {
      if (!enabled) return 0;
      const subs = await prisma.findMany({ where: { userId } });
      if (subs.length === 0) return 0;

      const body = JSON.stringify(payload);
      let sent = 0;
      const dead: string[] = [];

      for (const sub of subs) {
        try {
          await deliver(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410 → the browser revoked the subscription; forget it.
          if (status === 404 || status === 410) {
            dead.push(sub.id);
          } else {
            deps.logger?.error({ endpoint: sub.endpoint, statusCode: status }, 'push: delivery failed');
          }
        }
      }

      if (dead.length > 0) {
        await prisma.deleteMany({ where: { id: { in: dead } } });
      }
      return sent;
    },
  };
}