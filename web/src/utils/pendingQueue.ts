/**
 * Writes taken where there is no signal.
 *
 * The first of these was a renewal photographed at a fuel stop; the same shape
 * turns up everywhere a driver works — a fill-up logged at a pump with one bar
 * of signal, and whatever comes next. What they share is the hard part: keeping
 * the write on the device, sending it later, deciding whether a failure was the
 * network or the office, and never sending the same thing twice. That lives
 * here, once.
 *
 * What does *not* live here is any policy about the payload: what "already on
 * file" means for a document, what a fill-up looks like, and what a driver
 * should be told about either of them. Callers own that, which is why the
 * queue takes its store, its send and its skip rule as arguments.
 *
 * This module imports nothing, and should keep it that way: the tests that pin
 * it run in the API's program, which has no DOM and resolves modules the way
 * Node does, so a single relative import here makes them unrunnable.
 */

/**
 * How long to wait before trying the same write again, by attempt count. A
 * refused write (a bad payload, a session that has gone) is retried rarely: the
 * driver has been told, and retrying it every time the phone finds wifi is how
 * a queue turns into noise in the logs.
 */
const RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000];

/** The bookkeeping every queued write carries, whatever its payload is. */
export interface QueueEnvelope {
  id: string;
  /** The account this belongs to, so nobody else's flush can send it. */
  userId: string;
  tenantId: string | null;
  queuedAt: number;
  attempts: number;
  /** When the last attempt happened, so the backoff is measured from it. */
  lastAttemptAt: number | null;
  /** The last thing that went wrong, in words a driver could be shown. */
  lastError: string | null;
  /** True when the office's own API refused it — only the driver can fix that. */
  blocked: boolean;
}

export interface QueueOwner {
  userId: string;
  tenantId: string | null;
}

/**
 * A queued write: the caller's payload plus the bookkeeping above. Declared as
 * a generic rather than an interface so the payload keeps its own type all the
 * way to the screen — a queued renewal still has a `photo`, a queued fill-up
 * still has a `volume`.
 */
export type Queued<TDraft> = TDraft & QueueEnvelope;

/** Where queued writes wait on this device. Throwing is allowed, and handled. */
export interface PendingStore<TItem> {
  all(): Promise<TItem[]>;
  put(item: TItem): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface FlushOutcome<TItem> {
  sent: TItem[];
  /** Still on the device: the network is not back, or the office refused it. */
  remaining: TItem[];
  /** Dropped unsent because the server already has it. */
  skipped: TItem[];
  /** True when there was no signed-in user to send as. */
  signedOut: boolean;
}

export interface FlushOptions<TItem> {
  owner: QueueOwner | null;
  send: (item: TItem) => Promise<void>;
  /** True when sending this would add nothing the server does not already have. */
  skip?: (item: TItem) => Promise<boolean>;
  /** Send one item now, ignoring both the backoff and any other item waiting. */
  onlyId?: string;
  /** Ignore the backoff — used by the user's own "Send now". */
  force?: boolean;
}

export interface PendingQueue<TItem extends QueueEnvelope> {
  /** Keep a write on this device, or null when the device will not store it. */
  queue(draft: Omit<TItem, keyof QueueEnvelope>, owner: QueueOwner): Promise<TItem | null>;
  /** Everything waiting for this account, oldest first. */
  waiting(owner: QueueOwner | null): Promise<TItem[]>;
  discard(id: string): Promise<void>;
  purge(): Promise<void>;
  flush(options: FlushOptions<TItem>): Promise<FlushOutcome<TItem>>;
}

/**
 * Whether a failure is worth trying again.
 *
 * `retry` covers the network being absent and the session needing a refresh:
 * both are temporary, and giving up over either loses the very thing the driver
 * went to the trouble of recording. `refused` is the server having read the
 * request and said no — that needs the driver, not another attempt.
 */
export function failureAction(error: unknown): 'retry' | 'refused' {
  // Read the status off the error rather than naming the client's `ApiError`
  // class: what makes a failure an answer from the office is that it carries an
  // HTTP status, and this keeps the module import-free (see the note above).
  const status = (error as { status?: unknown } | null)?.status;
  // A fetch that never reached the server throws a TypeError, and an aborted
  // request throws a DOMException. Neither carries a status.
  if (typeof status !== 'number') return 'retry';
  if (status === 401 || status === 408 || status === 429) return 'retry';
  if (status >= 500) return 'retry';
  return 'refused';
}

/** True when it is time to try this item again. */
export function retryDue(item: QueueEnvelope, now: number = Date.now()): boolean {
  if (item.attempts === 0) return true;
  const wait = RETRY_BACKOFF_MS[Math.min(item.attempts, RETRY_BACKOFF_MS.length - 1)] as number;
  return now - (item.lastAttemptAt ?? item.queuedAt) >= wait;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // An older webview without randomUUID still gets a queue, and nothing here
    // depends on the id being unguessable.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'That could not be sent.';
}

/**
 * A queue of one kind of write, over one storage implementation. The app
 * creates one per kind (see renewalSend.ts and fuelSend.ts); tests create one
 * each so they cannot see each other's work.
 */
export function createPendingQueue<TItem extends QueueEnvelope>(
  store: PendingStore<TItem>,
): PendingQueue<TItem> {
  /** One run at a time, so two triggers cannot send the same write twice. */
  let flushing: Promise<FlushOutcome<TItem>> | null = null;

  async function waiting(owner: QueueOwner | null): Promise<TItem[]> {
    if (!owner) return [];
    try {
      const all = await store.all();
      return all
        .filter((item) => item.userId === owner.userId)
        .sort((a, b) => a.queuedAt - b.queuedAt);
    } catch {
      // A device with no usable store has nothing waiting, and saying so is
      // better than failing the page it is rendered on.
      return [];
    }
  }

  async function runFlush(options: FlushOptions<TItem>): Promise<FlushOutcome<TItem>> {
    const { owner, send, skip } = options;
    const outcome: FlushOutcome<TItem> = { sent: [], remaining: [], skipped: [], signedOut: owner === null };
    if (!owner) return outcome;

    const items = (await waiting(owner)).filter((item) => !options.onlyId || item.id === options.onlyId);
    for (const item of items) {
      if (!options.force && !retryDue(item)) {
        outcome.remaining.push(item);
        continue;
      }
      if (skip && (await skip(item))) {
        await store.delete(item.id);
        outcome.skipped.push(item);
        continue;
      }
      try {
        await send(item);
        await store.delete(item.id);
        outcome.sent.push(item);
      } catch (error) {
        const next = {
          ...item,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError: messageOf(error),
          blocked: failureAction(error) === 'refused',
        } as TItem;
        // Written back before anything else: a crash between here and the next
        // trigger must not leave this looking like a write that never tried.
        try {
          await store.put(next);
        } catch {
          // The item stays as it was; the next flush tries again.
        }
        outcome.remaining.push(next);
      }
    }
    return outcome;
  }

  return {
    async queue(draft, owner) {
      const item = {
        ...draft,
        id: newId(),
        userId: owner.userId,
        tenantId: owner.tenantId,
        queuedAt: Date.now(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        blocked: false,
      } as TItem;
      try {
        await store.put(item);
        return item;
      } catch {
        return null;
      }
    },

    waiting,

    async discard(id) {
      try {
        await store.delete(id);
      } catch {
        // Nothing useful to say: the item either went or the device has no store.
      }
    },

    async purge() {
      try {
        await store.clear();
      } catch {
        // Best effort, the same as the offline cache purge it sits beside.
      }
    },

    flush(options) {
      if (flushing) return flushing;
      flushing = runFlush(options).finally(() => {
        flushing = null;
      });
      return flushing;
    },
  };
}
