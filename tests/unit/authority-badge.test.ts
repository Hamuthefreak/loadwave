/**
 * The authority badge.
 *
 * These tests exist because the badge and the trust chips on the same card used
 * to disagree: the badge read "Verified" for anyone who had typed an MC number
 * in, while the chips beside it read "Self-declared authority". The rule that
 * prevents a repeat: only an FMCSA check earns a checked badge.
 */
// The root tsc program (Node16 resolution) flags this CJS→ESM import as TS1479.
// ts-jest compiles it fine, so that diagnostic is ignored in jest.config.json —
// while `npm run typecheck` still enforces the directive is genuinely needed.
// Same pattern as tests/unit/fuel-prefill.test.ts.
// @ts-expect-error — cross-package ESM import from the web workspace
import { authorityBadge } from '../../web/src/utils/authority';

describe('authorityBadge', () => {
  it('badges only a completed FMCSA check', () => {
    expect(authorityBadge({ verification: 'VERIFIED', mcNumber: 'MC188421' })).toEqual({
      tone: 'green',
      text: 'FMCSA checked · MC188421',
    });
  });

  it('lists both numbers when the carrier has them', () => {
    expect(
      authorityBadge({ verification: 'VERIFIED', mcNumber: 'MC188421', usdotNumber: 'USDOT188421' })?.text,
    ).toBe('FMCSA checked · MC188421 · USDOT188421');
  });

  it('never calls a number on file "verified"', () => {
    // The exact regression: an MC number with no check behind it.
    expect(authorityBadge({ verification: 'DECLARED', mcNumber: 'MC4397189' })).toEqual({
      tone: 'gray',
      text: 'Self-declared · MC4397189',
    });
    // And the same when the state is missing entirely.
    expect(authorityBadge({ mcNumber: 'MC4397189' })?.text).toBe('Self-declared · MC4397189');
    expect(authorityBadge({ mcNumber: 'MC4397189' })?.tone).toBe('gray');
  });

  it('flags a carrier FMCSA does not clear', () => {
    expect(authorityBadge({ verification: 'FAILED', mcNumber: 'MC1' })).toEqual({
      tone: 'red',
      text: 'Authority not active',
    });
  });

  it('shows nothing at all for a carrier with no numbers', () => {
    expect(authorityBadge({})).toBeNull();
    expect(authorityBadge({ verification: 'NONE' })).toBeNull();
    expect(authorityBadge({ mcNumber: null, usdotNumber: '' })).toBeNull();
  });
});
