import crypto from 'node:crypto';

// Minimal RFC 6238 TOTP implementation (SHA-1, 30-second step, 6 digits) —
// compatible with Google Authenticator, Authy, 1Password, etc. Kept
// dependency-free on purpose: the primitive is a dozen lines of HMAC math.

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept ±1 step for clock drift

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s-=]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of cleaned) {
    const value = B32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`invalid base32 character: ${char}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 6-digit code for the given secret at the given Unix time (ms). */
export function generateCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function verifyCode(secret: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const expected = generateCode(secret, atMs + offset * STEP_SECONDS * 1000);
    if (timingSafeEqualStrings(expected, code)) return true;
  }
  return false;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** otpauth:// URI an authenticator app can scan (QR) or import by hand. */
export function buildOtpauthUrl(secret: string, accountLabel: string, issuer = 'Loadwave'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?${params.toString()}`;
}

/** One-time backup codes (8 × 8 chars, base32 alphabet). Shown exactly once. */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(randomBase32Secret(5));
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}