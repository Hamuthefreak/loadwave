/**
 * FMCSA lookup client.
 *
 * Kept deliberately small and dependency-free: one GET, a hard timeout, and
 * every failure classified rather than thrown. A verification service that
 * breaks the page it is decorating is worse than no verification, so nothing
 * here ever rejects — callers get a discriminated result and decide.
 *
 * The API key is free from FMCSA. Without it, verification is DISABLED and the
 * UI must label numbers as self-declared, which is why the disabled case is a
 * first-class result instead of an error.
 */

import { mapCarrier, normalizeDot, type FmcsaLookupResult } from './fmcsa.policy';

export const FMCSA_DEFAULT_BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services';
const DEFAULT_TIMEOUT_MS = 6000;

export interface FmcsaClientOptions {
  webKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FmcsaClient {
  readonly enabled: boolean;
  lookupByDot(dotNumber: string): Promise<FmcsaLookupResult>;
}

export function createFmcsaClient(options: FmcsaClientOptions): FmcsaClient {
  const webKey = (options.webKey ?? '').trim();
  const enabled = webKey.length > 0;
  const baseUrl = (options.baseUrl ?? FMCSA_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  return {
    enabled,

    async lookupByDot(dotNumber: string): Promise<FmcsaLookupResult> {
      if (!enabled) return { ok: false, reason: 'DISABLED' };

      const dot = normalizeDot(dotNumber);
      if (!dot) return { ok: false, reason: 'NOT_FOUND', detail: 'invalid USDOT number' };
      if (typeof doFetch !== 'function') {
        return { ok: false, reason: 'UPSTREAM_ERROR', detail: 'no fetch implementation available' };
      }

      const url = `${baseUrl}/carriers/${encodeURIComponent(dot)}?webKey=${encodeURIComponent(webKey)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await doFetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });

        // A 404 is a legitimate "no such carrier" answer, not a failure.
        if (res.status === 404) return { ok: false, reason: 'NOT_FOUND' };
        if (!res.ok) {
          return { ok: false, reason: 'UPSTREAM_ERROR', detail: `FMCSA responded ${res.status}` };
        }

        const payload: unknown = await res.json();
        const carrier = mapCarrier(payload);
        if (!carrier) return { ok: false, reason: 'NOT_FOUND' };
        return { ok: true, carrier };
      } catch (error) {
        const detail =
          error instanceof Error && error.name === 'AbortError'
            ? 'FMCSA lookup timed out'
            : error instanceof Error
              ? error.message
              : 'FMCSA lookup failed';
        return { ok: false, reason: 'UPSTREAM_ERROR', detail };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
