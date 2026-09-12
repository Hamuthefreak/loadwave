/**
 * Negotiation (load messages) — validation + privacy rules.
 * The service's Prisma interactions are stubbed; these tests pin the
 * input-validation that protects the API and the conversation scoping that
 * keeps one carrier's negotiation invisible to another.
 */
import { PrismaMessageService } from '../../src/modules/messages/messages.service';
import type { NotificationService } from '../../src/modules/notification/notification.service';

const LOAD = {
  id: 'load-1',
  tenantId: 'poster-tenant',
  originRegion: 'QC',
  destinationRegion: 'ON',
  marketplaceStatus: 'PUBLIC',
  freightCurrency: 'CAD',
  freightAmountTransaction: 1000,
  bookedByTenantId: null as string | null,
  tenant: { name: 'Poster Co' },
};

/** A message authored by a carrier, tagged with that carrier's conversation. */
function carrierMsg(id: string, counterparty: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    loadId: 'load-1',
    authorTenantId: counterparty,
    counterpartyTenantId: counterparty,
    body,
    kind: 'MESSAGE',
    proposedAmount: null,
    currency: null,
    readByPoster: false,
    readByOther: true,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

function makeService(opts: { loadOverrides?: Record<string, unknown>; conversations?: unknown[] } = {}) {
  const load = { ...LOAD, ...(opts.loadOverrides ?? {}) };
  const conversations = opts.conversations ?? [];
  const prisma = {
    load: { findFirst: jest.fn().mockResolvedValue(load) },
    loadMessage: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockImplementation((args: { where: { counterpartyTenantId?: unknown } }) => {
        // Conversation summary scan (poster inbox) vs. one thread read.
        if (args.where.counterpartyTenantId && typeof args.where.counterpartyTenantId === 'object') {
          return Promise.resolve(conversations);
        }
        return Promise.resolve([]);
      }),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ createdAt: new Date(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'carrier-a', name: 'Carrier A' }]) },
  } as unknown as ConstructorParameters<typeof PrismaMessageService>[0];
  const notifications = { notify: jest.fn().mockResolvedValue({}) } as unknown as NotificationService;
  const service = new PrismaMessageService(prisma, notifications);
  return { service, notifications, prisma };
}

describe('load message validation', () => {
  it('rejects an empty message with no amount', async () => {
    const { service } = makeService();
    await expect(service.post('carrier-a', 'load-1', {})).rejects.toThrow();
  });

  it('rejects a zero or negative proposal', async () => {
    const { service } = makeService();
    await expect(service.post('carrier-a', 'load-1', { proposedAmount: 0 })).rejects.toThrow();
    await expect(service.post('carrier-a', 'load-1', { proposedAmount: -5 })).rejects.toThrow();
  });

  it('rejects an absurd proposal', async () => {
    const { service } = makeService();
    await expect(service.post('carrier-a', 'load-1', { proposedAmount: 50_000_000 })).rejects.toThrow();
  });

  it('rejects an over-long body', async () => {
    const { service } = makeService();
    await expect(service.post('carrier-a', 'load-1', { body: 'x'.repeat(2001) })).rejects.toThrow();
  });

  it('hides a load that is no longer on the board', async () => {
    const { service } = makeService({ loadOverrides: { marketplaceStatus: 'PRIVATE' } });
    await expect(service.post('carrier-a', 'load-1', { body: 'hi' })).rejects.toThrow();
  });
});

describe('carrier reaching out', () => {
  it('lets a carrier with no prior thread start one on a public load', async () => {
    const { service, notifications } = makeService();
    const row = await service.post('carrier-a', 'load-1', { body: 'Is this still available?' });
    expect(row.mine).toBe(true);
    // The thread is keyed to the carrier that wrote it.
    expect(row.authorTenantId).toBe('carrier-a');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify as jest.Mock).mock.calls[0][0]).toMatchObject({
      tenantId: 'poster-tenant',
      kind: 'load_message',
    });
  });

  it('accepts an amount-only proposal as RATE_PROPOSAL with currency snapshot', async () => {
    const { service } = makeService();
    const row = await service.post('carrier-a', 'load-1', { proposedAmount: 1150 });
    expect(row.kind).toBe('RATE_PROPOSAL');
    expect(row.proposedAmount).toBe('1150');
    expect(row.currency).toBe('CAD');
  });

  it('refuses a competing carrier once another carrier has booked the load', async () => {
    const { service } = makeService({
      loadOverrides: { marketplaceStatus: 'BOOKED', bookedByTenantId: 'carrier-b' },
    });
    await expect(service.post('carrier-a', 'load-1', { body: 'still there?' })).rejects.toThrow();
  });

  it('reads only its own thread, never another carrier conversation', async () => {
    const { service, prisma } = makeService();
    const view = await service.list('carrier-a', 'load-1');
    expect(view.viewer).toMatchObject({ role: 'carrier', counterpartyTenantId: 'carrier-a' });
    expect(view.conversations).toEqual([]);
    const call = (prisma.loadMessage.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ loadId: 'load-1', counterpartyTenantId: 'carrier-a' });
  });
});

describe('poster replies', () => {
  const twoCarriers = [
    carrierMsg('m1', 'carrier-a', 'offer 1100'),
    carrierMsg('m2', 'carrier-b', 'offer 1050'),
  ];

  it('lists every carrier conversation but opens none until one is picked', async () => {
    const { service } = makeService({ conversations: twoCarriers });
    const view = await service.list('poster-tenant', 'load-1');
    expect(view.conversations.map((c) => c.counterpartyTenantId).sort()).toEqual(['carrier-a', 'carrier-b']);
    expect(view.viewer.role).toBe('poster');
    expect(view.viewer.counterpartyTenantId).toBeNull();
    expect(view.thread).toEqual([]);
  });

  it('opens the addressed carrier conversation', async () => {
    const { service, prisma } = makeService({ conversations: twoCarriers });
    const view = await service.list('poster-tenant', 'load-1', 'carrier-b');
    expect(view.viewer.counterpartyTenantId).toBe('carrier-b');
    expect((prisma.loadMessage.findMany as jest.Mock).mock.calls.at(-1)?.[0].where).toMatchObject({
      counterpartyTenantId: 'carrier-b',
    });
  });

  it('refuses a reply aimed at a carrier that never messaged the load', async () => {
    const { service } = makeService({ conversations: twoCarriers });
    await expect(
      service.post('poster-tenant', 'load-1', { body: 'hello?' }, 'carrier-c'),
    ).rejects.toThrow();
  });

  it('demands a target when several carriers are in the thread', async () => {
    const { service } = makeService({ conversations: twoCarriers });
    await expect(service.post('poster-tenant', 'load-1', { body: 'sounds good' })).rejects.toThrow();
  });

  it('routes a reply to the chosen carrier and notifies only them', async () => {
    const { service, notifications, prisma } = makeService({ conversations: twoCarriers });
    await service.post('poster-tenant', 'load-1', { body: 'can you do 1080?' }, 'carrier-b');
    const created = (prisma.loadMessage.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({
      authorTenantId: 'poster-tenant',
      counterpartyTenantId: 'carrier-b',
      readByPoster: true,
      readByOther: false,
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify as jest.Mock).mock.calls[0][0].tenantId).toBe('carrier-b');
  });

  it('refuses to reply when no carrier has reached out yet', async () => {
    const { service } = makeService();
    await expect(service.post('poster-tenant', 'load-1', { body: 'hello?' })).rejects.toThrow();
  });
});
