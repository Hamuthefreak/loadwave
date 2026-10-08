import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The tracking link's authorisation, derived rather than stored.
 *
 * A token column on `Load` would mean a migration, a backfill, and a second
 * source of truth about who may see a load. Deriving it from the load id and a
 * server secret gives the same property — nobody can open a load they were not
 * sent — with nothing to keep in sync and nothing to leak in a database dump
 * that does not already leak the secret.
 *
 * The trade is honest: rotating the access secret invalidates outstanding links.
 * That is acceptable for a link a broker opens within a day or two, and it is
 * the reason the token is namespaced rather than being a raw HMAC of the id.
 */

const NAMESPACE = 'loadwave:tracking:';

/** 32 base64url characters (160 bits) — long enough not to be guessable in a URL. */
const TOKEN_LENGTH = 32;

export function trackingToken(loadId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${NAMESPACE}${loadId}`).digest('base64url').slice(0, TOKEN_LENGTH);
}

/**
 * Constant-time comparison, and a false answer for every degenerate case: no
 * token, no secret, or a token of the wrong length. An instance with no secret
 * configured serves no tracking links at all rather than open ones.
 */
export function verifyTrackingToken(loadId: string, token: string | undefined, secret: string): boolean {
  if (!loadId || !token || !secret) return false;
  const expected = trackingToken(loadId, secret);
  if (token.length !== expected.length) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The link a dispatcher copies. Unauthenticated on purpose — that is the point. */
export function trackingLink(appUrl: string, loadId: string, secret: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/track/${encodeURIComponent(loadId)}/${trackingToken(loadId, secret)}`;
}
