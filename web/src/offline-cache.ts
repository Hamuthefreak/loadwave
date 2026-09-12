// Offline (service worker) cache hygiene.
//
// The service worker stores authenticated API reads so the app still shows the
// last-seen loads, trips and invoices with no signal. That data belongs to one
// session: it must be dropped when the session ends, or the next person to use
// a shared cab tablet could read it offline.
//
// Kept free of DOM type names (structural types + a globalThis lookup) so the
// backend test runner can import and exercise it directly.

/** Every cache this app creates starts with this prefix. */
export const APP_CACHE_PREFIX = 'loadwave';

export interface CacheStorageLike {
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<unknown>;
}

/** The browser's CacheStorage, or null where the API does not exist. */
export function cacheStorage(): CacheStorageLike | null {
  const candidate = (globalThis as { caches?: Partial<CacheStorageLike> }).caches;
  if (!candidate || typeof candidate.keys !== 'function' || typeof candidate.delete !== 'function') {
    return null;
  }
  return candidate as CacheStorageLike;
}

/**
 * Deletes this app's caches (and only this app's). Best-effort by design:
 * cache cleanup must never block a sign-in or a sign-out.
 */
export async function purgeOfflineCache(storage: CacheStorageLike | null = cacheStorage()): Promise<void> {
  if (!storage) return;
  try {
    const names = await storage.keys();
    await Promise.all(names.filter((name) => name.startsWith(APP_CACHE_PREFIX)).map((name) => storage.delete(name)));
  } catch {
    // Ignore: signed-out UI is more important than a stale cache.
  }
}
