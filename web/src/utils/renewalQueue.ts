/**
 * Renewals taken where there is no signal.
 *
 * A driver who has just picked up a new medical card is standing next to the
 * truck at a fuel stop, and that is exactly where the signal is worst. Waiting
 * until they are somewhere better is how the office ends up chasing a document
 * that was photographed a week ago, so a renewal that cannot be sent is kept on
 * the phone — photo and all — and sent by itself later.
 *
 * Two things make queueing a renewal safe where queueing an arbitrary write
 * would not be. The upload endpoint is an upsert keyed on (tenant, subject,
 * kind), so a retry after a lost response overwrites the same row instead of
 * filing a second renewal. And an upload is a *request*: it lands pending and
 * keeps blocking dispatch until the office confirms it, so a renewal that goes
 * out late is late, not silently authoritative.
 *
 * The queue belongs to the person who filled it in. Every read is scoped to
 * their account and it is emptied when somebody signs out or signs in — a
 * shared cab tablet must not hand the next driver a photograph of somebody
 * else's licence.
 *
 * This module deliberately knows nothing about the network, the session or the
 * browser: storage arrives as a `RenewalStore` (IndexedDB in the app, see
 * renewalIndexedDb.ts) and sending as a pair of functions (renewalSend.ts).
 * That is what keeps the decisions below — the ones that can lose a document —
 * testable without a browser in the room.
 *
 * It imports nothing at all, and should keep it that way: the tests that pin it
 * run in the API's program, which has no DOM and resolves modules the way Node
 * does, so a single relative import here is enough to make them unrunnable.
 */

/**
 * How long to wait before trying the same upload again, by attempt count. A
 * refused renewal (a bad kind, a session that has gone) is retried rarely: the
 * driver has been told, and retrying it every time the phone finds wifi is how
 * a queue turns into noise in the logs.
 */
const RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000];

export interface RenewalDraft {
  /** Document kind, as the compliance policy names it (`CDL`, `MEDICAL_CARD`). */
  kind: string;
  /** Human name, kept so a queued row can be rendered without the policy. */
  label: string;
  identifier: string | null;
  expiresAt: string | null;
  photo: Blob | null;
  fileName: string | null;
  mimeType: string | null;
}

export interface QueuedRenewal extends RenewalDraft {
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

/** What the office has on file for the kind being sent. */
export interface OnFile {
  expiresAt: string | null;
  hasFile: boolean;
  pendingReview: boolean;
}

/** Where a renewal waits on this device. Throwing is allowed, and handled. */
export interface RenewalStore {
  all(): Promise<QueuedRenewal[]>;
  put(item: QueuedRenewal): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface FlushOutcome {
  sent: QueuedRenewal[];
  /** Still on the phone: the network is not back, or the office refused it. */
  remaining: QueuedRenewal[];
  /** Dropped unsent because the office already has that date, or a later one. */
  skipped: QueuedRenewal[];
  /** True when there was no signed-in driver to send as. */
  signedOut: boolean;
}

export interface FlushOptions {
  owner: QueueOwner | null;
  send: (item: QueuedRenewal) => Promise<void>;
  onFile: (kind: string) => Promise<OnFile | null>;
  /** Send one item now, ignoring both the backoff and any other item waiting. */
  onlyId?: string;
  /** Ignore the backoff — used by the driver's own "Send now". */
  force?: boolean;
}

export interface RenewalQueue {
  /** Keep a renewal on this device, or null when the device will not store it. */
  queue(draft: RenewalDraft, owner: QueueOwner): Promise<QueuedRenewal | null>;
  /** Everything waiting for this account, oldest first. */
  waiting(owner: QueueOwner | null): Promise<QueuedRenewal[]>;
  discard(id: string): Promise<void>;
  purge(): Promise<void>;
  flush(options: FlushOptions): Promise<FlushOutcome>;
}

/**
 * Whether a failure is worth trying again.
 *
 * `retry` covers the network being absent and the session needing a refresh:
 * both are temporary, and dropping a renewal over either would lose the one
 * document the driver actually went to the trouble of photographing. `refused`
 * is the server having read the request and said no — that needs the driver,
 * not another attempt.
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

/** The date part of whatever the API returned, which is a full timestamp. */
function dayOf(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * True when sending this would add nothing the office does not already have.
 *
 * The case this exists for is an upload queued days ago whose document has
 * since been renewed in the yard: sending it would write an *older* expiry back
 * over the good one and put the document back into review. The exception is a
 * photo the office does not have — that is new evidence even when the date on
 * it is not new, so it still goes.
 */
export function supersededBy(item: RenewalDraft, onFile: OnFile | null): boolean {
  if (!onFile) return false;
  if (item.photo && !onFile.hasFile) return false;
  const queued = dayOf(item.expiresAt);
  const filed = dayOf(onFile.expiresAt);
  if (!queued || !filed) return false;
  return filed >= queued;
}

/** True when it is time to try this item again. */
export function retryDue(item: QueuedRenewal, now: number = Date.now()): boolean {
  if (item.attempts === 0) return true;
  const wait = RETRY_BACKOFF_MS[Math.min(item.attempts, RETRY_BACKOFF_MS.length - 1)] as number;
  return now - (item.lastAttemptAt ?? item.queuedAt) >= wait;
}

/** What a driver should be told about a flush, or null when nothing happened. */
export function describeFlush(outcome: FlushOutcome): string | null {
  const count = outcome.sent.length;
  if (count > 0) {
    const sent =
      count === 1 ? 'Your renewal went to the office.' : `${count} renewals went to the office.`;
    const extra = outcome.skipped.length > 0 ? ' One was already on file, so it was left alone.' : '';
    return `${sent} They confirm it before it changes anything.${extra}`;
  }
  if (outcome.skipped.length > 0) {
    return 'The office already had that document on file, so the copy on your phone was not sent.';
  }
  return null;
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
 * A queue over one storage implementation. The app creates exactly one (see
 * renewalSend.ts); tests create one each so they cannot see each other's work.
 */
export function createRenewalQueue(store: RenewalStore): RenewalQueue {
  /** One run at a time, so two triggers cannot send the same renewal twice. */
  let flushing: Promise<FlushOutcome> | null = null;

  async function waiting(owner: QueueOwner | null): Promise<QueuedRenewal[]> {
    if (!owner) return [];
    try {
      const all = await store.all();
      return all.filter((item) => item.userId === owner.userId).sort((a, b) => a.queuedAt - b.queuedAt);
    } catch {
      // A device with no usable store has nothing waiting, and saying so is
      // better than failing the page it is rendered on.
      return [];
    }
  }

  async function runFlush(options: FlushOptions): Promise<FlushOutcome> {
    const { owner, send, onFile: readOnFile } = options;
    const outcome: FlushOutcome = { sent: [], remaining: [], skipped: [], signedOut: owner === null };
    if (!owner) return outcome;

    const filed = new Map<string, OnFile | null>();
    const lookUp = async (kind: string): Promise<OnFile | null> => {
      if (!filed.has(kind)) filed.set(kind, await readOnFile(kind));
      return filed.get(kind) ?? null;
    };

    const items = (await waiting(owner)).filter((item) => !options.onlyId || item.id === options.onlyId);
    for (const item of items) {
      if (!options.force && !retryDue(item)) {
        outcome.remaining.push(item);
        continue;
      }
      const onFile = await lookUp(item.kind);
      if (supersededBy(item, onFile)) {
        await store.delete(item.id);
        outcome.skipped.push(item);
        continue;
      }
      try {
        await send(item);
        await store.delete(item.id);
        outcome.sent.push(item);
      } catch (error) {
        const next: QueuedRenewal = {
          ...item,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError: messageOf(error),
          blocked: failureAction(error) === 'refused',
        };
        // Written back before anything else: a crash between here and the next
        // trigger must not leave this looking like a renewal that never tried.
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
      const item: QueuedRenewal = {
        ...draft,
        id: newId(),
        userId: owner.userId,
        tenantId: owner.tenantId,
        queuedAt: Date.now(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        blocked: false,
      };
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
