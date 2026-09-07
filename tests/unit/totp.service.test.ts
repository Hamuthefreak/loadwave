import {
  base32Decode,
  buildOtpauthUrl,
  generateCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  randomBase32Secret,
  verifyCode,
} from '../../src/modules/auth/totp.service';

// RFC 6238 appendix B test vectors (SHA-1). The secret is the ASCII string
// "12345678901234567890"; authenticator apps receive it base32-encoded.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32 of the ASCII secret

const VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp.service', () => {
  it('matches the RFC 6238 SHA-1 vectors at exact time steps', () => {
    for (const [t, expected] of VECTORS) {
      expect(generateCode(RFC_SECRET, t * 1000)).toBe(expected);
    }
  });

  it('verifies codes within a ±1 step window and rejects stale codes', () => {
    const now = Date.now();
    const current = generateCode(RFC_SECRET, now);
    expect(verifyCode(RFC_SECRET, current, now)).toBe(true);
    // A code from one window ago is still accepted; garbage and wrong-length are not.
    expect(verifyCode(RFC_SECRET, generateCode(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyCode(RFC_SECRET, generateCode(RFC_SECRET, now - 120_000), now)).toBe(false);
    expect(verifyCode(RFC_SECRET, '000000', now)).toBe(false);
    expect(verifyCode(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyCode(RFC_SECRET, '', now)).toBe(false);
  });

  it('generates secrets authenticator apps can read (valid base32, right length)', () => {
    const secret = randomBase32Secret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes → 32 base32 chars
    expect(base32Decode(secret)).toHaveLength(20);
    // A freshly generated secret round-trips through generate/verify.
    expect(verifyCode(secret, generateCode(secret))).toBe(true);
  });

  it('builds a scannable otpauth URL carrying secret, issuer and account', () => {
    const url = buildOtpauthUrl('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'ops@carrier.ca');
    expect(url).toMatch(/^otpauth:\/\/totp\/Loadwave:ops%40carrier\.ca\?/);
    expect(url).toContain('secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    expect(url).toContain('issuer=Loadwave');
    expect(url).toContain('algorithm=SHA1&digits=6&period=30');
  });

  it('generates distinct recovery codes and normalizes entry formatting', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{8}$/);
    expect(normalizeRecoveryCode('  abc-def  ')).toBe('ABCDEF');
    expect(normalizeRecoveryCode('xyz')).toBe('XYZ');
  });
});