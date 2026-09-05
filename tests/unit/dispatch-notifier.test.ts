import type { PrismaClient } from '@prisma/client';
import type { NotificationService } from '../../src/modules/notification/notification.service';
import {
  onLoadDispatched,
  onLoadStatusChanged,
  type DispatchNotifierDeps,
} from '../../src/modules/notification/dispatch-notifier';

interface FakeUser {
  id: string;
  email: string;
  tenantId: string;
  driverId: string | null;
}

interface FakeDriver {
  id: string;
  name: string;
}

function buildDeps(users: FakeUser[], drivers: FakeDriver[]) {
  const prisma = {
    user: {
      findFirst: jest.fn(async ({ where }: { where: { tenantId: string; driverId: string } }) =>
        users.find((u) => u.tenantId === where.tenantId && u.driverId === where.driverId) ?? null,
      ),
    },
    driver: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        drivers.find((d) => d.id === where.id) ?? null,
      ),
    },
  } as unknown as Pick<PrismaClient, 'user' | 'driver'>;

  const notifications = {
    notify: jest.fn(async (input) => ({ ...input, id: 'n1', createdAt: 'now', readAt: null, payload: null })),
  } as unknown as NotificationService & { notify: jest.Mock };

  const deps: DispatchNotifierDeps = { prisma, notifications };
  return { deps, notify: notifications.notify as jest.Mock };
}

const dispatcherUser: FakeUser = { id: 'u-ops', email: 'ops@carrier.ca', tenantId: 't1', driverId: null };
const marie: FakeUser = { id: 'u-marie', email: 'marie@carrier.ca', tenantId: 't1', driverId: 'd-marie' };
const jean: FakeUser = { id: 'u-jean', email: 'jean@carrier.ca', tenantId: 't1', driverId: 'd-jean' };

const driverRows: FakeDriver[] = [
  { id: 'd-marie', name: 'Marie Tremblay' },
  { id: 'd-jean', name: 'Jean Fortin' },
];

const baseDispatched = {
  tenantId: 't1',
  loadId: 'load-1',
  originCountry: 'CA',
  originRegion: 'QC',
  destinationCountry: 'CA',
  destinationRegion: 'ON',
};

describe('dispatch notifier', () => {
  it('notifies only the newly assigned driver (personal, linked user)', async () => {
    const { deps, notify } = buildDeps([dispatcherUser, marie, jean], driverRows);
    await onLoadDispatched(deps, { ...baseDispatched, driverId: 'd-marie', prevDriverId: null });

    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: 't1',
      userId: 'u-marie',
      kind: 'dispatch',
      title: 'New trip: QC → ON',
      link: '/app/trips',
      emailTo: 'marie@carrier.ca',
      payload: { loadId: 'load-1' },
    });
    expect(call.body).toContain('Marie Tremblay');
  });

  it('notifies both the new assignee and the displaced driver on reassignment', async () => {
    const { deps, notify } = buildDeps([dispatcherUser, marie, jean], driverRows);
    await onLoadDispatched(deps, { ...baseDispatched, driverId: 'd-jean', prevDriverId: 'd-marie' });

    const targets = notify.mock.calls.map((c) => c[0]);
    expect(targets).toHaveLength(2);
    const newAssignee = targets.find((t) => t.userId === 'u-jean');
    const displaced = targets.find((t) => t.userId === 'u-marie');
    expect(newAssignee.title).toBe('New trip: QC → ON');
    expect(displaced).toMatchObject({ title: 'Trip reassigned: QC → ON', emailTo: 'marie@carrier.ca' });
  });

  it('notifies the previous driver when a load is unassigned (removed)', async () => {
    const { deps, notify } = buildDeps([dispatcherUser, marie], driverRows);
    await onLoadDispatched(deps, { ...baseDispatched, driverId: null, prevDriverId: 'd-marie' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      userId: 'u-marie',
      title: 'Trip no longer yours: QC → ON',
      kind: 'dispatch',
    });
  });

  it('skips when the assignee driver has no linked user account', async () => {
    const { deps, notify } = buildDeps([dispatcherUser], driverRows);
    await onLoadDispatched(deps, { ...baseDispatched, driverId: 'd-marie', prevDriverId: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the office (tenant-wide row) when the driver advances the trip', async () => {
    const { deps, notify } = buildDeps([dispatcherUser, marie], driverRows);
    await onLoadStatusChanged(deps, {
      ...baseDispatched,
      loadId: 'load-1',
      fromStatus: 'IN_TRANSIT',
      toStatus: 'DELIVERED',
      actorDriverId: 'd-marie',
      assigneeDriverId: 'd-marie',
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: 't1',
      kind: 'dispatch',
      title: 'Marie Tremblay delivered the QC → ON trip',
      link: '/app/myloads',
    });
    // Tenant-wide row: no userId, so every member of the office sees it.
    expect(call).not.toHaveProperty('userId');
  });

  it('tells the driver personally when the office updates a dispatched trip', async () => {
    const { deps, notify } = buildDeps([dispatcherUser, marie], driverRows);
    await onLoadStatusChanged(deps, {
      ...baseDispatched,
      loadId: 'load-1',
      fromStatus: 'ASSIGNED',
      toStatus: 'IN_TRANSIT',
      actorDriverId: null,
      assigneeDriverId: 'd-marie',
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      userId: 'u-marie',
      title: 'Trip update: QC → ON',
      body: 'Dispatch marked this load in transit.',
      link: '/app/trips',
      emailTo: 'marie@carrier.ca',
    });
  });

  it('stays silent for office status changes on loads without a driver', async () => {
    const { deps, notify } = buildDeps([dispatcherUser], driverRows);
    await onLoadStatusChanged(deps, {
      ...baseDispatched,
      loadId: 'load-1',
      fromStatus: 'OPEN',
      toStatus: 'IN_TRANSIT',
      actorDriverId: null,
      assigneeDriverId: null,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
