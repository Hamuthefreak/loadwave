/**
 * Regression guard for the offline cache leaking between users.
 *
 * The service worker caches authenticated API reads (loads, trips, invoices)
 * so the app works with no signal. If that cache outlives the session, the
 * next person on a shared cab tablet can read the previous user's data
 * offline. These tests pin the purge itself, and that sign-out (and a dead
 * session) actually calls it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

// web/ is an ES module ("type": "module" in web/package.json). ts-jest loads it
// without complaint; the root CommonJS typecheck needs the directive. Keep it
// on the line directly above the import.
// @ts-expect-error — ESM import from a CommonJS test file
import { APP_CACHE_PREFIX, cacheStorage, purgeOfflineCache } from '../../web/src/offline-cache';

function fakeStorage(names: readonly string[]) {
  const deleted: string[] = [];
  return {
    deleted,
    storage: {
      keys: jest.fn(async () => names),
      delete: jest.fn(async (name: string) => {
        deleted.push(name);
        return true;
      }),
    },
  };
}

describe('purgeOfflineCache', () => {
  it('deletes this app caches and leaves other apps alone', async () => {
    const { storage, deleted } = fakeStorage(['loadwave-offline-v1', 'loadwave-push-v1', 'other-app-cache']);
    await purgeOfflineCache(storage);

    expect(deleted.sort()).toEqual(['loadwave-offline-v1', 'loadwave-push-v1']);
    expect(deleted).not.toContain('other-app-cache');
  });

  it('is a no-op where the Cache Storage API does not exist', async () => {
    await expect(purgeOfflineCache(null)).resolves.toBeUndefined();
    await expect(purgeOfflineCache(cacheStorage())).resolves.toBeUndefined();
  });

  it('never throws when the cache API rejects', async () => {
    const storage = {
      keys: jest.fn(async () => ['loadwave-offline-v1']),
      delete: jest.fn(async () => {
        throw new Error('quota');
      }),
    };
    await expect(purgeOfflineCache(storage)).resolves.toBeUndefined();
  });

  it('uses a prefix that matches the service worker cache name', () => {
    const sw = readFileSync(path.join(__dirname, '../../web/public/sw.js'), 'utf8');
    const name = /const OFFLINE_CACHE = '([^']+)'/.exec(sw)?.[1] ?? '';
    expect(name).not.toBe('');
    expect(name.startsWith(APP_CACHE_PREFIX)).toBe(true);
  });
});

/**
 * The purge only protects anything if the session teardown paths call it.
 * `web/src/api.ts` needs DOM types (fetch/Storage) the backend test runner
 * does not compile, so the wiring is asserted from source.
 */
describe('session teardown purges the offline cache', () => {
  const apiSource = readFileSync(path.join(__dirname, '../../web/src/api.ts'), 'utf8');

  const body = (signature: string): string => {
    const start = apiSource.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return apiSource.slice(start, start + 1200);
  };

  it('purges on sign-out', () => {
    expect(body('export async function signOut')).toContain('await purgeOfflineCache()');
  });

  it('purges when a session cannot be refreshed', () => {
    const start = apiSource.indexOf('if (!refreshed)');
    expect(start).toBeGreaterThan(-1);
    expect(apiSource.slice(start, start + 160)).toContain('purgeOfflineCache()');
  });

  it('purges right after a fresh sign-in', () => {
    const signIn = readFileSync(path.join(__dirname, '../../web/src/pages/SignIn.tsx'), 'utf8');
    expect(signIn).toContain('purgeOfflineCache');
  });
});
