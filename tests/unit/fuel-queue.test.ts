import {
  newFuelRef,
  sourceRefFor,
  describeFuelFlush,
  type FuelStopDraft,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/fuelQueue';
import {
  createPendingQueue,
  type PendingStore,
  type Queued,
  type QueueOwner,
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/pendingQueue';

/**
 * The fill-up half of the offline queue.
 *
 * Two things make a fill-up different from the renewal the queue was built for,
 * and both are pinned here: it carries the time it was pumped rather than the
 * time the phone found signal, and the endpoint it goes to is not an upsert —
 * so a retry after a response that never arrived must be recognisable to the
 * server as the same purchase rather than a second one. The second is a
 * quarterly tax return, not a warning: a duplicated fill-up is fuel counted
 * twice in a jurisdiction.
 *
 * `fuelSend.ts` is what actually posts, and it reaches the API client, which
 * needs a browser. What runs here is the decision layer around it — the name
 * the phone gives a fill-up, and what survives the trip through the queue.
 */

type QueuedFuelStop = Queued<FuelStopDraft>;

const MARIA: QueueOwner = { userId: 'user-maria', tenantId: 'tenant-1' };

function draft(overrides: Partial<FuelStopDraft> = {}): FuelStopDraft {
  return {
    clientRef: 'ref-0001',
    jurisdictionCode: 'QC',
    volume: 250,
    unit: 'L',
    amountTransaction: 320.5,
    transactionCurrency: 'CAD',
    occurredAt: '2026-10-06T14:05:00.000Z',
    ...overrides,
  };
}

function memoryStore(): PendingStore<QueuedFuelStop> & { items: QueuedFuelStop[] } {
  const items: QueuedFuelStop[] = [];
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

describe('the name a fill-up is sent under', () => {
  it('makes a fresh name for every fill-up', () => {
    const refs = new Set(Array.from({ length: 50 }, () => newFuelRef()));
    expect(refs.size).toBe(50);
    for (const ref of refs) expect(ref).toBeTruthy();
  });

  it('stays inside what the endpoint will accept', () => {
    // The route caps `sourceEventId` at 120 characters and requires 8, and a
    // rejected body is a refusal — the driver gets told and the fill-up sits
    // blocked on the phone rather than being retried.
    for (let i = 0; i < 20; i += 1) {
      const sent = sourceRefFor(newFuelRef());
      expect(sent.length).toBeGreaterThanOrEqual(8);
      expect(sent.length).toBeLessThanOrEqual(120);
    }
  });

  it('marks the reference as coming from the cab, and changes nothing else', () => {
    expect(sourceRefFor('abc-123')).toBe('cab:abc-123');
    expect(sourceRefFor('abc-123')).toBe(sourceRefFor('abc-123'));
  });
});

describe('describeFuelFlush', () => {
  it('says nothing when nothing went', () => {
    expect(describeFuelFlush({ sent: [] })).toBeNull();
  });

  it('says one fill-up is in, and which quarter it counts in', () => {
    const message = describeFuelFlush({ sent: [draft()] });
    expect(message).toMatch(/went in/);
    expect(message).toMatch(/quarter you bought it in/);
  });

  it('counts more than one', () => {
    expect(describeFuelFlush({ sent: [draft(), draft()] })).toMatch(/2 fill-ups/);
  });
});

describe('a fill-up waiting for signal', () => {
  it('is kept exactly as it was pumped, with the queue bookkeeping added', async () => {
    const queue = createPendingQueue<QueuedFuelStop>(memoryStore());
    const pumped = draft({ volume: 96.4, unit: 'GAL', amountTransaction: 289.99, jurisdictionCode: 'NY' });
    const kept = await queue.queue(pumped, MARIA);
    expect(kept).toMatchObject({
      clientRef: 'ref-0001',
      jurisdictionCode: 'NY',
      volume: 96.4,
      unit: 'GAL',
      amountTransaction: 289.99,
      transactionCurrency: 'CAD',
      occurredAt: '2026-10-06T14:05:00.000Z',
      userId: MARIA.userId,
      attempts: 0,
      blocked: false,
    });
    // Still a number, because the card renders it through `Number(...)` and the
    // body sends it as one.
    expect(typeof kept?.volume).toBe('number');
  });

  it('keeps the time it was pumped, not the time the phone found signal', async () => {
    // The whole point of carrying `occurredAt` in the draft: the engine credits
    // the litres to the quarter they were bought in, so a fill-up that waited
    // two days for coverage still lands in the right return.
    const queue = createPendingQueue<QueuedFuelStop>(memoryStore());
    const pumpedAt = '2026-09-30T23:40:00.000Z';
    await queue.queue(draft({ occurredAt: pumpedAt }), MARIA);
    const sentBodies: Array<Record<string, unknown>> = [];
    await queue.flush({
      owner: MARIA,
      send: async (stop) => {
        sentBodies.push({ occurredAt: stop.occurredAt, sourceEventId: sourceRefFor(stop.clientRef) });
      },
    });
    expect(sentBodies).toEqual([
      { occurredAt: pumpedAt, sourceEventId: 'cab:ref-0001' },
    ]);
  });

  it('retries under the same name, so a lost response cannot buy the same fuel twice', async () => {
    const queue = createPendingQueue<QueuedFuelStop>(memoryStore());
    await queue.queue(draft(), MARIA);
    // The first attempt reaches the server, the row is written, and the answer
    // never gets back to the truck.
    const attempted: string[] = [];
    await queue.flush({
      owner: MARIA,
      send: async (stop) => {
        attempted.push(sourceRefFor(stop.clientRef));
        throw new TypeError('Failed to fetch');
      },
    });
    const [waiting] = await queue.waiting(MARIA);
    expect(waiting?.clientRef).toBe('ref-0001');
    await queue.flush({
      owner: MARIA,
      force: true,
      send: async (stop) => {
        attempted.push(sourceRefFor(stop.clientRef));
      },
    });
    // Same name both times: the API's unique (tenantId, sourceEventId) is what
    // turns the second one into a no-op instead of a second purchase.
    expect(attempted).toEqual(['cab:ref-0001', 'cab:ref-0001']);
    expect(await queue.waiting(MARIA)).toEqual([]);
  });

  it('gives two fill-ups at the same stop two names, so neither is swallowed', async () => {
    // The mirror of the last one: a driver who fills up twice in a day must not
    // have the second credited to the first. The names differ because each form
    // makes its own as it opens.
    const queue = createPendingQueue<QueuedFuelStop>(memoryStore());
    await queue.queue(draft({ clientRef: newFuelRef(), amountTransaction: 100 }), MARIA);
    await queue.queue(draft({ clientRef: newFuelRef(), amountTransaction: 220 }), MARIA);
    const names: string[] = [];
    await queue.flush({
      owner: MARIA,
      send: async (stop) => {
        names.push(sourceRefFor(stop.clientRef));
      },
    });
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });

  it('forgets what was waiting when the phone changes hands', async () => {
    const queue = createPendingQueue<QueuedFuelStop>(memoryStore());
    await queue.queue(draft(), MARIA);
    await queue.purge();
    expect(await queue.waiting(MARIA)).toEqual([]);
  });
});
