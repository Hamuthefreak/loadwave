export const ROLES = ['ADMIN', 'DISPATCHER', 'DRIVER'] as const;

export type UserRole = (typeof ROLES)[number];

export interface JwtUser {
  sub: string;
  tenantId: string;
  roles: UserRole[];
  driverId: string | null;
  type: 'access';
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
