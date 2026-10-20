import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * IP → country, for the availability check.
 *
 * The lookup runs on the server rather than in the browser for two reasons:
 * the visitor's address is already visible there, and enforcing the check on
 * registration should not depend on JavaScript an interested person can turn
 * off. Results are cached in memory, so a visitor costs one request a day at
 * most and the provider's free tier is not spent per page view.
 *
 * `ipwho.is` needs no key for country-level lookups. Like any external
 * dependency it can fail; a failure returns null and the caller fails open.
 */

const DEFAULT_URL = 'https://ipwho.is/{ip}?fields=success,country_code';
const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5_000;

interface CacheEntry {
  country: string | null;
  expiresAt: number;
}

export interface GeoIpLookupOptions {
  /** `{ip}` is replaced with the visitor's address. Empty disables lookups. */
  url?: string;
  fetcher?: typeof fetch;
  ttlMs?: number;
  failureTtlMs?: number;
  timeoutMs?: number;
}

/** Loopback, link-local and RFC 1918 addresses never belong to a country. */
export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  if (ip === '::1') return false;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  if (lower.startsWith('::ffff:')) {
    return isPublicIp(lower.slice('::ffff:'.length));
  }
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

/**
 * The address nginx saw. `X-Real-IP` is overwritten by the proxy on every
 * request (see deploy/nginx-loadboard.conf), so it is the client's address
 * rather than one the browser chose; a direct request to the API falls back to
 * the socket address.
 */
export function clientIp(request: Pick<FastifyRequest, 'headers' | 'ip'>): string | null {
  const header = request.headers['x-real-ip'];
  const value = (Array.isArray(header) ? header[0] : header) ?? request.ip ?? '';
  const ip = value.trim();
  return isPublicIp(ip) ? ip : null;
}

export class GeoIpLookup {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly timeoutMs: number;

  constructor(options: GeoIpLookupOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.fetcher = options.fetcher ?? fetch;
    this.ttlMs = options.ttlMs ?? DAY_MS;
    this.failureTtlMs = options.failureTtlMs ?? FAILURE_MS;
    this.timeoutMs = options.timeoutMs ?? 2_500;
  }

  async countryFor(ip: string | null | undefined): Promise<string | null> {
    if (!ip || !this.url || !isPublicIp(ip)) return null;

    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.country;

    let country: string | null = null;
    try {
      const response = await this.fetcher(this.url.replace('{ip}', encodeURIComponent(ip)), {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        const body = (await response.json()) as { success?: unknown; country_code?: unknown };
        if (
          body.success !== false &&
          typeof body.country_code === 'string' &&
          /^[A-Za-z]{2}$/.test(body.country_code)
        ) {
          country = body.country_code.toUpperCase();
        }
      }
    } catch {
      country = null;
    }

    this.remember(ip, country);
    return country;
  }

  private remember(ip: string, country: string | null): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(ip, {
      country,
      expiresAt: Date.now() + (country ? this.ttlMs : this.failureTtlMs),
    });
  }
}
