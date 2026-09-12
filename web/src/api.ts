// Tiny API client for the LoadWave backend.
//
// Requests are made with a RELATIVE path (e.g. "/auth/login"). In development
// Vite proxies those calls to http://localhost:4000 (see vite.config.ts).

import { purgeOfflineCache } from './offline-cache';
import { clearPlanCache } from './utils/planCache';

export { purgeOfflineCache };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'loadwave.accessToken';
const REFRESH_KEY = 'loadwave.refreshToken';
const REMEMBER_KEY = 'loadwave.remember';

// "Remember me" sessions persist in localStorage (survive browser restarts);
// everything else lives in sessionStorage and dies with the tab. The flag
// lives in localStorage so refreshes keep the right policy.
export function getRememberMe(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === '1';
}

function pickStorage(): Storage {
  return getRememberMe() ? localStorage : sessionStorage;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken?: string, remember = true): void {
  // Move any existing tokens to the chosen storage so only one copy exists.
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(REFRESH_KEY);
  }
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  pickStorage().setItem(TOKEN_KEY, accessToken);
  if (refreshToken) pickStorage().setItem(REFRESH_KEY, refreshToken);
}

export function setToken(token: string | null): void {
  if (token) pickStorage().setItem(TOKEN_KEY, token);
  else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  // Entitlements must not outlive the session that earned them.
  clearPlanCache();
}

/**
 * Signs out everywhere: best-effort revocation of the refresh token on the
 * server (so the session cannot be replayed), then clears local storage and
 * the cached authenticated responses.
 */
export async function signOut(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await api<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        noAuthRefresh: true,
      });
    } catch {
      // Local sign-out must never be blocked by a failed network call.
    }
  }
  clearTokens();
  await purgeOfflineCache();
}

export interface TokenUser {
  sub: string;
  tenantId: string;
  roles: string[];
  driverId: string | null;
}

// The access token is a signed JWT whose payload carries the session's roles
// and driver link (see src/modules/auth). Decoding it locally lets the UI gate
// nav and pages without an extra round trip. Returns null when there is no
// token or the payload can't be decoded.
export function getTokenUser(): TokenUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const data = JSON.parse(json) as {
      sub?: string;
      tenantId?: string;
      roles?: unknown;
      driverId?: string | null;
    };
    return {
      sub: String(data.sub ?? ''),
      tenantId: String(data.tenantId ?? ''),
      roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
      driverId: data.driverId != null ? String(data.driverId) : null,
    };
  } catch {
    return null;
  }
}

// True for users who run the office side of the TMS (posting, fuel, IFTA,
// fleet and driver management). Pure DRIVER accounts get a read-only,
// driver-facing experience instead.
export function canManageRoles(roles: string[] | null | undefined): boolean {
  if (!roles || roles.length === 0) return true; // unknown token → don't lock anything out
  return roles.includes('ADMIN') || roles.includes('DISPATCHER');
}

export function roleLabels(roles: string[] | null | undefined): string[] {
  const LABELS: Record<string, string> = { ADMIN: 'Admin', DISPATCHER: 'Dispatcher', DRIVER: 'Driver' };
  return (roles ?? []).map((r) => LABELS[r] ?? r);
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Internal: skip the 401 → refresh retry (refresh/logout calls only). */
  noAuthRefresh?: boolean;
}

// One in-flight refresh at a time; concurrent 401s all await the same promise.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) return false;
      const tokens = (data as { tokens?: { accessToken?: string; refreshToken?: string } } | null)?.tokens;
      if (!tokens?.accessToken) return false;
      setTokens(tokens.accessToken, tokens.refreshToken, getRememberMe());
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const doFetch = async (): Promise<Response> =>
    fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await doFetch();

  // Access token expired: try the refresh token once, then replay the request.
  // Any real auth failure (bad credentials, revoked session) skips this.
  if (res.status === 401 && !options.noAuthRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const fresh = getToken();
      if (fresh) headers['Authorization'] = `Bearer ${fresh}`;
      res = await doFetch();
    }
    if (!refreshed) {
      clearTokens();
      void purgeOfflineCache();
    }
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ?? fallbackMessage(res.status);
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

// Friendly defaults for the rare case the server sends no error text at all —
// every page surfaces these, so keep them human, not "Request failed (401)".
function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired — please sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'That wasn’t found — it may have been removed.';
  if (status === 409) return 'That already exists — check for duplicates and try again.';
  if (status === 402) return 'That tool is not included in your current plan — upgrade to unlock it.';
  if (status === 429) return 'Too many attempts — wait a moment, then try again.';
  return `Something went wrong on our end (${status}). Please try again.`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}