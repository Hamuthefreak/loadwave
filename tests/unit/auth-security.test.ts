import crypto from 'node:crypto';
import { AuthService, type PasswordResetMailer } from '../../src/modules/auth/auth.service';
import type { AuthRepository, AuthUserRow, PasswordResetTokenRow, RefreshTokenRow, SessionRow } from '../../src/modules/auth/auth.repo';
import type { TokenService } from '../../src/modules/auth/token.service';
import type { JwtUser, UserRole } from '../../src/modules/auth/auth.types';
import { generateCode } from '../../src/modules/auth/totp.service';

const sha256Of = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// Self-contained in-memory fakes so this suite stays independent of the
// (larger) fakes in auth-service.test.ts.
class MemoryAuthRepo implements AuthRepository {
  users: AuthUserRow[] = [];
  tokens: RefreshTokenRow[] = [];
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
  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
    if (!row) return null;
    const user = this.users.find((u) => u.id === row.userId);
    return {
      ...row,
      user: user
        ? { id: user.id, tenantId: user.tenantId, email: user.email, roles: user.roles, driverId: user.driverId }
        : null,
    };
  }
  async revokeRefreshToken(id: string): Promise<void> {
    const row = this.tokens.find((t) => t.id === id);
    if (row) row.revokedAt = new Date();
  }
  async listSessions(userId: string, currentTokenHash?: string | null): Promise<{ sessions: SessionRow[]; currentId: string | null }> {
    // Insertion order is oldest-first; the real repo returns newest first.
    const rows = this.tokens.filter((t) => t.userId === userId).reverse();
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
  async updateTwoFactor(userId: string, data: { secret?: string | null; enabled?: boolean; recoveryCodes?: string | null }): Promise<void> {
    const row = this.users.find((u) => u.id === userId);
    if (!row) return;
    if (data.secret !== undefined) row.twoFactorSecret = data.secret;
    if (data.enabled !== undefined) row.twoFactorEnabled = data.enabled;
    if (data.recoveryCodes !== undefined) row.twoFactorRecoveryCodes = data.recoveryCodes;
  }
  async createPasswordResetToken(_userId: string, _tokenHash: string, _expiresAt: Date): Promise<void> {
    throw new Error('not used in this suite');
  }
  async findPasswordResetToken(_tokenHash: string): Promise<PasswordResetTokenRow | null> {
    throw new Error('not used in this suite');
  }
  async markPasswordResetTokenUsed(_id: string): Promise<void> {
    throw new Error('not used in this suite');
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

function makeService(
  repo = new MemoryAuthRepo(),
  mailer?: PasswordResetMailer,
  onSessionIssued?: (info: {
    tenantId: string;
    userId: string;
    email: string;
    roles: UserRole[];
    userAgent: string | null;
    isNewDevice: boolean;
  }) => void,
) {
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
      onSessionIssued,
    },
    mailer,
  );
  return { auth, tokens, repo };
}

async function registered2fa(auth: AuthService): Promise<string> {
  await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
  const { secret } = await auth.setupTwoFactor('user-0');
  await auth.enableTwoFactor('user-0', generateCode(secret));
  return secret;
}

describe('AuthService — remember me & 2FA', () => {
  it('login with rememberMe issues a 30-day refresh token; without, 7 days', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123', userAgent: 'Chrome on Windows' });

    const plain = await auth.login({ email: 'a@x.ca', password: 'password123', userAgent: 'Chrome on Windows' });
    const remembered = await auth.login({ email: 'a@x.ca', password: 'password123', rememberMe: true, userAgent: 'Chrome on Windows' });

    if ('requiresTwoFactor' in plain || 'requiresTwoFactor' in remembered) throw new Error('2FA unexpectedly required');
    const plainRow = repo.tokens.find((t) => t.tokenHash === sha256Of(plain.tokens.refreshToken))!;
    const rememberRow = repo.tokens.find((t) => t.tokenHash === sha256Of(remembered.tokens.refreshToken))!;
    expect(plain.tokens.refreshExpiresIn).toBe(604800);
    expect(remembered.tokens.refreshExpiresIn).toBe(2592000);
    // Session rows carry the device label for the Sessions page.
    expect(plainRow.userAgent).toBe('Chrome on Windows');
    expect(rememberRow.expiresAt.getTime() - rememberRow.createdAt.getTime()).toBe(2592000 * 1000);

    // Rotation keeps the policy: refreshing the remembered session stays 30 days.
    const rotated = await auth.refresh(remembered.tokens.refreshToken);
    expect(rotated.tokens.refreshExpiresIn).toBe(2592000);
    const rotatedRow = repo.tokens.find((t) => t.tokenHash === sha256Of(rotated.tokens.refreshToken))!;
    expect(rotatedRow.expiresAt.getTime() - rotatedRow.createdAt.getTime()).toBe(2592000 * 1000);
  });

  it('login with 2FA enabled returns a challenge token, never a session', async () => {
    const { auth, repo } = makeService();
    await registered2fa(auth);

    const result = await auth.login({ email: 'a@x.ca', password: 'password123' });
    expect('requiresTwoFactor' in result).toBe(true);
    if (!('requiresTwoFactor' in result)) throw new Error('unreachable');
    expect(result.twoFactorToken).toBe('fake-twofactor-token');
    // No session was issued at the password step.
    expect(repo.tokens).toHaveLength(1);
  });

  it('verifyTwoFactorLogin completes with an authenticator code and honors rememberMe', async () => {
    const { auth } = makeService();
    const secret = await registered2fa(auth);

    await auth.login({ email: 'a@x.ca', password: 'password123', rememberMe: true });
    const session = await auth.verifyTwoFactorLogin('fake-twofactor-token', generateCode(secret));
    expect(session.user.email).toBe('a@x.ca');
    expect(session.tokens.refreshExpiresIn).toBe(2592000); // remembered

    await expect(auth.verifyTwoFactorLogin('fake-twofactor-token', '000000')).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.verifyTwoFactorLogin('expired-token', generateCode(secret))).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('expired'),
    });
  });

  it('recovery codes sign in once and are then consumed', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const { secret } = await auth.setupTwoFactor('user-0');
    const { recoveryCodes } = await auth.enableTwoFactor('user-0', generateCode(secret));
    expect(recoveryCodes).toHaveLength(8);

    await auth.login({ email: 'a@x.ca', password: 'password123' });
    const session = await auth.verifyTwoFactorLogin('fake-twofactor-token', recoveryCodes[0].toLowerCase());
    expect(session.user.email).toBe('a@x.ca');

    // Used code is gone (hashed at rest, removed on use); others still valid.
    const remaining = (repo.users[0].twoFactorRecoveryCodes ?? '').split('|');
    expect(remaining).toHaveLength(7);
    expect(remaining.some((h) => h === sha256Of(recoveryCodes[0]))).toBe(false);
    expect(remaining.some((h) => h === sha256Of(recoveryCodes[1]))).toBe(true);
    await expect(auth.verifyTwoFactorLogin('fake-twofactor-token', recoveryCodes[0])).rejects.toMatchObject({ statusCode: 401 });
  });

  it('a two-factor code sent with the password completes login in one round trip', async () => {
    const { auth } = makeService();
    const secret = await registered2fa(auth);
    const session = await auth.login({ email: 'a@x.ca', password: 'password123', twoFactorCode: generateCode(secret) });
    expect('requiresTwoFactor' in session).toBe(false);
    if ('requiresTwoFactor' in session) throw new Error('unreachable');
    expect(session.tokens.refreshToken).toBeTruthy();
  });

  it('changePassword requires the current password, updates it, and keeps only the current session', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    const other = await auth.login({ email: 'a@x.ca', password: 'password123' });
    const current = await auth.login({ email: 'a@x.ca', password: 'password123' });
    if ('requiresTwoFactor' in other || 'requiresTwoFactor' in current) throw new Error('2FA unexpectedly required');

    await expect(
      auth.changePassword('user-0', 'wrong-current', 'brand-new-password', current.tokens.refreshToken),
    ).rejects.toMatchObject({ statusCode: 401, message: expect.stringContaining('current password') });

    await auth.changePassword('user-0', 'password123', 'brand-new-password', current.tokens.refreshToken);
    await expect(auth.login({ email: 'a@x.ca', password: 'password123' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.login({ email: 'a@x.ca', password: 'brand-new-password' })).resolves.toBeTruthy();

    const otherRow = repo.tokens.find((t) => t.tokenHash === sha256Of(other.tokens.refreshToken))!;
    const currentRow = repo.tokens.find((t) => t.tokenHash === sha256Of(current.tokens.refreshToken))!;
    expect(otherRow.revokedAt).not.toBeNull();
    expect(currentRow.revokedAt).toBeNull();
  });

  it('lists sessions with device labels and revokes only its own', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    await auth.login({ email: 'a@x.ca', password: 'password123', userAgent: 'iPhone Safari' });
    const second = await auth.login({ email: 'a@x.ca', password: 'password123', userAgent: 'Chrome on Windows' });
    if ('requiresTwoFactor' in second) throw new Error('2FA unexpectedly required');

    const { sessions, currentId } = await auth.listSessions('user-0', second.tokens.refreshToken);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].userAgent).toBe('Chrome on Windows'); // newest first
    expect(currentId).toBe(repo.tokens.find((t) => t.tokenHash === sha256Of(second.tokens.refreshToken))!.id);

    await auth.revokeSession('user-0', sessions[0].id);
    expect(repo.tokens.filter((t) => !t.revokedAt)).toHaveLength(2);
    await expect(auth.revokeSession('user-0', 'not-a-session')).resolves.toBe(false);
  });

  it('tenant-mandated 2FA forces ops accounts through setup at login', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    repo.users[0].tenantRequireTwoFactor = true; // ADMIN, no 2FA yet

    const result = await auth.login({ email: 'a@x.ca', password: 'password123' });
    expect('requiresTwoFactor' in result).toBe(true);
    if (!('requiresTwoFactor' in result)) throw new Error('unreachable');
    expect(result.setupRequired).toBe(true);
    expect(repo.tokens).toHaveLength(1); // register session only — no login session yet

    // The challenge token must not complete a login on its own.
    await expect(auth.verifyTwoFactorLogin('fake-twofactor-token', '123456')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('forced setup: setupPendingForLogin hands out a secret, verify activates it and returns recovery codes', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    repo.users[0].tenantRequireTwoFactor = true;

    await auth.login({ email: 'a@x.ca', password: 'password123' });
    const { secret, otpauthUrl } = await auth.setupPendingForLogin('fake-twofactor-token');
    expect(secret.length).toBeGreaterThan(10);
    expect(otpauthUrl).toContain('otpauth://totp/');

    // A wrong code at the setup step is rejected before any session exists.
    await expect(auth.verifyTwoFactorLogin('fake-twofactor-token', '000000')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repo.users[0].twoFactorEnabled).toBe(false);

    const session = await auth.verifyTwoFactorLogin('fake-twofactor-token', generateCode(secret));
    expect(session.recoveryCodes).toHaveLength(8);
    expect(session.user.email).toBe('a@x.ca');
    expect(repo.users[0].twoFactorEnabled).toBe(true);

    // 2FA is now active: the next sign-in asks for a code, not setup.
    const next = await auth.login({ email: 'a@x.ca', password: 'password123' });
    if (!('requiresTwoFactor' in next)) throw new Error('2FA should be required');
    expect(next.setupRequired).toBeUndefined();
  });

  it('enforcement applies to ops only: drivers and 2FA-ready ops are not forced', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'driver@x.ca', password: 'password123', roles: ['DRIVER'] });
    repo.users[0].tenantRequireTwoFactor = true;
    const driver = await auth.login({ email: 'driver@x.ca', password: 'password123' });
    expect('requiresTwoFactor' in driver).toBe(false);

    // An ops account that already enabled 2FA gets the normal challenge only.
    await auth.register({ tenantName: 'B', email: 'ops@x.ca', password: 'password123' });
    const ops = repo.users[1];
    ops.tenantRequireTwoFactor = true;
    const { secret } = await auth.setupTwoFactor(ops.id);
    await auth.enableTwoFactor(ops.id, generateCode(secret));
    const result = await auth.login({ email: 'ops@x.ca', password: 'password123' });
    if (!('requiresTwoFactor' in result)) throw new Error('2FA should be required');
    expect(result.setupRequired).toBeUndefined();
  });

  it('twoFactorStatus reports the tenant requirement for ops accounts', async () => {
    const { auth, repo } = makeService();
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });
    repo.users[0].tenantRequireTwoFactor = true;
    expect(await auth.twoFactorStatus('user-0')).toEqual({ enabled: false, required: true });
    await auth.setupTwoFactor('user-0');
    expect((await auth.twoFactorStatus('user-0')).enabled).toBe(false);
    await auth.disableTwoFactor('user-0', '000000').catch(() => undefined); // noop guard
  });

  it('fires the new-device alert once per fingerprint, and not without a user agent', async () => {
    const issued: { userAgent: string | null; isNewDevice: boolean }[] = [];
    const { auth } = makeService(undefined, undefined, (info) => issued.push(info));
    await auth.register({ tenantName: 'A', email: 'a@x.ca', password: 'password123' });

    const first = await auth.login({ email: 'a@x.ca', password: 'password123', userAgent: 'Chrome on Windows' });
    if ('requiresTwoFactor' in first) throw new Error('unexpected challenge');
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ userAgent: 'Chrome on Windows', isNewDevice: true });

    const second = await auth.login({ email: 'a@x.ca', password: 'password123', userAgent: 'chrome on WINDOWS' });
    if ('requiresTwoFactor' in second) throw new Error('unexpected challenge');
    expect(issued).toHaveLength(2);
    expect(issued[1].isNewDevice).toBe(false); // normalized fingerprint matches

    const noUa = await auth.login({ email: 'a@x.ca', password: 'password123' });
    if ('requiresTwoFactor' in noUa) throw new Error('unexpected challenge');
    expect(issued[2]).toMatchObject({ userAgent: null, isNewDevice: false });
  });

  it('disableTwoFactor requires a code and clears the secret', async () => {
    const { auth, repo } = makeService();
    const secret = await registered2fa(auth);

    await expect(auth.disableTwoFactor('user-0', '000000')).rejects.toMatchObject({ statusCode: 400 });
    await auth.disableTwoFactor('user-0', generateCode(secret));
    const row = repo.users[0];
    expect(row.twoFactorEnabled).toBe(false);
    expect(row.twoFactorSecret).toBeNull();
    expect(row.twoFactorRecoveryCodes).toBeNull();

    const result = await auth.login({ email: 'a@x.ca', password: 'password123' });
    expect('requiresTwoFactor' in result).toBe(false);
  });
});