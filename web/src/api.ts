// Tiny API client for the LoadWave backend.
//
// Requests are made with a RELATIVE path (e.g. "/auth/login"). In development
// Vite proxies those calls to http://localhost:4000 (see vite.config.ts).

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

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401) setToken(null); // force re-login
    const message =
      (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}