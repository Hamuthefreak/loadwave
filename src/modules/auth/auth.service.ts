import crypto from 'node:crypto';
import type { AuthRepository, SessionRow } from './auth.repo';
import { hashPassword, verifyPassword } from './password.service';
import type { TokenService } from './token.service';
import { badRequest, conflict, unauthorized } from '../../utils/errors';
import type { AuthTokens, PublicUser, UserRole } from './auth.types';
import {
  buildOtpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  randomBase32Secret,
  verifyCode as verifyTotpCode,
} from './totp.service';

export interface RegisterInput {
  tenantName: string;
  email: string;
  password: string;
  roles?: UserRole[];
  tenantBaseCurrency?: string;
  tenantBaseJurisdiction?: string;
  mcNumber?: string;
  usdotNumber?: string;
  /** Browser label recorded on the session so users can recognize it. */
  userAgent?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  /** Keep the session alive ~30 days (vs the default TTL) across browser restarts. */
  rememberMe?: boolean;
  /** 6-digit authenticator code when the account has 2FA enabled. */
  twoFactorCode?: string;
  /** Browser label recorded on the session so users can recognize it. */
  userAgent?: string | null;
}

/** Fired after a fresh session is minted so the app can react (e.g. alert on
 *  sign-ins from previously unknown devices). Best-effort: failures inside the
 *  callback must not fail the login. */
export interface SessionIssuedInfo {
  tenantId: string;
  userId: string;
  email: string;
  roles: UserRole[];
  userAgent: string | null;
  /** True when this device fingerprint had never signed in before. */
  isNewDevice: boolean;
}

export interface AuthServiceOptions {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  /** TTL for "remember me" sessions (30 days by default vs 7 for normal). */
  rememberedRefreshTtlSeconds?: number;
  /** Public base URL used to build password-reset links (e.g. https://app.loadwave.ca). */
  appUrl?: string;
  /** When true, reset links are never returned to callers (email-only). */
  isProd?: boolean;
  /** Optional hook fired after every fresh session is issued (see SessionIssuedInfo). */
  onSessionIssued?: (info: SessionIssuedInfo) => void | Promise<void>;
}

/** Minimal mailer dependency so the service stays testable without SMTP. */
export interface PasswordResetMailer {
  send(tenantId: string, to: string, subject: string, text: string): Promise<void>;
  isConfigured(tenantId: string): Promise<boolean>;
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

/** Either a full session, or a 2FA challenge when the account needs a code.
 *  setupRequired marks an ops account whose tenant policy mandates 2FA but has
 *  not enabled it yet — the client walks them through enabling it before the
 *  session is issued. */
export type LoginResult =
  | FreshSession
  | { requiresTwoFactor: true; twoFactorToken: string; setupRequired?: boolean };

/** verifyTwoFactorLogin returns recoveryCodes only when the sign-in itself
 *  activated 2FA (the forced-setup-at-login flow) — they are shown once. */
export type TwoFactorVerifyResult = FreshSession & { recoveryCodes?: string[] };

export function isOpsRole(roles: readonly UserRole[]): boolean {
  return roles.includes('ADMIN') || roles.includes('DISPATCHER');
}

export function deviceFingerprint(userAgent: string): string {
  return sha256(userAgent.trim().toLowerCase());
}

const TWO_FACTOR_ISSUER = 'Loadwave';
const DEFAULT_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const RECOVERY_CODE_SEPARATOR = '|';

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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly opts: AuthServiceOptions,
    private readonly mailer?: PasswordResetMailer,
  ) {}

  async register(input: RegisterInput): Promise<FreshSession> {
    if (!input.email || !input.password) throw badRequest('email and password are required');
    if (input.password.length < 8) throw badRequest('password must be at least 8 characters');
    const email = input.email.trim().toLowerCase();
    const existing = await this.repo.findUserByEmail(email);
    if (existing) throw conflict('An account with this email already exists — try signing in instead.');

    const roles: UserRole[] = input.roles && input.roles.length > 0 ? [...new Set(input.roles)] : ['ADMIN'];

    const passwordHash = await hashPassword(input.password);
    const row = await this.repo.createTenantAndUser({
      tenantName: input.tenantName,
      tenantBaseCurrency: input.tenantBaseCurrency ?? 'CAD',
      tenantBaseJurisdiction: input.tenantBaseJurisdiction ?? 'QC',
      mcNumber: input.mcNumber ?? null,
      usdotNumber: input.usdotNumber ?? null,
      email,
      passwordHash,
      roles,
    });

    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
      rememberMe: false,
      userAgent: input.userAgent ?? null,
    });
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

  async login(input: LoginInput): Promise<LoginResult> {
    const row = await this.repo.findUserByEmail(input.email.trim().toLowerCase());
    if (!row) throw unauthorized('No account found with this email — double-check it, or create one.');
    const ok = await verifyPassword(input.password, row.passwordHash);
    if (!ok) throw unauthorized('That password isn’t right for this account. Try again, or reset it below.');

    const user = toPublicUser(row);
    const rememberMe = input.rememberMe === true;

    // 2FA gate: right password but the account needs a code (or the tenant
    // mandates 2FA for ops accounts that haven't set it up yet). Hand out a
    // 5-minute challenge token instead of a session. A code sent along with
    // the password is honored directly so clients can do one round-trip.
    const opsPolicyRequiresSetup = !row.twoFactorEnabled && row.tenantRequireTwoFactor && isOpsRole(row.roles);
    if (row.twoFactorEnabled || opsPolicyRequiresSetup) {
      if (input.twoFactorCode && row.twoFactorEnabled) {
        await this.consumeTwoFactorCode(row, input.twoFactorCode);
      } else {
        return {
          requiresTwoFactor: true,
          twoFactorToken: this.tokens.signTwoFactor({
            sub: user.id,
            remember: rememberMe,
            ...(opsPolicyRequiresSetup ? { setupRequired: true } : {}),
          }),
          ...(opsPolicyRequiresSetup ? { setupRequired: true } : {}),
        };
      }
    }

    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
      rememberMe,
      userAgent: input.userAgent ?? null,
    });
    await this.noteDevice(row, input.userAgent);
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

  /**
   * Completes the second factor of a 2FA login: the client exchanges the
   * short-lived challenge token (proves the password) for a real session by
   * presenting a valid authenticator code or an unused recovery code.
   */
  async verifyTwoFactorLogin(token: string, code: string, userAgent?: string | null): Promise<TwoFactorVerifyResult> {
    let challenge: { sub: string; remember: boolean; setupRequired?: boolean };
    try {
      challenge = this.tokens.verifyTwoFactor(token);
    } catch {
      throw unauthorized('That verification link has expired — sign in again.');
    }
    const row = await this.repo.findUserById(challenge.sub);
    if (!row) throw unauthorized('This account does not have two-factor authentication enabled.');

    // Forced-setup path (tenant policy): the pending secret from
    // setupPendingForLogin becomes the active secret, recovery codes are
    // minted, and the session is issued in the same step.
    if (!row.twoFactorEnabled) {
      if (!challenge.setupRequired || !row.twoFactorSecret) {
        throw unauthorized('This account does not have two-factor authentication enabled.');
      }
      if (!verifyTotpCode(row.twoFactorSecret, code.trim())) {
        throw badRequest('That code doesn’t match — check the time on your phone and try again.');
      }
      const recoveryCodes = generateRecoveryCodes();
      const hashed = recoveryCodes.map((c) => sha256(c)).join(RECOVERY_CODE_SEPARATOR);
      await this.repo.updateTwoFactor(row.id, { enabled: true, recoveryCodes: hashed });

      const user = toPublicUser(row);
      const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
        rememberMe: challenge.remember,
        userAgent: userAgent ?? null,
      });
      await this.noteDevice(row, userAgent);
      return {
        user,
        tokens,
        recoveryCodes,
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

    await this.consumeTwoFactorCode(row, code);

    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
      rememberMe: challenge.remember,
      userAgent: userAgent ?? null,
    });
    await this.noteDevice(row, userAgent);
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

  /**
   * First half of the forced-setup-at-login flow: exchanges the challenge
   * token (proof the password was right and the tenant mandates 2FA) for a
   * fresh TOTP secret. verifyTwoFactorLogin() then activates it and completes
   * the sign-in.
   */
  async setupPendingForLogin(token: string): Promise<{ secret: string; otpauthUrl: string }> {
    let challenge: { sub: string; setupRequired?: boolean };
    try {
      challenge = this.tokens.verifyTwoFactor(token);
    } catch {
      throw unauthorized('That verification link has expired — sign in again.');
    }
    if (!challenge.setupRequired) throw unauthorized('Two-factor setup is not required for this sign-in.');
    const row = await this.repo.findUserById(challenge.sub);
    if (!row) throw unauthorized('invalid credentials');
    if (row.twoFactorEnabled) throw conflict('Two-factor authentication is already on for this account.');

    const secret = randomBase32Secret();
    await this.repo.updateTwoFactor(row.id, { secret });
    return { secret, otpauthUrl: buildOtpauthUrl(secret, row.email, TWO_FACTOR_ISSUER) };
  }

  /** Whether 2FA is on for the account, and whether the tenant policy
   *  requires it (drives the Settings page badge). */
  async twoFactorStatus(userId: string): Promise<{ enabled: boolean; required: boolean }> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    return {
      enabled: row.twoFactorEnabled,
      required: row.tenantRequireTwoFactor && isOpsRole(row.roles),
    };
  }

  // --- Two-factor setup ---------------------------------------------------

  /** Generates and stores a fresh TOTP secret; returns what the authenticator
   *  app needs (URI for QR scanning + the raw secret for manual entry). The
   *  secret is not active until enableTwoFactor() verifies a code. */
  async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    if (row.twoFactorEnabled) throw conflict('Two-factor authentication is already on for this account.');
    const secret = randomBase32Secret();
    await this.repo.updateTwoFactor(userId, { secret });
    return { secret, otpauthUrl: buildOtpauthUrl(secret, row.email, TWO_FACTOR_ISSUER) };
  }

  /** Verifies the setup code and switches 2FA on, returning the one-time
   *  recovery codes (shown to the user exactly once). */
  async enableTwoFactor(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    if (row.twoFactorEnabled) throw conflict('Two-factor authentication is already on for this account.');
    if (!row.twoFactorSecret) throw badRequest('Start the setup first to generate a secret.');
    if (!verifyTotpCode(row.twoFactorSecret, code)) throw badRequest('That code doesn’t match — check the time on your phone and try again.');

    const recoveryCodes = generateRecoveryCodes();
    const hashed = recoveryCodes.map((c) => sha256(c)).join(RECOVERY_CODE_SEPARATOR);
    await this.repo.updateTwoFactor(userId, { enabled: true, recoveryCodes: hashed });
    return { recoveryCodes };
  }

  /** Turns 2FA off. Requires a valid code from the authenticator so a stolen
   *  session alone can’t drop the protection. */
  async disableTwoFactor(userId: string, code: string): Promise<void> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    if (!row.twoFactorEnabled) throw badRequest('Two-factor authentication is not enabled.');
    if (!row.twoFactorSecret) throw badRequest('Two-factor authentication is not enabled.');
    if (!verifyTotpCode(row.twoFactorSecret, code)) throw badRequest('That code doesn’t match — check the time on your phone and try again.');
    await this.repo.updateTwoFactor(userId, { secret: null, enabled: false, recoveryCodes: null });
  }

  /** Accepts either a TOTP code or an unused recovery code; recovery codes
   *  are hashed at rest and consumed on first use. */
  private async consumeTwoFactorCode(
    row: {
      id: string;
      twoFactorSecret: string | null;
      twoFactorRecoveryCodes: string | null;
    },
    code: string,
  ): Promise<void> {
    const trimmed = code.trim();
    if (!row.twoFactorSecret) throw unauthorized('Two-factor authentication is not set up for this account.');
    if (verifyTotpCode(row.twoFactorSecret, trimmed)) return;

    // Not a TOTP code — try the recovery codes (8-char base32, case/dash
    // tolerant).
    const normalized = normalizeRecoveryCode(trimmed);
    const stored = row.twoFactorRecoveryCodes ?? '';
    const hashes = stored ? stored.split(RECOVERY_CODE_SEPARATOR) : [];
    const target = sha256(normalized);
    if (!hashes.includes(target)) throw unauthorized('That code isn’t right — try again, or use a recovery code.');
    const remaining = hashes.filter((h) => h !== target).join(RECOVERY_CODE_SEPARATOR);
    await this.repo.updateTwoFactor(row.id, { recoveryCodes: remaining || null });
  }

  /** Mints a fresh session for an already-authenticated internal user (e.g. an
   *  invite that was just accepted). No password check — callers must have
   *  already verified the invitation. */
  async sessionForUser(userId: string): Promise<FreshSession> {
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    const user = toPublicUser(row);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
      rememberMe: false,
      userAgent: null,
    });
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

  /**
   * Changes the password for an already-authenticated user. Requires the
   * current password; revokes every other live session (optionally keeping
   * the session identified by keepRefreshTokenHash — normally the one making
   * the request — alive).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepRefreshToken?: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) throw badRequest('Password must be at least 8 characters.');
    const row = await this.repo.findUserById(userId);
    if (!row) throw unauthorized('invalid credentials');
    const ok = await verifyPassword(currentPassword, row.passwordHash);
    if (!ok) throw unauthorized('That’s not your current password — try again.');
    if (newPassword === currentPassword) throw badRequest('Your new password must be different from the current one.');

    await this.repo.updatePassword(userId, await hashPassword(newPassword));
    if (keepRefreshToken) {
      await this.repo.revokeOtherRefreshTokens(userId, sha256(keepRefreshToken));
    } else {
      await this.repo.revokeAllUserRefreshTokens(userId);
    }
  }

  /**
   * Lists the account's sessions (one row per live refresh token), newest
   * first, so users can recognize and revoke devices they no longer trust.
   */
  async listSessions(userId: string, currentRefreshToken?: string): Promise<{ sessions: SessionRow[]; currentId: string | null }> {
    return this.repo.listSessions(userId, currentRefreshToken ? sha256(currentRefreshToken) : null);
  }

  /** Revokes one of the user's own sessions. Silently ignores other users' or
   *  already-revoked sessions (idempotent). */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.repo.revokeSession(sessionId, userId);
  }

  /**
   * Starts a password reset: creates a short-lived single-use token and emails
   * the reset link. Always resolves with the same shape whether or not the
   * email exists, so the endpoint cannot be used to probe for accounts.
   * Without SMTP configured, non-production environments get the link back so
   * the flow can still be exercised before mail goes live.
   */
  async requestPasswordReset(email: string): Promise<{ emailed: boolean; devResetUrl?: string }> {
    const normalized = email.trim().toLowerCase();
    const row = await this.repo.findUserByEmail(normalized);
    if (!row) return { emailed: false };

    const rawToken = crypto.randomBytes(48).toString('base64url');
    await this.repo.createPasswordResetToken(
      row.id,
      sha256(rawToken),
      new Date(Date.now() + RESET_TOKEN_TTL_MS),
    );
    const resetUrl = `${this.opts.appUrl ?? 'http://localhost:5173'}/reset-password?token=${rawToken}`;

    if (this.mailer && (await this.mailer.isConfigured(row.tenantId))) {
      await this.mailer.send(
        row.tenantId,
        row.email,
        'Reset your Loadwave password',
        `Someone (hopefully you) asked to reset the password for ${row.email}.

Open this link within the next hour to choose a new password:

${resetUrl}

If you didn't request this, you can ignore this email — your password stays the same.`,
      );
      return { emailed: true };
    }
    return this.opts.isProd ? { emailed: false } : { emailed: false, devResetUrl: resetUrl };
  }

  /**
   * Completes a password reset: validates the token, sets the new password,
   * revokes every live session for the account and consumes the token so it
   * can never be replayed.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token) throw badRequest('reset token is required');
    if (!newPassword || newPassword.length < 8) throw badRequest('Password must be at least 8 characters.');
    const row = await this.repo.findPasswordResetToken(sha256(token));
    if (!row || row.usedAt) throw badRequest('This reset link is invalid or has already been used — request a new one.');
    if (row.expiresAt.getTime() < Date.now()) throw badRequest('This reset link has expired — request a new one.');
    if (!row.user) throw badRequest('This reset link is invalid — request a new one.');

    await this.repo.updatePassword(row.userId, await hashPassword(newPassword));
    await this.repo.revokeAllUserRefreshTokens(row.userId);
    await this.repo.markPasswordResetTokenUsed(row.id);
  }

  /**
   * Revokes a refresh token (idempotent). Used by /auth/logout so a signed-out
   * session cannot be replayed for the rest of its TTL.
   */
  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) throw badRequest('refreshToken is required');
    const row = await this.repo.findRefreshToken(sha256(refreshToken));
    if (!row || row.revokedAt) return; // already gone — nothing to do
    await this.repo.revokeRefreshToken(row.id);
  }

  async refresh(refreshToken: string, userAgent?: string | null): Promise<FreshSession> {
    if (!refreshToken) throw badRequest('refreshToken is required');
    const row = await this.repo.findRefreshToken(sha256(refreshToken));
    if (!row || row.revokedAt) throw unauthorized('refresh token invalid');
    if (row.expiresAt.getTime() < Date.now()) throw unauthorized('refresh token expired');
    if (!row.user) throw unauthorized('refresh token invalid');

    // A session that was issued with a longer TTL than the default was a
    // "remember me" session — rotation must keep that policy or active users
    // get silently forgotten a week in.
    const wasRemembered =
      row.expiresAt.getTime() - row.createdAt.getTime() > this.opts.refreshTtlSeconds * 1000;

    await this.repo.revokeRefreshToken(row.id);
    const user = toPublicUser(row.user);
    const tokens = await this.issueTokens(user.id, user.tenantId, user.roles, user.driverId, {
      rememberMe: wasRemembered,
      userAgent: userAgent ?? row.userAgent,
    });
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

  /** Records the device fingerprint and fires onSessionIssued. Never throws:
   *  device tracking is best-effort and must not fail a login. */
  private async noteDevice(
    row: { id: string; tenantId: string; email: string; roles: UserRole[] },
    userAgent?: string | null,
  ): Promise<void> {
    try {
      const ua = (userAgent ?? '').trim();
      let isNewDevice = false;
      if (ua) {
        isNewDevice = await this.repo.recordDevice(row.id, deviceFingerprint(ua));
      }
      if (this.opts.onSessionIssued) {
        await this.opts.onSessionIssued({
          tenantId: row.tenantId,
          userId: row.id,
          email: row.email,
          roles: row.roles,
          userAgent: ua || null,
          isNewDevice,
        });
      }
    } catch {
      // Tracking/alerting is best-effort — never block sign-in on it.
    }
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    roles: UserRole[],
    driverId: string | null,
    session: { rememberMe: boolean; userAgent: string | null },
  ): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccess({ sub: userId, tenantId, roles, driverId });
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    // Remember-me sessions live 30 days; everything else the configured TTL
    // (7 days by default). Rotation on refresh keeps the same policy.
    const refreshExpiresIn = session.rememberMe
      ? (this.opts.rememberedRefreshTtlSeconds ?? DEFAULT_REMEMBER_TTL_SECONDS)
      : this.opts.refreshTtlSeconds;
    await this.repo.createRefreshToken(
      userId,
      sha256(refreshToken),
      new Date(Date.now() + refreshExpiresIn * 1000),
      session.userAgent,
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
