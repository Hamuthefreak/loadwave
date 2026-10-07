import type { PendingStore, QueueEnvelope } from './pendingQueue';

/**
 * Where queued writes wait on the phone.
 *
 * IndexedDB rather than localStorage: a renewal carries a photograph, and
 * localStorage is a ~5 MB string store that the theme, the fuel price and the
 * access token are already sharing. Small payloads ride along for free — one
 * database and one upgrade path beats a second storage strategy for fill-ups.
 *
 * One object store per kind of write, so a flush can only ever see its own
 * kind, and the queues themselves take this as an argument (see
 * pendingQueue.ts) for the same reason the offline cache takes its storage as
 * an argument: the decisions worth testing do not need a browser to run, and
 * this shim — open a database, read it, write to it, delete from it — is thin
 * enough to check where it runs.
 */

const DB_NAME = 'loadwave';

function factory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // Some private modes throw on the property itself rather than returning
    // undefined.
    return null;
  }
}

function isVersionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'VersionError';
}

/**
 * Open the database, at `version` when one is named.
 *
 * The upgrade creates every store it was asked for and nothing else, so it
 * cannot empty a queue that is mid-flight: a store that is already there is
 * left exactly as it is, renewals included.
 */
function open(stores: string[], version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = factory();
    if (!idb) {
      reject(new Error('indexeddb unavailable'));
      return;
    }
    // With no version, this is whatever the phone already has — or a brand new
    // database, which IndexedDB creates at version 1.
    const request = version === undefined ? idb.open(DB_NAME) : idb.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb refused'));
    request.onblocked = () => reject(new Error('indexeddb blocked by another tab'));
  });
}

/**
 * A connection that has the stores asked for — adding them if it has to.
 *
 * IndexedDB runs an upgrade only when the version number goes up, which makes
 * "add a store" a change that must be paired with a bump, and makes forgetting
 * the bump *silent*: the store is simply absent, every write to it fails, and
 * the queue reports the device as one that will not store anything — so an
 * offline fill-up becomes a live request, or, with no signal at all, a driver
 * being told their fuel was not recorded. A phone can also reach a given
 * version *without* a store if a build created the version while the store was
 * still being added.
 *
 * So this does not trust the numbering. It opens at the version the phone
 * already has, and if a store it was asked for is missing, it closes, bumps
 * past that version and opens again. A fresh database is created with its
 * stores in one step, and an old one is repaired on first use.
 */
async function openDatabase(stores: string[]): Promise<IDBDatabase> {
  let db = await open(stores);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (stores.every((name) => db.objectStoreNames.contains(name))) return db;
    const next = db.version + 1;
    db.close();
    try {
      db = await open(stores, next);
    } catch (error) {
      // Another tab got there first and made the same version; take what it
      // made and let the next pass decide.
      if (!isVersionError(error)) throw error;
      db = await open(stores);
    }
  }
  return db;
}

function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const pending = work(tx.objectStore(store));
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('indexeddb request failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
  });
}

async function withDatabase<T>(store: string, work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase([store]);
  try {
    return await work(db);
  } finally {
    // Closing per operation: this runs a handful of times a week, and a
    // connection left open blocks a future schema upgrade — including the one
    // openDatabase makes for itself.
    db.close();
  }
}

/** A queue's storage, in the app database, under one store name. */
export function indexedDbQueueStore<TItem extends QueueEnvelope>(
  name: string,
): PendingStore<TItem> {
  return {
    all: () => withDatabase(name, (db) => run<TItem[]>(db, name, 'readonly', (store) => store.getAll())),
    put: (item) =>
      withDatabase(name, async (db) => {
        await run(db, name, 'readwrite', (store) => store.put(item));
      }),
    delete: (id) =>
      withDatabase(name, async (db) => {
        await run(db, name, 'readwrite', (store) => store.delete(id));
      }),
    clear: () =>
      withDatabase(name, async (db) => {
        await run(db, name, 'readwrite', (store) => store.clear());
      }),
  };
}
