import crypto from 'node:crypto';
import type { AuthRepository } from './auth.repo';
import { hashPassword, verifyPassword } from './password.service';
import type { TokenService } from './token.service';
import { badRequest, conflict, unauthorized } from '../../utils/errors';
import type { AuthTokens, PublicUser, UserRole } from './auth.types';

export interface RegisterInput {
  tenantName: string;
  email: string;
  password: string;
  roles?: UserRole[];
  tenantBaseCurrency?: string;
  tenantBaseJurisdiction?: string;
  mcNumber?: string;
  usdotNumber?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthServiceOptions {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface FreshSession {
  user: PublicUser;
  tokens: AuthTokens;
  tenant: {
    id: string;
    name: string;
    baseCurrency: string;
    baseJurisdiction: string;
    mcNumber: string | null;
    usdotNumber: string | null;
  };
}

function toPublicUser(row: {
  id: string;
  tenantId: string;
  email: string;
  roles: UserRole[];
  driverId: string | null;
  createdAt?: Date;
}): PublicUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    roles: row.roles,
    driverId: row.driverId,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly opts: AuthServiceOptions,
  ) {}

  async register(input: RegisterInput): Promise<FreshSession> {
    if (!input.email || !input.password) throw badRequest('email and password are required');
    if (input.password.length < 8) throw badRequest('password must be at least 8 characters');
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) throw conflict('email already registered');

    const roles: UserRole[] = input.roles && input.roles.length > 0 ? [...new Set(input.roles)] : ['ADMIN'];

    const passwordHash = await hashPassword(input.password);
    const row = await this.repo.createTenantAndUser({
      tenantName: input.tenantName,
      tenantBaseCurrency: input.tenantBaseCurrency ?? 'CAD',
      tenantBaseJurisdiction: input.tenantBaseJurisdiction ?? 'QC',
      mcNumber: input.mcNumber ?? null,
      usdotNumber: input.usdotNumber ?? null,
      email: input.email,
      passwordHash,
      roles,
    });

    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId);
    return {
      user,
      tokens,
      tenant: {
        id: row.tenantId,
        name: row.tenantName,
        baseCurrency: row.baseCurrency,
        baseJurisdiction: row.baseJurisdiction,
        mcNumber: row.mcNumber,
        usdotNumber: row.usdotNumber,
      },
    };
  }

  async login(input: LoginInput): Promise<FreshSession> {
    const row = await this.repo.findUserByEmail(input.email);
    if (!row) throw unauthorized('invalid credentials');
    const ok = await verifyPassword(input.password, row.passwordHash);
    if (!ok) throw unauthorized('invalid credentials');

    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId);
    return {
      user,
      tokens,
      tenant: {
        id: row.tenantId,
        name: row.tenantName,
        baseCurrency: row.baseCurrency,
        baseJurisdiction: row.baseJurisdiction,
        mcNumber: row.mcNumber,
        usdotNumber: row.usdotNumber,
      },
    };
  }

  /** Mints a fresh session for an already-authenticated internal user (e.g. an
   *  invite that was just accepted). No password check — callers must have
   *  already verified the invitation. */
  async sessionForUser(userId: string): Promise<FreshSession> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId);
    return {
      user,
      tokens,
      tenant: {
        id: row.tenantId,
        name: row.tenantName,
        baseCurrency: row.baseCurrency,
        baseJurisdiction: row.baseJurisdiction,
        mcNumber: row.mcNumber,
        usdotNumber: row.usdotNumber,
      },
    };
  }

  async refresh(refreshToken: string): Promise<FreshSession> {
    if (!refreshToken) throw badRequest('refreshToken is required');
    const row = await this.repo.findRefreshToken(sha256(refreshToken));
    if (!row || row.revokedAt) throw unauthorized('refresh token invalid');
    if (row.expiresAt.getTime() < Date.now()) throw unauthorized('refresh token expired');
    if (!row.user) throw unauthorized('refresh token invalid');

    await this.repo.revokeRefreshToken(row.id);
    const user = toPublicUser(row.user);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId);
    return {
      user,
      tokens,
      tenant: {
        id: user.tenantId,
        name: '',
        baseCurrency: '',
        baseJurisdiction: '',
        mcNumber: null,
        usdotNumber: null,
      },
    };
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    roles: UserRole[],
    driverId: string | null,
  ): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccess({ sub: userId, tenantId, roles, driverId });
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshExpiresIn = this.opts.refreshTtlSeconds;
    await this.repo.createRefreshToken(
      userId,
      sha256(refreshToken),
      new Date(Date.now() + refreshExpiresIn * 1000),
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessExpiresIn: this.opts.accessTtlSeconds,
      refreshExpiresIn,
    };
  }
}
