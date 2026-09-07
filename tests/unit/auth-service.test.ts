import crypto from 'node:crypto';
import { AuthService, type PasswordResetMailer } from '../../src/modules/auth/auth.service';
import type { AuthRepository, AuthUserRow, PasswordResetTokenRow, RefreshTokenRow, SessionRow } from '../../src/modules/auth/auth.repo';
import type { TokenService } from '../../src/modules/auth/token.service';
import type { JwtUser, UserRole } from '../../src/modules/auth/auth.types';
import { verifyPassword } from '../../src/modules/auth/password.service';

const sha256Of = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

class MemoryAuthRepo implements AuthRepository {
  users: AuthUserRow[] = [];
  tokens: RefreshTokenRow[] = [];
  resetTokens: PasswordResetTokenRow[] = [];
  devices = new Map<string, string[]>();

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
      twoFactorSecret: null,
      twoFactorEnabled: false,
      twoFactorRecoveryCodes: null,
      tenantRequireTwoFactor: false,
    };
    this.users.push(row);
    return { ...row };
  }

  async recordDevice(userId: string, fingerprint: string): Promise<boolean> {
    const known = this.devices.get(userId) ?? [];
    if (known.includes(fingerprint)) return false;
    this.devices.set(userId, [fingerprint, ...known].slice(0, 20));
    return true;
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string | null): Promise<void> {
    this.tokens.push({
      id: 'rt-' + this.tokens.length,
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      createdAt: new Date(),
      userAgent: userAgent ?? null,
      user: null,
    });
  }

  async listSessions(userId: string, currentTokenHash?: string | null): Promise<{ sessions: SessionRow[]; currentId: string | null }> {
    const rows = this.tokens.filter((t) => t.userId === userId);
    return {
      sessions: rows.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
        userAgent: t.userAgent,
      })),
      currentId: currentTokenHash ? (rows.find((t) => t.tokenHash === currentTokenHash)?.id ?? null) : null,
    };
  }

  async revokeSession(id: string, userId: string): Promise<boolean> {
    const row = this.tokens.find((t) => t.id === id && t.userId === userId && !t.revokedAt);
    if (row) row.revokedAt = new Date();
    return row !== undefined;
  }

  async revokeOtherRefreshTokens(userId: string, keepTokenHash: string): Promise<void> {
    for (const t of this.tokens) {
      if (t.userId === userId && !t.revokedAt && t.tokenHash !== keepTokenHash) t.revokedAt = new Date();
    }
  }

  async updateTwoFactor(
    userId: string,
    data: { secret?: string | null; enabled?: boolean; recoveryCodes?: string | null },
  ): Promise<void> {
    const row = this.users.find((u) => u.id === userId);
    if (!row) return;
    if (data.secret !== undefined) row.twoFactorSecret = data.secret;
    if (data.enabled !== undefined) row.twoFactorEnabled = data.enabled;
    if (data.recoveryCodes !== undefined) row.twoFactorRecoveryCodes = data.recoveryCodes;
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

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.resetTokens.push({ id: 'prt-' + this.resetTokens.length, userId, tokenHash, expiresAt, usedAt: null, user: null });
  }

  async findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const row = this.resetTokens.find((t) => t.tokenHash === tokenHash) ?? null;
    if (!row) return null;
    const user = this.users.find((u) => u.id === row.userId);
    return {
      ...row,
      user: user ? { id: user.id, tenantId: user.tenantId, email: user.email, roles: user.roles, driverId: user.driverId } : null,
    };
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    const row = this.resetTokens.find((t) => t.id === id);
    if (row) row.usedAt = new Date();
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const row = this.users.find((u) => u.id === userId);
    if (row) row.passwordHash = passwordHash;
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    for (const t of this.tokens) {
      if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
    }
  }
}

class FakeTokenService implements TokenService {
  private lastTwoFactor: { sub: string; remember: boolean } | null = null;

  signAccess(payload: JwtUser): string {
    void payload;
    return 'fake-access-token';
  }
  verifyAccess(_token: string): JwtUser {
    throw new Error('not implemented in unit test');
  }
  signTwoFactor(payload: { sub: string; remember: boolean }): string {
    this.lastTwoFactor = payload;
    return 'fake-twofactor-token';
  }
  verifyTwoFactor(token: string): { sub: string; remember: boolean; type: 'twofactor' } {
    if (token !== 'fake-twofactor-token') throw new Error('bad token');
    if (!this.lastTwoFactor) throw new Error('no challenge issued');
    return { ...this.lastTwoFactor, type: 'twofactor' };
  }
}

function makeService(repo = new MemoryAuthRepo(), mailer?: PasswordResetMailer) {
  const tokens = new FakeTokenService();
  const auth = new AuthService(
    repo,
    tokens,
    {
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
      rememberedRefreshTtlSeconds: 2592000,
      appUrl: 'https://app.example.com',
      isProd: false,
    },
    mailer,
  );
  return { auth, tokens };
}

describe('AuthService', () => {
  it('registers a tenant + user with a hashed password', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
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
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(
      auth.register({ tenantName: 'B', email: 'a@x.ca', password: 'password123' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('rejects an invalid password at login', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(auth.login({ email: 'a@x.ca', password: 'wrongpass' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('logs in a valid user and stores a working refresh token', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });

    const session = await auth.login({ email: 'a@x.ca', password: 'password123' });
    if ('requiresTwoFactor' in session) throw new Error('2FA unexpectedly required');
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
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(auth.refresh('nope-not-a-real-token')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('stores a password hash that bcrypt verifies but never equals the plaintext', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const stored = await repo.findUserByEmail('a@x.ca');
    expect(stored?.passwordHash).not.toBe('password123');
    expect(await verifyPassword('password123', stored!.passwordHash)).toBe(true);
  });

  it('tells users apart: unknown email vs wrong password', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await expect(auth.login({ email: 'nobody@x.ca', password: 'password123' })).rejects.toMatchObject({
      message: expect.stringContaining('No account found'),
    });
    await expect(auth.login({ email: 'a@x.ca', password: 'wrongpass' })).rejects.toMatchObject({
      message: expect.stringContaining('password'),
    });
  });

  it('accepts emails with different casing / whitespace at login and register', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: '  A@X.CA ', password: 'password123' });
    const session = await auth.login({ email: 'a@x.ca', password: 'password123' });
    if ('requiresTwoFactor' in session) throw new Error('2FA unexpectedly required');
    expect(session.user.email).toBe('a@x.ca');
    await expect(auth.register({ tenantName: 'B', email: 'A@x.ca', password: 'password123' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('requestPasswordReset creates a hashed token and returns a dev link when mail is off', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });

    const result = await auth.requestPasswordReset('A@X.CA');
    expect(result.emailed).toBe(false);
    expect(result.devResetUrl).toMatch(/^https:\/\/app\.example\.com\/reset-password\?token=/);
    const raw = result.devResetUrl!.split('token=')[1];
    // Stored hashed, never raw.
    expect(repo.resetTokens.some((t) => t.tokenHash === sha256Of(raw))).toBe(true);
    expect(repo.resetTokens.some((t) => t.tokenHash === raw)).toBe(false);
  });

  it('requestPasswordReset never confirms unknown emails', async () => {
    const { auth } = makeService();
    const result = await auth.requestPasswordReset('ghost@x.ca');
    expect(result).toEqual({ emailed: false });
    await expect(auth.requestPasswordReset('ghost@x.ca')).resolves.toBeTruthy();
  });

  it('requestPasswordReset emails the link when SMTP is configured', async () => {
    const repo = new MemoryAuthRepo();
    const sent: string[] = [];
    const mailer: PasswordResetMailer = {
      isConfigured: async () => true,
      send: async (_t, to, _s, text) => {
        sent.push(to + ' :: ' + text);
      },
    };
    const { auth } = makeService(repo, mailer);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const result = await auth.requestPasswordReset('a@x.ca');
    expect(result).toEqual({ emailed: true });
    expect(result.devResetUrl).toBeUndefined();
    expect(sent.some((m) => m.startsWith('a@x.ca') && m.includes('reset-password?token='))).toBe(true);
  });

  it('resetPassword sets a new password, kills sessions and consumes the token', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await auth.login({ email: 'a@x.ca', password: 'password123' });
    expect(repo.tokens.filter((t) => !t.revokedAt)).toHaveLength(2);

    const { devResetUrl } = await auth.requestPasswordReset('a@x.ca');
    const raw = devResetUrl!.split('token=')[1];
    const tokensBefore = repo.tokens.length;
    await auth.resetPassword(raw, 'brand-new-password');

    // Old password fails, new one works; every pre-reset session is dead.
    await expect(auth.login({ email: 'a@x.ca', password: 'password123' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.login({ email: 'a@x.ca', password: 'brand-new-password' })).resolves.toBeTruthy();
    expect(repo.tokens.slice(0, tokensBefore).every((t) => t.revokedAt)).toBe(true);
    expect(repo.resetTokens[0].usedAt).not.toBeNull();
  });

  it('rejects reusing, unknown and expired reset tokens', async () => {
    const repo = new MemoryAuthRepo();
    const { auth } = makeService(repo);
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const { devResetUrl } = await auth.requestPasswordReset('a@x.ca');
    const raw = devResetUrl!.split('token=')[1];

    await auth.resetPassword(raw, 'brand-new-password');
    await expect(auth.resetPassword(raw, 'another-password')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('already been used'),
    });
    await expect(auth.resetPassword('garbage-token', 'another-password')).rejects.toMatchObject({ statusCode: 400 });
    await expect(auth.resetPassword(raw, 'short')).rejects.toMatchObject({ statusCode: 400 });

    // Expired token path: request a fresh one, then age it.
    const { devResetUrl: second } = await auth.requestPasswordReset('a@x.ca');
    const raw2 = second!.split('token=')[1];
    repo.resetTokens[1].expiresAt = new Date(Date.now() - 1000);
    await expect(auth.resetPassword(raw2, 'another-password')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('expired'),
    });
  });
});
