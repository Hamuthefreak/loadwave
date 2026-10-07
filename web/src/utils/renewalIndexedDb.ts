import type { QueuedRenewal, RenewalStore } from './renewalQueue';

/**
 * Where a renewal waits on the phone.
 *
 * IndexedDB rather than localStorage: this holds a photograph, and localStorage
 * is a ~5 MB string store that the theme, the fuel price and the access token
 * are already sharing.
 *
 * The queue itself takes this as an argument (see renewalQueue.ts) rather than
 * importing it, for the same reason the offline cache takes its storage as an
 * argument: the decisions worth testing do not need a browser to run, and this
 * shim — which opens one small database, reads it, writes to it and deletes
 * from it — is thin enough to check where it actually runs.
 */

const DB_NAME = 'loadwave';
const DB_VERSION = 1;
const STORE = 'renewals';

function factory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // Some private modes throw on the property itself rather than returning
    // undefined.
    return null;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = factory();
    if (!idb) {
      reject(new Error('indexeddb unavailable'));
      return;
    }
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb refused'));
    request.onblocked = () => reject(new Error('indexeddb blocked by another tab'));
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const pending = work(tx.objectStore(STORE));
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('indexeddb request failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
  });
}

async function withDatabase<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await work(db);
  } finally {
    // Closing per operation: this runs a handful of times a week, and a
    // connection left open blocks a future schema upgrade.
    db.close();
  }
}

export const indexedDbRenewalStore: RenewalStore = {
  all: () => withDatabase((db) => run<QueuedRenewal[]>(db, 'readonly', (store) => store.getAll())),
  put: (item) =>
    withDatabase(async (db) => {
      await run(db, 'readwrite', (store) => store.put(item));
    }),
  delete: (id) =>
    withDatabase(async (db) => {
      await run(db, 'readwrite', (store) => store.delete(id));
    }),
  clear: () =>
    withDatabase(async (db) => {
      await run(db, 'readwrite', (store) => store.clear());
    }),
};
