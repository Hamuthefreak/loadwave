import { createPushService, type PushServiceDeps } from '../../src/modules/notification/push.service';

// Throwaway keypair (nothing is ever delivered to a real push service in
// these tests — the send transport is mocked).
const TEST_VAPID = {
  public:
    'BP6p9H4yynY3jpSBKy0AxGnNhRhJIJeBCuPR23RBhoniiAYFDlGIFImOQYM_LBoMjuR3pmjtqZONloIGFk7zdwA',
  private: 'qy-VMY8_ZcwJAfElosfmAKz-2ReIOdRUFGEH1j2L0zA',
};

interface SubRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function buildDeps(overrides: {
  subs?: SubRow[];
  vapid?: { public: string; private: string };
  deliver?: (sub: unknown, payload: string) => Promise<unknown>;
}): { deps: PushServiceDeps; prisma: Record<string, jest.Mock>; calls: unknown[] } {
  const calls: unknown[] = [];
  const subs = overrides.subs ?? [];
  const prisma = {
    upsert: jest.fn(async (args: unknown) => {
      const a = args as { create: SubRow };
      const existing = subs.find((s) => s.endpoint === a.create.endpoint);
      if (!existing) subs.push(a.create);
      return a.create;
    }),
    findMany: jest.fn(async () => subs),
    deleteMany: jest.fn(async () => undefined),
  };
  const deps: PushServiceDeps = {
    prisma: prisma as unknown as PushServiceDeps['prisma'],
    vapidPublicKey: overrides.vapid?.public ?? TEST_VAPID.public,
    vapidPrivateKey: overrides.vapid?.private ?? TEST_VAPID.private,
    vapidSubject: 'mailto:test@loadwave.app',
    send: async (sub, payload) => {
      calls.push({ sub, payload: JSON.parse(payload as string) });
      if (overrides.deliver) return overrides.deliver(sub, payload as string);
      return undefined;
    },
  };
  return { deps, prisma, calls };
}

describe('createPushService', () => {
  it('is disabled without VAPID keys and never delivers', async () => {
    const { deps, prisma } = buildDeps({ vapid: { public: '', private: '' } });
    const svc = createPushService(deps);
    expect(svc.enabled).toBe(false);
    expect(svc.publicKey).toBeNull();
    expect(await svc.sendToUser('u1', { title: 'hi' })).toBe(0);
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('upserts a subscription keyed by endpoint', async () => {
    const { deps, prisma } = buildDeps({});
    const svc = createPushService(deps);
    await svc.subscribe('u1', { endpoint: 'https://push.example/e1', p256dh: 'k', auth: 'a' });
    await svc.subscribe('u2', { endpoint: 'https://push.example/e1', p256dh: 'k2', auth: 'a2', userAgent: 'Chrome' });
    expect(prisma.upsert).toHaveBeenCalledTimes(2);
    expect((prisma.upsert.mock.calls[1][0] as { update: { userId: string } }).update.userId).toBe('u2');
  });

  it('rejects incomplete subscriptions', async () => {
    const { deps } = buildDeps({});
    const svc = createPushService(deps);
    await expect(svc.subscribe('u1', { endpoint: '', p256dh: 'k', auth: 'a' })).rejects.toThrow();
  });

  it('sends the payload to every subscription', async () => {
    const { deps, calls } = buildDeps({
      subs: [
        { id: 's1', userId: 'u1', endpoint: 'https://push.example/e1', p256dh: 'k1', auth: 'a1' },
        { id: 's2', userId: 'u1', endpoint: 'https://push.example/e2', p256dh: 'k2', auth: 'a2' },
      ],
    });
    const svc = createPushService(deps);
    const sent = await svc.sendToUser('u1', { title: 'New trip', body: 'QC → ON', url: '/app/trips' });
    expect(sent).toBe(2);
    expect(calls).toHaveLength(2);
    expect((calls[0] as { payload: { title: string; url: string } }).payload.title).toBe('New trip');
  });

  it('prunes subscriptions the push service reports gone (404/410)', async () => {
    const { deps, prisma } = buildDeps({
      subs: [
        { id: 'dead', userId: 'u1', endpoint: 'https://push.example/dead', p256dh: 'k', auth: 'a' },
        { id: 'alive', userId: 'u1', endpoint: 'https://push.example/alive', p256dh: 'k', auth: 'a' },
      ],
      deliver: (sub) => {
        const s = sub as { endpoint: string };
        if (s.endpoint.includes('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        return Promise.resolve(undefined);
      },
    });
    const svc = createPushService(deps);
    const sent = await svc.sendToUser('u1', { title: 'x' });
    expect(sent).toBe(1);
    expect(prisma.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['dead'] } },
    });
  });

  it('keeps subscriptions on transient failures', async () => {
    const { deps, prisma } = buildDeps({
      subs: [{ id: 's1', userId: 'u1', endpoint: 'https://push.example/e1', p256dh: 'k', auth: 'a' }],
      deliver: () => {
        throw Object.assign(new Error('boom'), { statusCode: 500 });
      },
    });
    const svc = createPushService(deps);
    const sent = await svc.sendToUser('u1', { title: 'x' });
    expect(sent).toBe(0);
    expect(prisma.deleteMany).not.toHaveBeenCalled();
  });

  it('unsubscribe removes only the matching endpoint', async () => {
    const { deps, prisma } = buildDeps({});
    const svc = createPushService(deps);
    await svc.unsubscribe('u1', 'https://push.example/e1');
    expect(prisma.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', endpoint: 'https://push.example/e1' },
    });
  });
});