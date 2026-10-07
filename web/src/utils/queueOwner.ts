import { getTokenUser } from '../api';
import type { QueueOwner } from './pendingQueue';

/**
 * Who a queued write belongs to.
 *
 * Read from the session rather than passed down from a page, because the thing
 * that sends it later — an `online` event, an app opened on another page — has
 * no page to ask. Two drivers sharing a cab tablet therefore never see or send
 * each other's queue.
 */
export function currentOwner(): QueueOwner | null {
  const user = getTokenUser();
  if (!user?.sub) return null;
  return { userId: user.sub, tenantId: user.tenantId || null };
}
