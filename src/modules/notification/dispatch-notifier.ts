import type { PrismaClient } from '@prisma/client';
import type { LoadDispatchedPayload, LoadStatusChangedPayload } from '../../events/domain-events';
import type { NotificationService } from './notification.service';

// Minimal logger surface so Fastify's app.log can be passed without fighting
// the pino typings.
export interface NotifierLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export interface DispatchNotifierDeps {
  prisma: Pick<PrismaClient, 'user' | 'driver'>;
  notifications: NotificationService;
  logger?: NotifierLogger;
}

const TRIP_LINK = '/app/trips';
const OFFICE_LINK = '/app/myloads';

// Status verb for driver-initiated advances, e.g. "Marie started the QC → ON trip".
const DRIVER_ACTION: Record<string, string> = {
  IN_TRANSIT: 'started',
  DELIVERED: 'delivered',
  INVOICED: 'invoiced',
  OPEN: 'reopened',
  ASSIGNED: 'accepted',
};

// Plain-language label for status changes made by the office.
const STATUS_LABEL: Record<string, string> = {
  IN_TRANSIT: 'in transit',
  DELIVERED: 'delivered',
  INVOICED: 'invoiced',
  OPEN: 'open again',
  ASSIGNED: 'assigned',
};

function lane(p: Pick<LoadDispatchedPayload | LoadStatusChangedPayload, 'originRegion' | 'destinationRegion'>): string {
  return `${p.originRegion} → ${p.destinationRegion}`;
}

async function userForDriver(
  prisma: DispatchNotifierDeps['prisma'],
  tenantId: string,
  driverId: string,
): Promise<{ id: string; email: string } | null> {
  const user = await prisma.user.findFirst({ where: { tenantId, driverId }, orderBy: { createdAt: 'asc' } });
  return user ? { id: user.id, email: user.email } : null;
}

async function driverName(prisma: DispatchNotifierDeps['prisma'], driverId: string): Promise<string | null> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  return driver?.name ?? null;
}

/** Resolves who should be notified when a load's driver changes. */
export async function onLoadDispatched(
  deps: DispatchNotifierDeps,
  p: LoadDispatchedPayload,
): Promise<void> {
  const { prisma, notifications } = deps;
  const l = lane(p);

  // New assignee gets a personal "you have a trip" notification.
  if (p.driverId) {
    const user = await userForDriver(prisma, p.tenantId, p.driverId);
    if (!user) {
      deps.logger?.info({ tenantId: p.tenantId, driverId: p.driverId }, 'dispatch: no linked user to notify for new assignee');
    } else {
      const name = await driverName(prisma, p.driverId);
      await notifications.notify({
        tenantId: p.tenantId,
        userId: user.id,
        kind: 'dispatch',
        title: `New trip: ${l}`,
        body: name ? `${name}, a load was assigned to you — open My Trips to start it.` : 'A load was assigned to you — open My Trips to start it.',
        link: TRIP_LINK,
        emailTo: user.email,
        payload: { loadId: p.loadId },
      });
    }
  }

  // The previous assignee lost the trip (reassigned or unassigned).
  if (p.prevDriverId && p.prevDriverId !== p.driverId) {
    const user = await userForDriver(prisma, p.tenantId, p.prevDriverId);
    if (user) {
      const unassigned = !p.driverId;
      await notifications.notify({
        tenantId: p.tenantId,
        userId: user.id,
        kind: 'dispatch',
        title: unassigned ? `Trip no longer yours: ${l}` : `Trip reassigned: ${l}`,
        body: unassigned
          ? 'Dispatch removed this load from your board.'
          : 'Dispatch moved this load to another driver.',
        link: TRIP_LINK,
        emailTo: user.email,
        payload: { loadId: p.loadId },
      });
    }
  }
}

/** Resolves who should be notified when a load changes lifecycle status. */
export async function onLoadStatusChanged(
  deps: DispatchNotifierDeps,
  p: LoadStatusChangedPayload,
): Promise<void> {
  const { prisma, notifications } = deps;
  const l = lane(p);

  // The assignee driver advanced their own trip → tell the office (tenant-wide).
  if (p.actorDriverId && p.assigneeDriverId === p.actorDriverId) {
    const name = await driverName(prisma, p.actorDriverId);
    const who = name ?? 'The driver';
    await notifications.notify({
      tenantId: p.tenantId,
      kind: 'dispatch',
      title: `${who} ${DRIVER_ACTION[p.toStatus] ?? 'updated'} the ${l} trip`,
      body:
        p.toStatus === 'DELIVERED'
          ? 'Freight is off the truck — ready to invoice.'
          : p.toStatus === 'IN_TRANSIT'
            ? 'The load is on the road.'
            : undefined,
      link: OFFICE_LINK,
      payload: { loadId: p.loadId },
    });
    return;
  }

  // Office updated a dispatched trip → tell the assigned driver personally.
  if (p.assigneeDriverId && !p.actorDriverId) {
    const user = await userForDriver(prisma, p.tenantId, p.assigneeDriverId);
    if (!user) {
      deps.logger?.info(
        { tenantId: p.tenantId, driverId: p.assigneeDriverId },
        'dispatch: no linked user to notify for driver status update',
      );
      return;
    }
    await notifications.notify({
      tenantId: p.tenantId,
      userId: user.id,
      kind: 'dispatch',
      title: `Trip update: ${l}`,
      body: `Dispatch marked this load ${STATUS_LABEL[p.toStatus] ?? p.toStatus}.`,
      link: TRIP_LINK,
      emailTo: user.email,
      payload: { loadId: p.loadId },
    });
  }
}
