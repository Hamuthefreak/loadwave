// The error the API actually throws, from the module with no DOM in it — so
// `failureAction` is tested against the real class rather than a stand-in that
// would keep passing if the client stopped setting `status`.
// @ts-expect-error — cross-package ESM import from the web workspace
import { ApiError } from '../../web/src/api-error';
import {
  createRenewalQueue,
  failureAction,
  retryDue,
  supersededBy,
  type OnFile,
  type QueuedRenewal,
  type QueueOwner,
  type RenewalDraft,
  type RenewalStore,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/renewalQueue';

/**
 * The renewal queue, which is the one part of the compliance work a driver
 * never sees and can never check: it either sends their new medical card or it
 * quietly does not, and the first they know about it is a dispatcher asking
 * where the document is. So the rules that decide *not* to send — a stale copy,
 * somebody else's account, a device that will not store it — are pinned here,
 * along with the rule that a failure the network caused is never treated as an
 * answer from the office.
 *
 * Storage is a plain in-memory object rather than IndexedDB: the queue takes
 * its store as an argument (the app passes the IndexedDB one), which keeps
 * these tests about the decisions. The IndexedDB shim itself is exercised in a
 * browser, which is the only place it can be.
 */

const MARIA: QueueOwner = { userId: 'user-maria', tenantId: 'tenant-1' };
const ALEX: QueueOwner = { userId: 'user-alex', tenantId: 'tenant-1' };

function draft(overrides: Partial<RenewalDraft> = {}): RenewalDraft {
  return {
    kind: 'CDL',
    label: 'CDL / licence',
    identifier: 'L-1002',
    expiresAt: '2027-04-21',
    photo: null,
    fileName: null,
    mimeType: null,
    ...overrides,
  };
}

function onFile(overrides: Partial<OnFile> = {}): OnFile {
  return { expiresAt: '2026-10-25T00:00:00.000Z', hasFile: false, pendingReview: false, ...overrides };
}

/** A device that keeps what it is told, and nothing else. */
function memoryStore(): RenewalStore & { items: QueuedRenewal[] } {
  const items: QueuedRenewal[] = [];
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
function brokenStore(): RenewalStore {
  const refuse = () => Promise.reject(new Error('indexeddb unavailable'));
  return { all: refuse, put: refuse, delete: refuse, clear: refuse };
}

const flushDeps = (
  send: (item: QueuedRenewal) => Promise<void>,
  onFileFor: (kind: string) => Promise<OnFile | null> = async () => null,
) => ({ owner: MARIA, send, onFile: onFileFor });

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

describe('supersededBy', () => {
  it('sends when nothing is on file', () => {
    expect(supersededBy(draft(), null)).toBe(false);
  });

  it('drops a copy the office has already matched or beaten', () => {
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2027-04-21' }))).toBe(true);
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2027-05-01' }))).toBe(true);
  });

  it('sends a newer date than the one on file', () => {
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2026-10-25' }))).toBe(false);
  });

  it('sends when there is no date to compare', () => {
    // A renewal with no expiry is still a driver saying "the new card is here".
    expect(supersededBy(draft({ expiresAt: null }), onFile())).toBe(false);
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: null }))).toBe(false);
  });

  it('sends a photo the office does not have, whatever the date says', () => {
    // The photograph is the point: the office was missing the scan, not the
    // date, and a later date typed in by hand does not supply the scan.
    const withPhoto = draft({ photo: new Blob(['x']), fileName: 'card.jpg', mimeType: 'image/jpeg' });
    const filedLater = { expiresAt: '2028-01-01T00:00:00.000Z', pendingReview: false };
    expect(supersededBy(withPhoto, onFile({ ...filedLater, hasFile: false }))).toBe(false);
    // With the scan already on file too, the date is the only thing left to decide.
    expect(supersededBy(withPhoto, onFile({ ...filedLater, hasFile: true }))).toBe(true);
  });
});

describe('retryDue', () => {
  const item = (overrides: Partial<QueuedRenewal> = {}): QueuedRenewal => ({
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

  it('tries a fresh renewal straight away', () => {
    expect(retryDue(item(), 1_000)).toBe(true);
  });

  it('waits a minute before the first retry', () => {
    const attempted = item({ attempts: 1, lastAttemptAt: 1_000_000 });
    expect(retryDue(attempted, 1_000_000 + 30_000)).toBe(false);
    expect(retryDue(attempted, 1_000_000 + 61_000)).toBe(true);
  });

  it('backs off to hours rather than retrying a refused document all day', () => {
    const attempted = item({ attempts: 9, lastAttemptAt: 1_000_000 });
    expect(retryDue(attempted, 1_000_000 + 60 * 60_000)).toBe(false);
    expect(retryDue(attempted, 1_000_000 + 6 * 60 * 60_000)).toBe(true);
  });
});

describe('keeping a renewal on the phone', () => {
  it('records what it was given, for the driver who took it', async () => {
    const queue = createRenewalQueue(memoryStore());
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const kept = await queue.queue(draft({ photo, fileName: 'card.png', mimeType: 'image/png' }), MARIA);
    expect(kept?.userId).toBe(MARIA.userId);
    expect(kept?.identifier).toBe('L-1002');
    expect(kept?.expiresAt).toBe('2027-04-21');
    expect(kept?.photo).toBe(photo);
    expect(kept?.fileName).toBe('card.png');
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting).toMatchObject({ attempts: 0, lastError: null, blocked: false, lastAttemptAt: null });
  });

  it('does not show one driver the renewal another one left on a shared tablet', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.queue(draft({ kind: 'MEDICAL_CARD' }), ALEX);
    const marias = await queue.waiting(MARIA);
    expect(marias).toHaveLength(1);
    expect(marias[0]?.kind).toBe('CDL');
    expect(await queue.waiting(null)).toEqual([]);
  });

  it('keeps them in the order they were taken', async () => {
    const store = memoryStore();
    const queue = createRenewalQueue(store);
    const first = await queue.queue(draft(), MARIA);
    const second = await queue.queue(draft({ kind: 'MEDICAL_CARD' }), MARIA);
    // Same millisecond is normal for two taps, so the order is settled by the
    // queue's own sort rather than by which one landed first in the store.
    for (const item of store.items) item.queuedAt = item.id === first?.id ? 1_000 : 2_000;
    expect((await queue.waiting(MARIA)).map((item) => item.id)).toEqual([first?.id, second?.id]);
  });

  it('forgets everything on this device when asked', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.queue(draft(), ALEX);
    await queue.purge();
    expect(await queue.waiting(MARIA)).toEqual([]);
    expect(await queue.waiting(ALEX)).toEqual([]);
  });

  it('discards one renewal without touching the others', async () => {
    const queue = createRenewalQueue(memoryStore());
    const first = await queue.queue(draft(), MARIA);
    await queue.queue(draft({ kind: 'MEDICAL_CARD' }), MARIA);
    await queue.discard(first?.id as string);
    const waiting = await queue.waiting(MARIA);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.kind).toBe('MEDICAL_CARD');
  });

  it('says so instead of pretending, when the device will not store it', async () => {
    const queue = createRenewalQueue(brokenStore());
    expect(await queue.queue(draft(), MARIA)).toBeNull();
  });

  it('reads as empty rather than broken when the store is unusable', async () => {
    // A private window with no IndexedDB must not take the dashboard down with
    // it: there is nothing to show, and that is all.
    const queue = createRenewalQueue(brokenStore());
    expect(await queue.waiting(MARIA)).toEqual([]);
    await expect(queue.purge()).resolves.toBeUndefined();
    await expect(queue.discard('anything')).resolves.toBeUndefined();
  });
});

describe('sending what is waiting', () => {
  it('sends it once, and takes it off the phone', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    const sent: string[] = [];
    const outcome = await queue.flush(
      flushDeps(async (item) => {
        sent.push(item.kind);
      }),
    );
    expect(sent).toEqual(['CDL']);
    expect(outcome.sent).toHaveLength(1);
    expect(outcome.remaining).toEqual([]);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('keeps a renewal the network dropped, with the reason, and not blocked', async () => {
    const queue = createRenewalQueue(memoryStore());
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

  it('keeps a refused renewal but marks it as needing the driver', async () => {
    const queue = createRenewalQueue(memoryStore());
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

  it('keeps a renewal that was already on the phone when the write-back failed', async () => {
    // The attempt count is bookkeeping; the renewal is not. If recording the
    // failure fails, the renewal still has to be there afterwards.
    const store = memoryStore();
    const queue = createRenewalQueue(store);
    await queue.queue(draft(), MARIA);
    store.put = () => Promise.reject(new Error('disk full'));
    const outcome = await queue.flush(
      flushDeps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(outcome.remaining).toHaveLength(1);
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting?.kind).toBe('CDL');
  });

  it('drops a stale copy without sending anything', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft({ expiresAt: '2027-04-21' }), MARIA);
    let attempts = 0;
    const outcome = await queue.flush(
      flushDeps(
        async () => {
          attempts += 1;
        },
        async () => onFile({ expiresAt: '2027-09-01', hasFile: true }),
      ),
    );
    expect(attempts).toBe(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('looks up what is on file once per document kind, not once per renewal', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.queue(draft(), MARIA);
    let lookups = 0;
    await queue.flush(
      flushDeps(async () => undefined, async () => {
        lookups += 1;
        return null;
      }),
    );
    expect(lookups).toBe(1);
  });

  it('sends one renewal once, however many triggers fire at the same moment', async () => {
    const queue = createRenewalQueue(memoryStore());
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

  it('leaves a failed renewal alone until its backoff has passed, unless asked', async () => {
    const queue = createRenewalQueue(memoryStore());
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
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    const second = await queue.queue(draft({ kind: 'MEDICAL_CARD' }), MARIA);
    const sent: string[] = [];
    await queue.flush({
      ...flushDeps(async (item) => {
        sent.push(item.kind);
      }),
      onlyId: second?.id,
      force: true,
    });
    expect(sent).toEqual(['MEDICAL_CARD']);
    expect((await queue.waiting(MARIA)).map((item) => item.kind)).toEqual(['CDL']);
  });

  it('sends nothing while nobody is signed in', async () => {
    const queue = createRenewalQueue(memoryStore());
    await queue.queue(draft(), MARIA);
    let attempts = 0;
    const outcome = await queue.flush({
      owner: null,
      send: async () => {
        attempts += 1;
      },
      onFile: async () => null,
    });
    expect(attempts).toBe(0);
    expect(outcome.signedOut).toBe(true);
    // The driver's own copy is still there for when they sign back in.
    expect(await queue.waiting(MARIA)).toHaveLength(1);
  });
});
