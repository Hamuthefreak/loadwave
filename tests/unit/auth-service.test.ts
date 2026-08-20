import crypto from 'node:crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { AuthRepository, AuthUserRow, RefreshTokenRow } from '../../src/modules/auth/auth.repo';
import type { TokenService } from '../../src/modules/auth/token.service';
import type { JwtUser, UserRole } from '../../src/modules/auth/auth.types';
import { verifyPassword } from '../../src/modules/auth/password.service';

const sha256Of = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

class MemoryAuthRepo implements AuthRepository {
  users: AuthUserRow[] = [];
  tokens: RefreshTokenRow[] = [];

  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    return this.users.find((u) => u.email === email) ?? null;
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async createTenantAndUser(input: {
    tenantName: string;
    tenantBaseCurrency: string;
    tenantBaseJurisdiction: string;
    email: string;
    passwordHash: string;
    roles: UserRole[];
  }): Promise<AuthUserRow> {
    const row: AuthUserRow = {
      id: 'user-' + this.users.length,
      tenantId: 'tenant-' + this.users.length,
      email: input.email,
      passwordHash: input.passwordHash,
      roles: input.roles,
      driverId: null,
      tenantName: input.tenantName,
      baseCurrency: input.tenantBaseCurrency,
      baseJurisdiction: input.tenantBaseJurisdiction,
      mcNumber: null,
      usdotNumber: null,
    };
    this.users.push(row);
    return { ...row };
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.tokens.push({
      id: 'rt-' + this.tokens.length,
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      user: null,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
    if (!row) return null;
    const user = this.users.find((u) => u.id === row.userId);
    return {
      ...row,
      user: user
        ? {
            id: user.id,
            tenantId: user.tenantId,
            email: user.email,
            roles: user.roles,
            driverId: user.driverId,
          }
        : null,
    };
  }

  async revokeRefreshToken(id: string): Promise<void> {
    const row = this.tokens.find((t) => t.id === id);
    if (row) row.revokedAt = new Date();
  }
}

class FakeTokenService implements TokenService {
  signAccess(payload: JwtUser): string {
    void payload;
    return 'fake-access-token';
  }
  verifyAccess(_token: string): JwtUser {
    throw new Error('not implemented in unit test');
  }
}

function makeService(repo = new MemoryAuthRepo()) {
  const auth = new AuthService(repo, new FakeTokenService(), {
    accessTtlSeconds: 900,
    refreshTtlSeconds: 604800,
  });
  return auth;
}

describe('AuthService', () => {
  it('registers a tenant + user with a hashed password', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    const session = await auth.register({
      tenantName: 'Montreal Hauling',
      email: 'ops@mth.ca',
      password: 'supersecret',
    });
    expect(session.user.email).toBe('ops@mth.ca');
    expect(session.user.roles).toEqual(['ADMIN']);
    expect(session.tenant.baseCurrency).toBe('CAD');
    expect(session.tenant.baseJurisdiction).toBe('QC');
    expect(session.tokens.accessToken).toBe('fake-access-token');
    expect(typeof session.tokens.refreshToken).toBe('string');
    expect(session.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = await repo.findUserByEmail('ops@mth.ca');
    expect(stored).not.toBeNull();
    expect(stored?.tenantId).toBe(session.user.tenantId);
  });

  it('rejects duplicate emails', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(
      auth.register({ tenantName: 'B', email: 'a@x.ca', password: 'password123' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('rejects an invalid password at login', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(auth.login({ email: 'a@x.ca', password: 'wrongpass' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('logs in a valid user and stores a working refresh token', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });

    const session = await auth.login({ email: 'a@x.ca', password: 'password123' });
    expect(session.tokens.refreshToken).toBeTruthy();
    expect(repo.tokens).toHaveLength(2); // one from register, one from login

    const refreshed = await auth.refresh(session.tokens.refreshToken);
    expect(refreshed.user.email).toBe('a@x.ca');
    // Rotation: the login token is revoked and a new one is issued; the
    // register-time token remains valid, so exactly two stay unrevoked.
    expect(repo.tokens.filter((t) => t.revokedAt === null)).toHaveLength(2);
    const loginTokenStored = repo.tokens.find((t) => t.tokenHash === sha256Of(session.tokens.refreshToken));
    expect(loginTokenStored?.revokedAt).not.toBeNull();
    expect(refreshed.tokens.refreshToken).not.toBe(session.tokens.refreshToken);
  });

  it('rejects an unknown / revoked refresh token', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(auth.refresh('nope-not-a-real-token')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('stores a password hash that bcrypt verifies but never equals the plaintext', async () => {
    const repo = new MemoryAuthRepo();
    const auth = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const stored = await repo.findUserByEmail('a@x.ca');
    expect(stored?.passwordHash).not.toBe('password123');
    expect(await verifyPassword('password123', stored!.passwordHash)).toBe(true);
  });
});
