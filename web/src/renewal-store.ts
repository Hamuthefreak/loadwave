import { useEffect, useSyncExternalStore } from 'react';
import {
  currentOwner,
  discardRenewal,
  flushWaitingRenewals,
  purgeQueuedRenewals,
  queuedRenewals,
} from './utils/renewalSend';
import { describeFlush, type QueuedRenewal } from './utils/renewalQueue';

/**
 * The renewal queue, as the app sees it.
 *
 * The point of queueing a document from the cab is that it goes out *without*
 * the driver thinking about it again, so the sending lives here rather than on
 * the page that shows it: `startRenewalQueue()` runs from the signed-in shell,
 * which means a renewal saved on Monday goes out on Tuesday morning from
 * whatever page the driver opens first, and the moment the phone finds the
 * network while they are holding it.
 */

export interface RenewalState {
  /** Waiting to send, oldest first. */
  items: QueuedRenewal[];
  /** True while a flush is in flight. */
  busy: boolean;
  /** Something worth telling the driver about the last flush. */
  notice: string | null;
  /** Renewals sent so far this session, so a page can refresh what it shows. */
  sentTotal: number;
  error: string | null;
}

let state: RenewalState = { items: [], busy: false, notice: null, sentTotal: 0, error: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<RenewalState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): RenewalState {
  return state;
}

/** Re-read what is waiting for the signed-in driver. */
export async function refreshRenewals(): Promise<void> {
  const items = await queuedRenewals(currentOwner());
  setState({ items });
}

/**
 * Forget the queue on this device. Called where the phone can change hands —
 * signing out and signing in — because what is waiting is a photograph of
 * somebody's licence, and it cannot be sent without the session that took it.
 */
export async function clearRenewals(): Promise<void> {
  await purgeQueuedRenewals();
  setState({ items: [] });
}

/**
 * Send what is waiting. Overlapping calls collapse in the queue itself, so this
 * is safe to call from a boot, an `online` event and a tap without
 * double-sending anything.
 */
export async function sendWaitingRenewals(options: { onlyId?: string; force?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  setState({ busy: true, error: null });
  try {
    const outcome = await flushWaitingRenewals({ onlyId: options.onlyId, force: options.force });
    const items = await queuedRenewals(currentOwner());
    setState({
      items,
      busy: false,
      // A run that sent nothing keeps whatever the last one had to say.
      notice: describeFlush(outcome) ?? state.notice,
      sentTotal: state.sentTotal + outcome.sent.length,
    });
  } catch (error) {
    setState({
      busy: false,
      error: error instanceof Error ? error.message : 'Those could not be sent.',
    });
  }
}

export function dismissRenewalNotice(): void {
  if (state.notice) setState({ notice: null });
}

/** Throw one away — offered only for a renewal the office has refused. */
export async function discardWaitingRenewal(id: string): Promise<void> {
  await discardRenewal(id);
  await refreshRenewals();
}

/**
 * Keep trying: once now, and again every time the phone finds the network.
 * Returns its own cleanup so it can be mounted from an effect.
 */
export function startRenewalQueue(): () => void {
  void refreshRenewals().then(() => sendWaitingRenewals());
  const onOnline = () => void sendWaitingRenewals();
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}

/**
 * Subscribe to the queue. Mounting this also tries to send: a browser that
 * never noticed the signal coming back (a captive portal, a phone that was
 * "online" the whole time) would otherwise sit on a renewal for a week.
 */
export function useRenewals(): RenewalState {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void refreshRenewals().then(() => sendWaitingRenewals());
  }, []);
  return current;
}
