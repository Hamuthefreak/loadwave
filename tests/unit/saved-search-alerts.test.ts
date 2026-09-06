import type { PrismaClient } from '@prisma/client';
import type { NotificationService } from '../../src/modules/notification/notification.service';
import { PrismaSavedSearchService } from '../../src/modules/search/saved-search.service';

const CHECK = new Date('2026-09-05T10:00:00Z');
const LAST_CHECK = new Date('2026-09-05T09:00:00Z');

function buildDeps(opts: {
  userId?: string | null;
  filtersJson?: string;
  lastCheckAt?: Date | null;
  newLoads?: number;
}) {
  const newLoads = Array.from({ length: opts.newLoads ?? 0 }, (_, i) => ({
    id: `load-${i}`,
    createdAt: new Date('2026-09-05T09:30:00Z').toISOString(),
  }));

  const prisma = {
    savedSearch: {
      findMany: jest.fn(async () => [
        {
          id: 's1',
          tenantId: 't1',
          userId: opts.userId ?? null,
          name: 'NY runs over 2000',
          filtersJson: opts.filtersJson ?? JSON.stringify({ originRegion: 'QC', destinationRegion: 'NY', minFreight: 2000 }),
          lastCheckAt: opts.lastCheckAt ?? LAST_CHECK,
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: 'u1', email: 'driver@carrier.ca' })),
    },
  } as unknown as Pick<PrismaClient, 'savedSearch' | 'user'>;

  const boardList = jest.fn(async () => newLoads);
  const notifications = {
    notify: jest.fn(async (input) => ({ ...input, id: 'n1', createdAt: 'now', readAt: null, payload: null })),
  } as unknown as NotificationService & { notify: jest.Mock };

  return { prisma, boardList, notifications };
}

describe('saved search runAlerts', () => {
  it('notifies the owner personally with their email when new loads match', async () => {
    const { prisma, boardList, notifications } = buildDeps({ userId: 'u1', newLoads: 2 });
    const svc = new PrismaSavedSearchService(prisma as unknown as PrismaClient, boardList);

    const result = await svc.runAlerts(notifications, CHECK);

    expect(result).toEqual({ checked: 1, alerted: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const call = notifications.notify.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      kind: 'load_match',
      title: '2 new loads match QC → NY',
      body: expect.stringContaining('NY runs over 2000'),
      link: '/app/board',
      emailTo: 'driver@carrier.ca',
      payload: { searchId: 's1' },
    });

    // Checkpoint advanced so the next sweep only alerts on newer posts.
    expect(prisma.savedSearch.updateMany).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastCheckAt: CHECK },
    });
  });

  it('stays quiet (but still checkpoints) when nothing new matched', async () => {
    const { prisma, boardList, notifications } = buildDeps({ userId: 'u1', newLoads: 0 });
    const svc = new PrismaSavedSearchService(prisma as unknown as PrismaClient, boardList);

    const result = await svc.runAlerts(notifications, CHECK);

    expect(result).toEqual({ checked: 1, alerted: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.savedSearch.updateMany).toHaveBeenCalled();
  });

  it('alerts tenant-wide when the search has no owner', async () => {
    const prismaStub = {
      savedSearch: {
        findMany: jest.fn(async () => [
          {
            id: 's1',
            tenantId: 't1',
            userId: null,
            name: 'Fleet watch',
            filtersJson: JSON.stringify({}),
            lastCheckAt: LAST_CHECK,
            createdAt: new Date('2026-09-01T00:00:00Z'),
          },
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: jest.fn() },
    } as unknown as Pick<PrismaClient, 'savedSearch' | 'user'>;
    const boardList = jest.fn(async () => [
      { id: 'load-x', createdAt: new Date('2026-09-05T09:30:00Z').toISOString() },
    ]);
    const notifications = {
      notify: jest.fn(async (input) => ({ ...input, id: 'n1', createdAt: 'now', readAt: null, payload: null })),
    } as unknown as NotificationService & { notify: jest.Mock };
    const svc = new PrismaSavedSearchService(prismaStub as unknown as PrismaClient, boardList);

    const result = await svc.runAlerts(notifications, CHECK);
    expect(result.alerted).toBe(1);
    const call = notifications.notify.mock.calls[0][0];
    expect(call.userId).toBeNull();
    expect(call.emailTo).toBeNull();
  });
});
