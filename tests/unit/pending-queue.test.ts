// The error the API actually throws, from the module with no DOM in it — so
// `failureAction` is tested against the real class rather than a stand-in that
// would keep passing if the client stopped setting `status`.
// @ts-expect-error — cross-package ESM import from the web workspace
import { ApiError } from '../../web/src/api-error';
import {
  createPendingQueue,
  failureAction,
  retryDue,
  type PendingStore,
  type Queued,
  type QueueOwner,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/pendingQueue';

/**
 * The queue every offline write rides on — a renewal, a fill-up, and whatever
 * the cab needs next.
 *
 * It is the one part of the offline work a driver never sees and can never
 * check: it either sends what they recorded or it quietly does not, and the
 * first they know about it is somebody asking where it is. So the rules that
 * decide *not* to send — a stale copy, somebody else's account, a device that
 * will not store it — are pinned here, along with the rule that a failure the
 * network caused is never treated as an answer from the office.
 *
 * The core knows nothing about payloads, so the tests give it one that means
 * nothing on purpose: what is being checked is the machinery, not the fill-up
 * or the renewal hanging off it.
 *
 * Storage is a plain in-memory object rather than IndexedDB: the queue takes
 * its store as an argument (the app passes the IndexedDB one), which keeps
 * these tests about the decisions. The IndexedDB shim itself is exercised in a
 * browser, which is the only place it can be.
 */

interface NoteDraft {
  text: string;
}
type QueuedNote = Queued<NoteDraft>;

const MARIA: QueueOwner = { userId: 'user-maria', tenantId: 'tenant-1' };
const ALEX: QueueOwner = { userId: 'user-alex', tenantId: 'tenant-1' };

function draft(overrides: Partial<NoteDraft> = {}): NoteDraft {
  return { text: 'medical card', ...overrides };
}

/** A device that keeps what it is told, and nothing else. */
function memoryStore(): PendingStore<QueuedNote> & { items: QueuedNote[] } {
  const items: QueuedNote[] = [];
  return {
    items,
    all: async () => [...items],
    put: async (item) => {
      const at = items.findIndex((existing) => existing.id === item.id);
      if (at >= 0) items[at] = item;
      else items.push(item);
    },
    delete: async (id) => {
      const at = items.findIndex((existing) => existing.id === id);
      if (at >= 0) items.splice(at, 1);
    },
    clear: async () => {
      items.length = 0;
    },
  };
}

/** A device with no usable store at all: a private window, a full disk. */
function brokenStore(): PendingStore<QueuedNote> {
  const refuse = () => Promise.reject(new Error('indexeddb unavailable'));
  return { all: refuse, put: refuse, delete: refuse, clear: refuse };
}

const flushDeps = (
  send: (item: QueuedNote) => Promise<void>,
  extra: { skip?: (item: QueuedNote) => Promise<boolean> } = {},
) => ({ owner: MARIA, send, ...extra });

describe('failureAction', () => {
  it('treats a missing network, an expired session and a busy server as temporary', () => {
    for (const status of [401, 408, 429, 500, 502, 503]) {
      expect(failureAction(new ApiError('nope', status, null))).toBe('retry');
    }
    expect(failureAction(new TypeError('Failed to fetch'))).toBe('retry');
    expect(failureAction('not even an error')).toBe('retry');
  });

  it('treats a refusal by the office as the driver’s problem, not a retry', () => {
    for (const status of [400, 402, 403, 404, 409, 422]) {
      expect(failureAction(new ApiError('nope', status, null))).toBe('refused');
    }
  });
});

describe('retryDue', () => {
  const item = (overrides: Partial<QueuedNote> = {}): QueuedNote => ({
    ...draft(),
    id: 'item-1',
    userId: MARIA.userId,
    tenantId: MARIA.tenantId,
    queuedAt: 1_000,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    blocked: false,
    ...overrides,
  });

  it('tries a fresh write straight away', () => {
    expect(retryDue(item(), 1_000)).toBe(true);
  });

  it('waits a minute before the first retry', () => {
    const attempted = item({ attempts: 1, lastAttemptAt: 1_000_000 });
    expect(retryDue(attempted, 1_000_000 + 30_000)).toBe(false);
    expect(retryDue(attempted, 1_000_000 + 61_000)).toBe(true);
  });

  it('backs off to hours rather than retrying a refused write all day', () => {
    const attempted = item({ attempts: 9, lastAttemptAt: 1_000_000 });
    expect(retryDue(attempted, 1_000_000 + 60 * 60_000)).toBe(false);
    expect(retryDue(attempted, 1_000_000 + 6 * 60 * 60_000)).toBe(true);
  });
});

describe('keeping a write on the phone', () => {
  it('records what it was given, for the driver who took it', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    const kept = await queue.queue(draft({ text: 'new medical card' }), MARIA);
    expect(kept?.userId).toBe(MARIA.userId);
    expect(kept?.tenantId).toBe(MARIA.tenantId);
    expect(kept?.text).toBe('new medical card');
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting).toMatchObject({ attempts: 0, lastError: null, blocked: false, lastAttemptAt: null });
    expect(waiting?.id).toBe(kept?.id);
  });

  it('gives every write its own name', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    const first = await queue.queue(draft(), MARIA);
    const second = await queue.queue(draft(), MARIA);
    expect(first?.id).toBeTruthy();
    expect(second?.id).not.toBe(first?.id);
  });

  it('does not show one driver the write another one left on a shared tablet', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.queue(draft({ text: 'alex’s' }), ALEX);
    const marias = await queue.waiting(MARIA);
    expect(marias).toHaveLength(1);
    expect(marias[0]?.text).toBe('medical card');
    expect(await queue.waiting(null)).toEqual([]);
  });

  it('keeps them in the order they were taken', async () => {
    const store = memoryStore();
    const queue = createPendingQueue<QueuedNote>(store);
    const first = await queue.queue(draft(), MARIA);
    const second = await queue.queue(draft({ text: 'second' }), MARIA);
    // Same millisecond is normal for two taps, so the order is settled by the
    // queue's own sort rather than by which one landed first in the store.
    for (const item of store.items) item.queuedAt = item.id === first?.id ? 1_000 : 2_000;
    expect((await queue.waiting(MARIA)).map((item) => item.id)).toEqual([first?.id, second?.id]);
  });

  it('forgets everything on this device when asked', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.queue(draft(), ALEX);
    await queue.purge();
    expect(await queue.waiting(MARIA)).toEqual([]);
    expect(await queue.waiting(ALEX)).toEqual([]);
  });

  it('discards one write without touching the others', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    const first = await queue.queue(draft(), MARIA);
    await queue.queue(draft({ text: 'second' }), MARIA);
    await queue.discard(first?.id as string);
    const waiting = await queue.waiting(MARIA);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.text).toBe('second');
  });

  it('says so instead of pretending, when the device will not store it', async () => {
    const queue = createPendingQueue<QueuedNote>(brokenStore());
    expect(await queue.queue(draft(), MARIA)).toBeNull();
  });

  it('reads as empty rather than broken when the store is unusable', async () => {
    // A private window with no IndexedDB must not take the dashboard down with
    // it: there is nothing to show, and that is all.
    const queue = createPendingQueue<QueuedNote>(brokenStore());
    expect(await queue.waiting(MARIA)).toEqual([]);
    await expect(queue.purge()).resolves.toBeUndefined();
    await expect(queue.discard('anything')).resolves.toBeUndefined();
  });
});

describe('sending what is waiting', () => {
  it('sends it once, and takes it off the phone', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    const sent: string[] = [];
    const outcome = await queue.flush(
      flushDeps(async (item) => {
        sent.push(item.text);
      }),
    );
    expect(sent).toEqual(['medical card']);
    expect(outcome.sent).toHaveLength(1);
    expect(outcome.remaining).toEqual([]);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('keeps a write the network dropped, with the reason, and not blocked', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    const outcome = await queue.flush(
      flushDeps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(outcome.sent).toEqual([]);
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting?.attempts).toBe(1);
    expect(waiting?.lastError).toBe('Failed to fetch');
    expect(waiting?.blocked).toBe(false);
    expect(waiting?.lastAttemptAt).toBeGreaterThan(0);
  });

  it('keeps a refused write but marks it as needing the driver', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.flush(
      flushDeps(async () => {
        throw new ApiError('No driver profile is linked to this account', 403, null);
      }),
    );
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting?.blocked).toBe(true);
    expect(waiting?.lastError).toMatch(/no driver profile/i);
  });

  it('keeps a write that was already on the phone when the write-back failed', async () => {
    // The attempt count is bookkeeping; the write is not. If recording the
    // failure fails, the write still has to be there afterwards.
    const store = memoryStore();
    const queue = createPendingQueue<QueuedNote>(store);
    await queue.queue(draft(), MARIA);
    store.put = () => Promise.reject(new Error('disk full'));
    const outcome = await queue.flush(
      flushDeps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(outcome.remaining).toHaveLength(1);
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting?.text).toBe('medical card');
  });

  it('drops a write the skip rule says the server already has, without sending it', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    let attempts = 0;
    const outcome = await queue.flush(
      flushDeps(
        async () => {
          attempts += 1;
        },
        { skip: async () => true },
      ),
    );
    expect(attempts).toBe(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('only asks the skip rule about a write it was going to send', async () => {
    // An item still inside its backoff is not due, so nothing should reach the
    // server-facing skip rule for it.
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.flush(
      flushDeps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    let asked = 0;
    await queue.flush(flushDeps(async () => undefined, { skip: async () => { asked += 1; return false; } }));
    expect(asked).toBe(0);
  });

  it('sends one write once, however many triggers fire at the same moment', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    let attempts = 0;
    const run = () =>
      queue.flush(
        flushDeps(async () => {
          attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }),
      );
    const [first, second] = await Promise.all([run(), run()]);
    expect(attempts).toBe(1);
    expect(first.sent).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('leaves a failed write alone until its backoff has passed, unless asked', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.flush(
      flushDeps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    let attempts = 0;
    const retry = (force: boolean) =>
      queue.flush({
        ...flushDeps(async () => {
          attempts += 1;
        }),
        force,
      });
    await retry(false);
    expect(attempts).toBe(0);
    await retry(true);
    expect(attempts).toBe(1);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('sends only the one the driver pointed at', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    const second = await queue.queue(draft({ text: 'second' }), MARIA);
    const sent: string[] = [];
    await queue.flush({
      ...flushDeps(async (item) => {
        sent.push(item.text);
      }),
      onlyId: second?.id,
      force: true,
    });
    expect(sent).toEqual(['second']);
    expect((await queue.waiting(MARIA)).map((item) => item.text)).toEqual(['medical card']);
  });

  it('sends nothing while nobody is signed in', async () => {
    const queue = createPendingQueue<QueuedNote>(memoryStore());
    await queue.queue(draft(), MARIA);
    let attempts = 0;
    const outcome = await queue.flush({
      owner: null,
      send: async () => {
        attempts += 1;
      },
    });
    expect(attempts).toBe(0);
    expect(outcome.signedOut).toBe(true);
    // The driver's own copy is still there for when they sign back in.
    expect(await queue.waiting(MARIA)).toHaveLength(1);
  });
});
