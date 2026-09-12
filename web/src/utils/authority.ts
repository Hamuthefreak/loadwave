/**
 * The authority badge shown on a load or truck card.
 *
 * Driven strictly by the FMCSA check, never by the presence of an MC number.
 * These two used to be derived separately — the badge said "Verified" whenever a
 * number was typed in, while the trust chips beside it said "Self-declared" —
 * so the badge and the chips could contradict each other on the same card.
 * Keeping it here, pure, means a regression is caught by a test rather than by
 * a carrier reading two different claims at once.
 */

export type VerificationState = 'VERIFIED' | 'DECLARED' | 'NONE' | 'FAILED';

export interface AuthorityBadgeInput {
  verification?: VerificationState | null;
  mcNumber?: string | null;
  usdotNumber?: string | null;
}

export interface AuthorityBadge {
  tone: 'green' | 'red' | 'gray';
  text: string;
}

export function authorityBadge(input: AuthorityBadgeInput): AuthorityBadge | null {
  const numbers = [input.mcNumber, input.usdotNumber].filter(Boolean).join(' · ');

  if (input.verification === 'VERIFIED') {
    return { tone: 'green', text: `FMCSA checked${numbers ? ` · ${numbers}` : ''}` };
  }
  if (input.verification === 'FAILED') {
    return { tone: 'red', text: 'Authority not active' };
  }
  // Includes DECLARED and NONE: a number on file is not a check.
  if (input.mcNumber || input.usdotNumber) {
    return { tone: 'gray', text: `Self-declared${numbers ? ` · ${numbers}` : ''}` };
  }
  return null;
}
