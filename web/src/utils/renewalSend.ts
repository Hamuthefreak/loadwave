import { api, getTokenUser } from '../api';
import { indexedDbRenewalStore } from './renewalIndexedDb';
import {
  createRenewalQueue,
  type FlushOutcome,
  type OnFile,
  type QueuedRenewal,
  type QueueOwner,
  type RenewalDraft,
} from './renewalQueue';

/**
 * The app side of the renewal queue: the device it waits on, who is signed in,
 * how one renewal is sent, and what the office already has on file.
 *
 * The queue lives here as a single instance rather than inside the module that
 * defines it, which is what lets a test create its own with storage that never
 * touches a real database.
 */

const queue = createRenewalQueue(indexedDbRenewalStore);

export function currentOwner(): QueueOwner | null {
  const user = getTokenUser();
  if (!user?.sub) return null;
  return { userId: user.sub, tenantId: user.tenantId || null };
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Send one renewal to the office.
 *
 * Shared by the immediate path and the queue so a retry cannot drift from a
 * first attempt: the same body, the same route, the same auth handling.
 */
export async function sendRenewal(item: RenewalDraft): Promise<void> {
  const body: Record<string, unknown> = {
    identifier: item.identifier,
    expiresAt: item.expiresAt,
  };
  if (item.photo) {
    // Base64 in the JSON body, the same as every other upload here: one request
    // and no signed URL to get wrong on a truck-stop connection.
    body.data = base64FromBytes(new Uint8Array(await item.photo.arrayBuffer()));
    body.fileName = item.fileName ?? 'renewal';
    body.mimeType = item.mimeType || item.photo.type || 'application/octet-stream';
  }
  await api(`/api/compliance/me/${item.kind}`, { method: 'PUT', body });
}

/** What the office already has for a kind, so a stale upload is not re-sent. */
export async function complianceOnFile(kind: string): Promise<OnFile | null> {
  const me = await api<{
    items?: Array<{ kind: string; expiresAt: string | null; hasFile: boolean; pendingReview: boolean }>;
  }>('/api/compliance/me');
  const row = me.items?.find((item) => item.kind === kind);
  if (!row) return null;
  return { expiresAt: row.expiresAt, hasFile: row.hasFile, pendingReview: row.pendingReview };
}

/** Keep a renewal on this device, or null when the device will not store it. */
export function queueRenewal(draft: RenewalDraft, owner: QueueOwner): Promise<QueuedRenewal | null> {
  return queue.queue(draft, owner);
}

/** Everything waiting for this account, oldest first. */
export function queuedRenewals(owner: QueueOwner | null): Promise<QueuedRenewal[]> {
  return queue.waiting(owner);
}

export function discardRenewal(id: string): Promise<void> {
  return queue.discard(id);
}

/** Drop everything on this device — signing out, or handing the phone over. */
export function purgeQueuedRenewals(): Promise<void> {
  return queue.purge();
}

/** Send everything waiting for the signed-in driver. */
export function flushWaitingRenewals(
  options: { onlyId?: string; force?: boolean } = {},
): Promise<FlushOutcome> {
  return queue.flush({
    owner: currentOwner(),
    send: sendRenewal,
    onFile: complianceOnFile,
    ...options,
  });
}
