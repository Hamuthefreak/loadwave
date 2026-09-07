import type { PrismaClient } from '@prisma/client';
import type { PrismaTx } from '../../db/prisma';
import type { UserRole } from './auth.types';

export interface AuthUserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  roles: UserRole[];
  driverId: string | null;
  tenantName: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  twoFactorSecret: string | null;
  twoFactorEnabled: boolean;
  twoFactorRecoveryCodes: string | null;
  /** Tenant-wide policy: ops accounts must enable 2FA before signing in. */
  tenantRequireTwoFactor: boolean;
}

export interface SessionRow {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  userAgent: string | null;
  user: {
    id: string;
    tenantId: string;
    email: string;
    roles: UserRole[];
    driverId: string | null;
  } | null;
}

export interface PasswordResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  user: {
    id: string;
    tenantId: string;
    email: string;
    roles: UserRole[];
    driverId: string | null;
  } | null;
}

export interface CreateTenantUserInput {
  tenantName: string;
  tenantBaseCurrency: string;
  tenantBaseJurisdiction: string;
  mcNumber?: string | null;
  usdotNumber?: string | null;
  email: string;
  passwordHash: string;
  roles: UserRole[];
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRow | null>;
  findUserById(id: string): Promise<AuthUserRow | null>;
  createTenantAndUser(input: CreateTenantUserInput): Promise<AuthUserRow>;
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string | null): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null>;
  revokeRefreshToken(id: string): Promise<void>;
  /** Active (and recently expired) sessions for a user, newest first. The
   *  token hashes stay in the repo: callers get rows plus which session id
   *  matches currentTokenHash (if any), never the hash itself. */
  listSessions(userId: string, currentTokenHash?: string | null): Promise<{ sessions: SessionRow[]; currentId: string | null }>;
  /** Revokes a session only if it belongs to the given user. */
  revokeSession(id: string, userId: string): Promise<boolean>;
  /** Kills every live session except the one identified by tokenHash. */
  revokeOtherRefreshTokens(userId: string, keepTokenHash: string): Promise<void>;
  updateTwoFactor(
    userId: string,
    data: { secret?: string | null; enabled?: boolean; recoveryCodes?: string | null },
  ): Promise<void>;
  /** Records a signed-in device fingerprint; true when it was previously unknown. */
  recordDevice(userId: string, fingerprint: string): Promise<boolean>;
  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRow | null>;
  markPasswordResetTokenUsed(id: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  /** Kills every live session for a user (password changed / reset). */
  revokeAllUserRefreshTokens(userId: string): Promise<void>;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private mapUser(row: {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    roles: string;
    driverId: string | null;
    twoFactorSecret: string | null;
    twoFactorEnabled: boolean;
    twoFactorRecoveryCodes: string | null;
    tenant: {
      name: string;
      baseCurrency: string;
      baseJurisdiction: string;
      mcNumber?: string | null;
      usdotNumber?: string | null;
      requireTwoFactor: boolean;
    };
  }): AuthUserRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      roles: row.roles.split(',') as UserRole[],
      driverId: row.driverId,
      twoFactorSecret: row.twoFactorSecret,
      twoFactorEnabled: row.twoFactorEnabled,
      twoFactorRecoveryCodes: row.twoFactorRecoveryCodes,
      tenantRequireTwoFactor: row.tenant.requireTwoFactor,
      tenantName: row.tenant.name,
      baseCurrency: row.tenant.baseCurrency,
      baseJurisdiction: row.tenant.baseJurisdiction,
      mcNumber: row.tenant.mcNumber ?? null,
      usdotNumber: row.tenant.usdotNumber ?? null,
    };
  }

  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    const row = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
    return row ? this.mapUser(row) : null;
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: true },
    });
    return row ? this.mapUser(row) : null;
  }

  async createTenantAndUser(input: CreateTenantUserInput): Promise<AuthUserRow> {
    const created = await this.prisma.$transaction(async (tx: PrismaTx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          baseCurrency: input.tenantBaseCurrency,
          baseJurisdiction: input.tenantBaseJurisdiction,
          mcNumber: input.mcNumber ?? null,
          usdotNumber: input.usdotNumber ?? null,
        },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          passwordHash: input.passwordHash,
          roles: input.roles.join(','),
        },
      });
      return { ...user, tenant };
    });
    return this.mapUser(created);
  }

  async createRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt, userAgent: userAgent ?? null },
    });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      userAgent: row.userAgent,
      user: row.user
        ? {
            id: row.user.id,
            tenantId: row.user.tenantId,
            email: row.user.email,
            roles: row.user.roles.split(',') as UserRole[],
            driverId: row.user.driverId,
          }
        : null,
    };
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  async findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      user: row.user
        ? {
            id: row.user.id,
            tenantId: row.user.tenantId,
            email: row.user.email,
            roles: row.user.roles.split(',') as UserRole[],
            driverId: row.user.driverId,
          }
        : null,
    };
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(
    userId: string,
    currentTokenHash?: string | null,
  ): Promise<{ sessions: SessionRow[]; currentId: string | null }> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true, createdAt: true, expiresAt: true, revokedAt: true, userAgent: true },
    });
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        userAgent: r.userAgent,
      })),
      currentId: currentTokenHash ? (rows.find((r) => r.tokenHash === currentTokenHash)?.id ?? null) : null,
    };
  }

  async revokeSession(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async revokeOtherRefreshTokens(userId: string, keepTokenHash: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, NOT: { tokenHash: keepTokenHash } },
      data: { revokedAt: new Date() },
    });
  }

  async updateTwoFactor(
    userId: string,
    data: { secret?: string | null; enabled?: boolean; recoveryCodes?: string | null },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.secret !== undefined ? { twoFactorSecret: data.secret } : {}),
        ...(data.enabled !== undefined ? { twoFactorEnabled: data.enabled } : {}),
        ...(data.recoveryCodes !== undefined ? { twoFactorRecoveryCodes: data.recoveryCodes } : {}),
      },
    });
  }

  async recordDevice(userId: string, fingerprint: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { knownDevices: true },
    });
    if (!user) return false;
    if (user.knownDevices.includes(fingerprint)) return false;
    // Keep the list bounded (20); oldest fall off.
    const knownDevices = [fingerprint, ...user.knownDevices.slice(0, 19)];
    await this.prisma.user.update({
      where: { id: userId },
      data: { knownDevices },
    });
    return true;
  }
}
