import type { JwtUser, TwoFactorChallenge } from './auth.types';

export interface TokenServiceOptions {
  secret: string;
  expiresIn: number;
}

export interface JwtSigner {
  sign(payload: JwtUser, options?: { expiresIn?: number | string }): string;
  verify<T = unknown>(token: string): T;
}

export interface TokenService {
  signAccess(payload: Omit<JwtUser, 'type'>): string;
  verifyAccess(token: string): JwtUser;
  /** Short-lived proof that the password half of a 2FA login succeeded. */
  signTwoFactor(payload: Omit<TwoFactorChallenge, 'type'>): string;
  verifyTwoFactor(token: string): TwoFactorChallenge;
}

export class FastifyTokenService implements TokenService {
  constructor(
    private readonly jwt: JwtSigner,
    private readonly opts: TokenServiceOptions,
  ) {}

  signAccess(payload: Omit<JwtUser, 'type'>): string {
    return this.jwt.sign({ ...payload, type: 'access' }, { expiresIn: this.opts.expiresIn });
  }

  verifyAccess(token: string): JwtUser {
    return this.jwt.verify<JwtUser>(token);
  }

  signTwoFactor(payload: Omit<TwoFactorChallenge, 'type'>): string {
    // 5 minutes is plenty to open the authenticator app; anything longer just
    // widens the window for a stolen challenge token. The payload is a valid
    // JWT user-shaped object (sub + type) — the cast satisfies fastify-jwt's
    // access-token typing while keeping the twofactor claim distinct.
    return this.jwt.sign({ ...payload, type: 'twofactor' } as unknown as JwtUser, { expiresIn: 300 });
  }

  verifyTwoFactor(token: string): TwoFactorChallenge {
    const payload = this.jwt.verify<TwoFactorChallenge>(token);
    if (payload.type !== 'twofactor' || !payload.sub) {
      throw new Error('invalid two-factor challenge token');
    }
    return payload;
  }
}
