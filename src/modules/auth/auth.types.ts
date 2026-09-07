export const ROLES = ['ADMIN', 'DISPATCHER', 'DRIVER'] as const;

export type UserRole = (typeof ROLES)[number];

export interface JwtUser {
  sub: string;
  tenantId: string;
  roles: UserRole[];
  driverId: string | null;
  type: 'access';
}

/** Payload of the short-lived challenge token handed out when an account has
 *  2FA enabled (or must enable it): proves the password was right, expires in
 *  5 minutes, and carries the remember-me choice made on the sign-in form.
 *  setupRequired marks the tenant-policy flow where the account has no 2FA yet
 *  and must enable it before the session is issued. */
export interface TwoFactorChallenge {
  sub: string;
  type: 'twofactor';
  remember: boolean;
  setupRequired?: boolean;
}

export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  roles: UserRole[];
  driverId: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export function parseRoles(csv: string | null | undefined): UserRole[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is UserRole => (ROLES as readonly string[]).includes(r));
}

export function stringifyRoles(roles: UserRole[]): string {
  return [...new Set(roles)].join(',');
}
