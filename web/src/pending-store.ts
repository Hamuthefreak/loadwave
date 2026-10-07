import { useEffect, useSyncExternalStore } from 'react';
import { describeFuelFlush } from './utils/fuelQueue';
import {
  discardQueuedFuelStop,
  flushWaitingFuelStops,
  purgeQueuedFuelStops,
  queuedFuelStops,
  type QueuedFuelStop,
} from './utils/fuelSend';
import { currentOwner } from './utils/queueOwner';
import { describeFlush } from './utils/renewalQueue';
import {
  discardRenewal,
  flushWaitingRenewals,
  purgeQueuedRenewals,
  queuedRenewals,
  type QueuedRenewal,
} from './utils/renewalSend';

/**
 * What the app can see of the queues, one per kind of write.
 *
 * The point of queueing something from the cab is that it goes out *without*
 * the driver thinking about it again, so the sending lives here rather than on
 * the page that shows it: `startPendingQueues()` runs from the signed-in shell,
 * which means a renewal or a fill-up saved on Monday goes out on Tuesday
 * morning from whatever page the driver opens first, and the moment the phone
 * finds the network while they are holding it.
 */

export interface QueueState<TItem> {
  /** Waiting to send, oldest first. */
  items: TItem[];
  /** True while a flush is in flight. */
  busy: boolean;
  /** Something worth telling the driver about the last flush. */
  notice: string | null;
  /** Writes sent so far this session, so a page can refresh what it shows. */
  sentTotal: number;
  error: string | null;
}

interface QueueSource<TItem> {
  load: () => Promise<TItem[]>;
  send: (options: { onlyId?: string; force?: boolean }) => Promise<{ sent: TItem[]; skipped: TItem[] }>;
  discard: (id: string) => Promise<void>;
  purge: () => Promise<void>;
  describe: (outcome: { sent: TItem[]; skipped: TItem[] }) => string | null;
}

function emptyState<TItem>(): QueueState<TItem> {
  return { items: [], busy: false, notice: null, sentTotal: 0, error: null };
}

/**
 * One queue's store: read what is waiting, send it, and hold the one line worth
 * telling the driver about it. Written once here so a renewal and a fill-up
 * cannot drift into behaving differently.
 */
function createQueueStore<TItem>(source: QueueSource<TItem>) {
  let state = emptyState<TItem>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const setState = (patch: Partial<QueueState<TItem>>) => {
    state = { ...state, ...patch };
    emit();
  };

  const refresh = async (): Promise<void> => {
    setState({ items: await source.load() });
  };

  const sendWaiting = async (options: { onlyId?: string; force?: boolean } = {}): Promise<void> => {
    if (state.busy) return;
    setState({ busy: true, error: null });
    try {
      const outcome = await source.send(options);
      setState({
        items: await source.load(),
        busy: false,
        // A run that sent nothing keeps whatever the last one had to say.
        notice: source.describe(outcome) ?? state.notice,
        sentTotal: state.sentTotal + outcome.sent.length,
      });
    } catch (error) {
      setState({
        busy: false,
        error: error instanceof Error ? error.message : 'Those could not be sent.',
      });
    }
  };

  const clear = async (): Promise<void> => {
    await source.purge();
    setState({ items: [] });
  };

  const dismiss = (): void => {
    if (state.notice) setState({ notice: null });
  };

  const discardOne = async (id: string): Promise<void> => {
    await source.discard(id);
    await refresh();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    refresh,
    sendWaiting,
    clear,
    dismiss,
    discardOne,
  };
}

const renewals = createQueueStore<QueuedRenewal>({
  load: () => queuedRenewals(currentOwner()),
  send: flushWaitingRenewals,
  discard: discardRenewal,
  purge: purgeQueuedRenewals,
  describe: describeFlush,
});

const fuel = createQueueStore<QueuedFuelStop>({
  load: () => queuedFuelStops(currentOwner()),
  send: flushWaitingFuelStops,
  discard: discardQueuedFuelStop,
  purge: purgeQueuedFuelStops,
  describe: describeFuelFlush,
});

export const refreshRenewals = renewals.refresh;
export const sendWaitingRenewals = renewals.sendWaiting;
export const dismissRenewalNotice = renewals.dismiss;
export const discardWaitingRenewal = renewals.discardOne;

export const refreshFuelQueue = fuel.refresh;
export const sendWaitingFuelStops = fuel.sendWaiting;
export const dismissFuelQueueNotice = fuel.dismiss;
export const discardWaitingFuelStop = fuel.discardOne;

/**
 * Forget the queues on this device. Called where the phone can change hands —
 * signing out and signing in — because what is waiting is a photograph of
 * somebody's licence and a record of where they bought fuel, and neither can be
 * sent without the session that took it.
 */
export async function clearPendingQueues(): Promise<void> {
  await Promise.all([renewals.clear(), fuel.clear()]);
}

/**
 * Keep trying: once now, and again every time the phone finds the network.
 * Returns its own cleanup so it can be mounted from an effect.
 */
export function startPendingQueues(): () => void {
  void Promise.all([renewals.refresh(), fuel.refresh()]).then(() =>
    Promise.all([renewals.sendWaiting(), fuel.sendWaiting()]),
  );
  const onOnline = () => {
    void renewals.sendWaiting();
    void fuel.sendWaiting();
  };
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}

/**
 * Subscribe to a queue. Mounting this also tries to send: a browser that never
 * noticed the signal coming back (a captive portal, a phone that was "online"
 * the whole time) would otherwise sit on a write for a week.
 */
function useQueue<TItem>(store: ReturnType<typeof createQueueStore<TItem>>): QueueState<TItem> {
  const current = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    void store.refresh().then(() => store.sendWaiting());
  }, [store]);
  return current;
}

export function useRenewals(): QueueState<QueuedRenewal> {
  return useQueue(renewals);
}

export function useFuelQueue(): QueueState<QueuedFuelStop> {
  return useQueue(fuel);
}
