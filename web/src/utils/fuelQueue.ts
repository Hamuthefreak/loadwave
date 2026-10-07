/**
 * The fill-up half of the offline queue.
 *
 * A driver fills up at a card lock or a truck stop and taps in the litres and
 * the total; that is precisely where the signal dies, and until now the log had
 * two outcomes — it went, or it was retyped later from a paper receipt, which
 * in practice means it was never retyped at all. IFTA is computed from these
 * rows, so a fill-up that quietly did not happen is a quarterly return that is
 * short of a jurisdiction's fuel.
 *
 * Two differences from a document renewal are worth stating, because they are
 * why this is not simply "the renewal queue with another payload":
 *
 * - A fill-up has an exact time, and it has to be the time it was pumped, not
 *   the time the phone found signal. The draft therefore carries `occurredAt`
 *   from the moment the driver logged it, and it is always sent explicitly —
 *   the engine that computes a quarter credits fuel to the quarter it was
 *   bought in.
 * - The endpoint is not an upsert, so a retry could count the same litres
 *   twice. Every fill-up carries a `clientRef` the phone made, which the API
 *   stores as the row's `sourceEventId`: unique per tenant, so a second attempt
 *   after a response that never arrived is recognised as the same fill-up
 *   rather than filed as a second one.
 *
 * Like the queue core, this imports nothing (see the note in pendingQueue.ts).
 */

export interface FuelStopDraft {
  /**
   * The name this fill-up was given on the phone. It travels as the row's
   * `sourceEventId`, which is what makes a retry a no-op instead of a second
   * purchase of the same 250 litres.
   */
  clientRef: string;
  jurisdictionCode: string;
  /** Litres or US gallons, as the driver read them off the pump. */
  volume: number;
  unit: 'L' | 'GAL';
  amountTransaction: number;
  transactionCurrency: 'CAD' | 'USD';
  /** When the fuel was actually pumped, ISO — not when it was finally sent. */
  occurredAt: string;
}

/** The reference the API stores, so a retried fill-up is recognisably the same. */
export function sourceRefFor(ref: string): string {
  return `cab:${ref}`;
}

/**
 * A name for one fill-up, made on the phone as the form opens.
 *
 * It is made before the send rather than at it, because the case it exists for
 * is the send that the server performs and the driver never hears about: a
 * request that times out after the row was written. That fill-up is then queued
 * and retried with the same name, and the API hands back the row it already
 * has instead of adding the litres to the quarter a second time.
 */
export function newFuelRef(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // An older webview with no `randomUUID` (or a page that is not a secure
    // context) still gets a name, and nothing here needs it to be unguessable.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * What a driver should be told about a flush, or null when nothing happened.
 *
 * Fuel is not paperwork: the useful thing to say is that it is *in* — the
 * quarter it belongs to has it, and it counts towards the fleet average.
 */
export function describeFuelFlush(outcome: { sent: unknown[] }): string | null {
  const count = outcome.sent.length;
  if (count === 0) return null;
  return count === 1
    ? 'Your fill-up went in — it counts in the quarter you bought it in.'
    : `${count} fill-ups went in — they count in the quarters you bought them in.`;
}
