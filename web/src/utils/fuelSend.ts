import { api } from '../api';
import { describeFuelFlush, sourceRefFor, type FuelStopDraft } from './fuelQueue';
import { indexedDbQueueStore } from './pendingIndexedDb';
import { createPendingQueue, type FlushOutcome, type Queued, type QueueOwner } from './pendingQueue';
import { currentOwner } from './queueOwner';

/**
 * The app side of the fill-up queue: the device it waits on, who is signed in,
 * and how one fill-up reaches the office.
 *
 * The queue lives here as a single instance rather than inside the module that
 * defines it, which is what lets a test create its own with storage that never
 * touches a real database.
 */

export type QueuedFuelStop = Queued<FuelStopDraft>;

const queue = createPendingQueue<QueuedFuelStop>(indexedDbQueueStore<QueuedFuelStop>('fuel'));

/**
 * Send one fill-up.
 *
 * `sourceEventId` is the whole reason this is safe to retry: the API treats it
 * as unique per tenant and hands back the row it already has, so a retry after
 * a lost response cannot add the litres to the quarter a second time.
 */
export async function sendFuelStop(stop: FuelStopDraft): Promise<void> {
  await api('/api/fuel/me', {
    method: 'POST',
    body: {
      jurisdictionCode: stop.jurisdictionCode,
      volume: stop.volume,
      unit: stop.unit,
      amountTransaction: stop.amountTransaction,
      transactionCurrency: stop.transactionCurrency,
      occurredAt: stop.occurredAt,
      sourceEventId: sourceRefFor(stop.clientRef),
    },
  });
}

/** Keep a fill-up on this device, or null when the device will not store it. */
export function queueFuelStop(stop: FuelStopDraft, owner: QueueOwner): Promise<QueuedFuelStop | null> {
  return queue.queue(stop, owner);
}

/** Everything waiting for this account, oldest first. */
export function queuedFuelStops(owner: QueueOwner | null): Promise<QueuedFuelStop[]> {
  return queue.waiting(owner);
}

export function discardQueuedFuelStop(id: string): Promise<void> {
  return queue.discard(id);
}

/** Drop everything on this device — signing out, or handing the phone over. */
export function purgeQueuedFuelStops(): Promise<void> {
  return queue.purge();
}

/** Send everything waiting for the signed-in driver. */
export function flushWaitingFuelStops(
  options: { onlyId?: string; force?: boolean } = {},
): Promise<FlushOutcome<QueuedFuelStop>> {
  return queue.flush({ owner: currentOwner(), send: sendFuelStop, ...options });
}

export { describeFuelFlush };
