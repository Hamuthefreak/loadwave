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
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
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
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null>;
  revokeRefreshToken(id: string): Promise<void>;
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
    tenant: {
      name: string;
      baseCurrency: string;
      baseJurisdiction: string;
      mcNumber?: string | null;
      usdotNumber?: string | null;
    };
  }): AuthUserRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      passwordHash: row.passwordHash,
      roles: row.roles.split(',') as UserRole[],
      driverId: row.driverId,
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

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
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
}
