/**
 * The renewal-specific half of the offline queue.
 *
 * The machinery — keeping a write on the device, sending it later, telling a
 * dropped connection apart from a refusal — lives in pendingQueue.ts. What is
 * left here is the one rule that only applies to qualification documents: a
 * renewal that the office has since matched or beaten must not be sent, because
 * writing an older expiry back over a good one would put the document into
 * review again.
 *
 * Like the queue core, this imports nothing (see the note there — the tests run
 * in the API's program, which has no DOM), which is why the item type it works
 * on is named by the wiring layer instead of here.
 */

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

/** What the office has on file for the kind being sent. */
export interface OnFile {
  expiresAt: string | null;
  hasFile: boolean;
  pendingReview: boolean;
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
 * The exception is a photo the office does not have — that is new evidence even
 * when the date on it is not new, so it still goes.
 */
export function supersededBy(item: RenewalDraft, onFile: OnFile | null): boolean {
  if (!onFile) return false;
  if (item.photo && !onFile.hasFile) return false;
  const queued = dayOf(item.expiresAt);
  const filed = dayOf(onFile.expiresAt);
  if (!queued || !filed) return false;
  return filed >= queued;
}

/**
 * The skip rule for a flush, with one lookup per document kind rather than one
 * per renewal: a driver catching up on three documents in one go should cost
 * one read of their file, not three.
 */
export function kindSkipHook(
  read: (kind: string) => Promise<OnFile | null>,
): (item: RenewalDraft) => Promise<boolean> {
  const filed = new Map<string, OnFile | null>();
  return async (item) => {
    if (!filed.has(item.kind)) filed.set(item.kind, await read(item.kind));
    return supersededBy(item, filed.get(item.kind) ?? null);
  };
}

/** What a driver should be told about a flush, or null when nothing happened. */
export function describeFlush(outcome: {
  sent: unknown[];
  skipped: unknown[];
}): string | null {
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
