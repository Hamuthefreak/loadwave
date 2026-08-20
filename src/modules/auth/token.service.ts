import type { JwtUser } from './auth.types';

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
}
