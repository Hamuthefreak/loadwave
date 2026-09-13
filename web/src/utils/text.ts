/**
 * The server's rule for "is this free text actually usable", mirrored.
 *
 * Both sides measure the same way — collapse runs of whitespace, then trim,
 * then count — so a button the UI enables cannot come back as a rejection. Text
 * pasted from a notes app arrives full of newlines, and "ok" followed by forty
 * spaces is still not a reason. See src/modules/settlements/dispute.policy.ts
 * (normalizeText) and src/modules/compliance/compliance.policy.ts
 * (overrideReasonIssue) for the server half of each pair.
 */
export function substantiveLength(raw: string): number {
  return raw.replace(/\s+/g, ' ').trim().length;
}

/** True when the text is still too thin to act on. */
export function tooShort(raw: string, min: number): boolean {
  return substantiveLength(raw) < min;
}

/** How much more is needed, for a hint that counts down instead of refusing. */
export function shortBy(raw: string, min: number): number {
  return Math.max(0, min - substantiveLength(raw));
}
