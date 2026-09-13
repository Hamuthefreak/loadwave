import { normalizeText, DISPUTE_MESSAGE_MIN } from '../../src/modules/settlements/dispute.policy';
import { overrideReasonIssue, MIN_OVERRIDE_REASON } from '../../src/modules/compliance/compliance.policy';
import {
  shortBy,
  substantiveLength,
  tooShort,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/text';

/**
 * The client and the server both decide whether a piece of free text is worth
 * acting on, and they must reach the same verdict. They did not: the UI measured
 * `trim().length` while the server collapsed internal whitespace first, so a
 * reason padded with spaces enabled a button that the API then refused — a
 * failure with no visible cause, on a control the dispatcher had just tapped.
 *
 * Each case here is a string both sides are given, and the two answers have to
 * match. The parity is asserted by outcome (is this text acceptable?) rather
 * than by re-implementing either rule, so refactoring either side is fine as
 * long as the decisions still line up.
 */
const CASES = [
  '',
  '   ',
  'ok',
  'no good',
  'a b c d e f',
  'a  b  c  d  e  f',
  'needs        ok',
  'sat          3          hrs',
  '\n\nsat at the dock\nuntil eleven\n\n',
  'MVR renewal emailed this morning, hard copy is in the cab',
];

/**
 * Over-long text is a separate question: the server refuses it for its length
 * from above, which is why these are kept out of the minimum-length parity above
 * and asserted on their own at the end.
 */
const OVERLONG = 'x'.repeat(1500);

describe('client and server agree on what counts as usable text', () => {
  it('shortens text the same way before measuring it', () => {
    // The shared normalisation: runs of whitespace collapse, then trim. A
    // countdown hint built on a different number would send the button live
    // while the server was still refusing.
    for (const raw of CASES) {
      expect(substantiveLength(raw)).toBe(raw.replace(/\s+/g, ' ').trim().length);
    }
    expect(substantiveLength('needs        ok')).toBe(8);
    expect(substantiveLength('\n\nsat at the dock\n')).toBe('sat at the dock'.length);
  });

  it('counts down to the floor the server actually enforces', () => {
    // shortBy must reach exactly zero at the moment the server stops refusing,
    // which is the property the two gates are built on.
    for (const raw of CASES) {
      const remaining = shortBy(raw, MIN_OVERRIDE_REASON);
      const serverRejects = overrideReasonIssue(raw) !== null;
      expect(tooShort(raw, MIN_OVERRIDE_REASON)).toBe(serverRejects);
      expect(remaining === 0).toBe(!serverRejects);
    }
  });

  it('matches the pay-query floor as well', () => {
    // The driver-facing query uses the same rule against its own minimum, so the
    // parity is asserted a second time rather than assumed to be shared.
    for (const raw of CASES) {
      const serverAccepts = normalizeText(raw, {
        min: DISPUTE_MESSAGE_MIN,
        max: 1000,
        field: 'A note to dispatch',
      }).ok;
      expect(tooShort(raw, DISPUTE_MESSAGE_MIN)).toBe(!serverAccepts);
    }
  });

  it('rejects a long string only because of the maximum, not the minimum', () => {
    // Both sides bound length from above too; the client buttons do not enforce
    // it (the fields carry maxLength), so this pins that it is the *server*
    // rejecting an over-long value rather than a disagreement about the floor.
    expect(tooShort(OVERLONG, MIN_OVERRIDE_REASON)).toBe(false);
    expect(overrideReasonIssue(OVERLONG)).toMatch(/too long/i);
    expect(
      normalizeText(OVERLONG, { min: DISPUTE_MESSAGE_MIN, max: 1000, field: 'A note to dispatch' }).ok,
    ).toBe(false);
  });
});
