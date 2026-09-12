/**
 * Negotiation privacy over HTTP — the regression guard for the leak where a
 * second carrier on a load could read the first carrier's offers.
 *
 * The real service runs behind the real routes; only Prisma and the
 * notification sink are faked, so route schemas (the `with` query and the
 * `toTenantId` body) are exercised too.
 */
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/events/event-bus';
import type { PrismaClient } from '@prisma/client';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import { PrismaMessageService } from '../../src/modules/messages/messages.service';
import type { NotificationService } from '../../src/modules/notification/notification.service';

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
};

const LOAD_ID = 'load-1';
const POSTER = 'poster-tenant';
const CARRIER_A = 'carrier-a';
const CARRIER_B = 'carrier-b';

const msg = (
  id: string,
  authorTenantId: string,
  counterpartyTenantId: string,
  body: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  loadId: LOAD_ID,
  authorTenantId,
  counterpartyTenantId,
  body,
  kind: 'MESSAGE',
  proposedAmount: null,
  currency: null,
  readByPoster: authorTenantId !== POSTER,
  readByOther: true,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  ...overrides,
});

/** A's private thread and B's private thread on the same load. */
const A_ROW = msg('a1', CARRIER_A, CARRIER_A, 'A: I can do 1100');
const B_ROW = msg('b1', CARRIER_B, CARRIER_B, 'B: I can beat that — 1050');

async function buildWithFakes(loadOverrides: Record<string, unknown> = {}) {
  const load = {
    id: LOAD_ID,
    tenantId: POSTER,
    originRegion: 'ON',
    destinationRegion: 'QC',
    marketplaceStatus: 'PUBLIC',
    freightCurrency: 'CAD',
    freightAmountTransaction: 1200,
    bookedByTenantId: null,
    tenant: { name: 'Poster Co' },
    ...loadOverrides,
  };

  const prisma = {
    load: { findFirst: jest.fn(async () => load) },
    loadMessage: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async (args: { where: { counterpartyTenantId?: unknown } }) => {
        const where = args.where ?? {};
        // Poster inbox scan (all conversations) vs. one thread read.
        if (where.counterpartyTenantId && typeof where.counterpartyTenantId === 'object') {
          return [A_ROW, B_ROW];
        }
        if (where.counterpartyTenantId === CARRIER_A) return [A_ROW];
        if (where.counterpartyTenantId === CARRIER_B) return [B_ROW];
        return [];
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-1',
        createdAt: new Date('2026-01-01T11:00:00Z'),
        ...data,
      })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      groupBy: jest.fn(async () => []),
    },
    tenant: { findMany: jest.fn(async () => [{ id: CARRIER_A, name: 'Carrier A' }, { id: CARRIER_B, name: 'Carrier B' }]) },
  } as unknown as PrismaClient;

  const notifications = { notify: jest.fn(async () => ({})) } as unknown as NotificationService;
  // The commit path books through the board; a carrier with no accepted offer
  // must never reach it, and a rival's claim must surface as a conflict.
  const board = {
    // Accepting the offer already rewrote the asking rate to the agreed amount.
    book: jest.fn(async () => ({ ...load, marketplaceStatus: 'BOOKED', freightAmountTransaction: '1050' })),
  } as never;
  const messages = new PrismaMessageService(prisma, notifications, board);
  const bus = new EventBus();
  const app = await buildApp({
    env: ENV,
    deps: { bus, prisma, messages, notifications: notifications as never },
  });
  return { app, prisma, notifications, board };
}

function token(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string): string {
  const user: JwtUser = { sub: `user-${tenantId}`, tenantId, roles: ['ADMIN'], driverId: null, type: 'access' };
  return app.jwt.sign(user);
}

describe('negotiation thread privacy (HTTP)', () => {
  it('shows a carrier only its own thread, never a rival negotiation', async () => {
    const { app, prisma } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.viewer).toMatchObject({ role: 'carrier', counterpartyTenantId: CARRIER_A });
    expect(body.thread.map((m: { id: string }) => m.id)).toEqual(['a1']);
    expect(JSON.stringify(body)).not.toContain('beat that');
    // No poster inbox for a carrier.
    expect(body.conversations).toEqual([]);
    // The read is filtered at the query level, not just in the response.
    const call = (prisma.loadMessage.findMany as unknown as jest.Mock).mock.calls.at(-1)?.[0];
    expect(call.where).toMatchObject({ loadId: LOAD_ID, counterpartyTenantId: CARRIER_A });
    await app.close();
  });

  it('lets a carrier with no thread yet open one, stamping it to itself', async () => {
    const { app, prisma, notifications } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
      payload: { body: 'Is this still available?', proposedAmount: 1150 },
    });

    expect(res.statusCode).toBe(201);
    const created = (prisma.loadMessage.create as unknown as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({
      authorTenantId: CARRIER_A,
      counterpartyTenantId: CARRIER_A,
      kind: 'RATE_PROPOSAL',
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify as unknown as jest.Mock).mock.calls[0][0].tenantId).toBe(POSTER);
    await app.close();
  });

  it('lists the poster every carrier while opening none of them', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.viewer.counterpartyTenantId).toBeNull();
    expect(body.thread).toEqual([]);
    expect(body.conversations.map((c: { counterpartyTenantId: string }) => c.counterpartyTenantId).sort()).toEqual([
      CARRIER_A,
      CARRIER_B,
    ]);
    await app.close();
  });

  it('opens exactly the conversation the poster asks for', async () => {
    const { app } = await buildWithFakes();
    const a = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages?with=${CARRIER_A}`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json().thread.map((m: { id: string }) => m.id)).toEqual(['a1']);
    // The inbox may preview other carriers, but the opened thread holds one.
    expect(JSON.stringify(a.json().thread)).not.toContain('beat that');

    const b = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages?with=${CARRIER_B}`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
    });
    expect(b.json().thread.map((m: { id: string }) => m.id)).toEqual(['b1']);
    await app.close();
  });

  it('refuses a conversation with a tenant that never messaged the load', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages?with=stranger-tenant`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses an untenanted poster reply and routes an addressed one', async () => {
    const { app, prisma, notifications } = await buildWithFakes();

    const vague = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
      payload: { body: 'Sounds good' },
    });
    expect(vague.statusCode).toBe(400);

    const aimed = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, POSTER)}` },
      payload: { body: 'Can you do 1080?', toTenantId: CARRIER_B },
    });
    expect(aimed.statusCode).toBe(201);
    const created = (prisma.loadMessage.create as unknown as jest.Mock).mock.calls.at(-1)?.[0].data;
    expect(created.counterpartyTenantId).toBe(CARRIER_B);
    expect((notifications.notify as unknown as jest.Mock).mock.calls.at(-1)?.[0].tenantId).toBe(CARRIER_B);
    await app.close();
  });

  it('ignores unknown body fields instead of trusting them', async () => {
    const { app, prisma } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
      payload: { body: 'hi', spoofedTenantId: CARRIER_B, counterpartyTenantId: CARRIER_B },
    });

    expect(res.statusCode).toBe(201);
    // Body-level tenant spoofing must never survive into the row.
    const created = (prisma.loadMessage.create as unknown as jest.Mock).mock.calls[0][0].data;
    expect(created.authorTenantId).toBe(CARRIER_A);
    expect(created.counterpartyTenantId).toBe(CARRIER_A);
    await app.close();
  });

  it('hides a load that is not on the board', async () => {
    const { app } = await buildWithFakes({ marketplaceStatus: 'PRIVATE' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/board/loads/${LOAD_ID}/messages`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('committing to an accepted offer (HTTP)', () => {
  it('refuses a commit when the poster never accepted a rate', async () => {
    const { app, board } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/commit-offer`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
    });
    expect(res.statusCode).toBe(400);
    // Nothing may reach the booking path without an agreed price.
    expect((board as unknown as { book: jest.Mock }).book).not.toHaveBeenCalled();
    await app.close();
  });

  it('books through the board once the poster has accepted', async () => {
    const { app, prisma, board } = await buildWithFakes();
    const accepted = {
      ...A_ROW,
      id: 'a-accepted',
      authorTenantId: POSTER,
      kind: 'OFFER_ACCEPTED',
      proposedAmount: 1050,
      currency: 'CAD',
    };
    (prisma.loadMessage.findMany as unknown as jest.Mock).mockImplementation(
      async (args: { where: { counterpartyTenantId?: unknown; kind?: string } }) => {
        if (args.where.kind === 'OFFER_ACCEPTED') return [accepted];
        if (args.where.counterpartyTenantId === CARRIER_A) return [A_ROW, accepted];
        if (args.where.counterpartyTenantId === CARRIER_B) return [B_ROW];
        return [];
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/board/loads/${LOAD_ID}/commit-offer`,
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ amount: '1050', bookedByTenantId: CARRIER_A });
    expect((board as unknown as { book: jest.Mock }).book).toHaveBeenCalledWith(CARRIER_A, LOAD_ID);
    await app.close();
  });
});

describe('negotiation unread counts (HTTP)', () => {
  it('reports both sides without crossing tenants', async () => {
    const { app, prisma } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/messages/unread',
      headers: { authorization: `Bearer ${token(app, CARRIER_A)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ loads: [], threads: [] });
    const posterScan = (prisma.loadMessage.groupBy as unknown as jest.Mock).mock.calls[0][0];
    const carrierScan = (prisma.loadMessage.groupBy as unknown as jest.Mock).mock.calls[1][0];
    // The poster's badge only counts their own load; the carrier's only its thread.
    expect(posterScan.where.load).toMatchObject({ tenantId: CARRIER_A });
    expect(carrierScan.where.counterpartyTenantId).toBe(CARRIER_A);
    await app.close();
  });
});
