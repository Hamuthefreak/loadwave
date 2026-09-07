import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService, PasswordResetMailer } from './auth.service';
import type { UserRole } from './auth.types';

const registerSchema = {
  type: 'object',
  required: ['tenantName', 'email', 'password'],
  additionalProperties: false,
  properties: {
    tenantName: { type: 'string', minLength: 1, maxLength: 120 },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    roles: { type: 'array', items: { type: 'string', enum: ['ADMIN', 'DISPATCHER', 'DRIVER'] } },
    tenantBaseCurrency: { type: 'string', enum: ['CAD', 'USD'] },
    tenantBaseJurisdiction: { type: 'string' },
    mcNumber: { type: 'string' },
    usdotNumber: { type: 'string' },
  },
} as const;

const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
    rememberMe: { type: 'boolean' },
    // 6-digit authenticator code, or an 8-char recovery code (dashes optional).
    twoFactorCode: { type: 'string', minLength: 6, maxLength: 12 },
  },
} as const;

const twoFactorVerifySchema = {
  type: 'object',
  required: ['token', 'code'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 1 },
    code: { type: 'string', minLength: 6, maxLength: 12 },
  },
} as const;

const twoFactorCodeSchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 6, maxLength: 12 },
  },
} as const;

const changePasswordSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 1 },
    newPassword: { type: 'string', minLength: 8 },
    // Optional: keeps this session alive while revoking all the others.
    refreshToken: { type: 'string', minLength: 1 },
  },
} as const;

const refreshSchema = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string', minLength: 1 },
  },
} as const;

const forgotPasswordSchema = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
  },
} as const;

const resetPasswordSchema = {
  type: 'object',
  required: ['token', 'password'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 8 },
  },
} as const;

// Auth endpoints get a stricter per-route limit on top of the global one so a
// single IP cannot brute-force passwords or spray refresh tokens.
const authRateLimit = { max: 10, timeWindow: '1 minute' } as const;

interface RegisterBody {
  tenantName: string;
  email: string;
  password: string;
  roles?: UserRole[];
  tenantBaseCurrency?: string;
  tenantBaseJurisdiction?: string;
  mcNumber?: string;
  usdotNumber?: string;
}

interface LoginBody {
  email: string;
  password: string;
  rememberMe?: boolean;
  twoFactorCode?: string;
}

interface RefreshBody {
  refreshToken: string;
}

interface TwoFactorVerifyBody {
  token: string;
  code: string;
}

interface TwoFactorSetupPendingBody {
  token: string;
}

interface TwoFactorCodeBody {
  code: string;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
  refreshToken?: string;
}

interface SessionListBody {
  refreshToken?: string;
}

interface SessionParams {
  id: string;
}

// `app.authenticate` (preHandler) guarantees `req.user.sub` exists; the cast
// keeps the handlers' types simple alongside the body generics.
function userIdOf(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: { sub: string } }).user.sub;
}

function userAgentOf(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua.length > 0 ? ua.slice(0, 300) : null;
}

interface ForgotPasswordBody {
  email: string;
}

interface ResetPasswordBody {
  token: string;
  password: string;
}

export interface AuthModuleDeps {
  auth: AuthService;
  /** Used to email reset links (optional: without it, resets are dev-link only). */
  email?: PasswordResetMailer;
  appUrl?: string;
  isProd?: boolean;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthModuleDeps): void {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: { body: registerSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const session = await deps.auth.register({ ...req.body, userAgent: userAgentOf(req) });
      return reply.code(201).send({
        user: session.user,
        tenant: session.tenant,
        tokens: session.tokens,
      });
    },
  );

  app.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: { body: loginSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const result = await deps.auth.login({ ...req.body, userAgent: userAgentOf(req) });
      if ('requiresTwoFactor' in result) {
        // 200 on purpose: the password was right, the account just needs its
        // second factor. The client swaps the form for a code entry — or a
        // forced 2FA setup when the tenant policy mandates it for this role.
        return reply.send({
          requiresTwoFactor: true,
          twoFactorToken: result.twoFactorToken,
          ...(result.setupRequired ? { setupRequired: true } : {}),
        });
      }
      return reply.send({
        user: result.user,
        tenant: result.tenant,
        tokens: result.tokens,
      });
    },
  );

  app.post<{ Body: TwoFactorVerifyBody }>(
    '/auth/2fa/verify-login',
    {
      schema: { body: twoFactorVerifySchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: TwoFactorVerifyBody }>, reply: FastifyReply) => {
      const session = await deps.auth.verifyTwoFactorLogin(req.body.token, req.body.code, userAgentOf(req));
      return reply.send({
        user: session.user,
        tenant: session.tenant,
        tokens: session.tokens,
        // Only present on the forced-setup-at-login flow: recovery codes must
        // be shown to the user exactly once before they land in the app.
        ...(session.recoveryCodes ? { recoveryCodes: session.recoveryCodes } : {}),
      });
    },
  );

  // First half of the tenant-mandated 2FA flow: the challenge token proves the
  // password was right, so the client may fetch a fresh TOTP secret to scan.
  app.post<{ Body: TwoFactorSetupPendingBody }>(
    '/auth/2fa/setup-pending',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: { token: { type: 'string', minLength: 1 } },
        },
      },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: TwoFactorSetupPendingBody }>, reply: FastifyReply) => {
      const result = await deps.auth.setupPendingForLogin(req.body.token);
      return reply.send(result);
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/auth/refresh',
    {
      schema: { body: refreshSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      const session = await deps.auth.refresh(req.body.refreshToken, userAgentOf(req));
      return reply.send({ user: session.user, tokens: session.tokens });
    },
  );

  // --- Account security (authenticated) -----------------------------------

  app.get(
    '/auth/2fa/status',
    {
      preHandler: app.authenticate,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const result = await deps.auth.twoFactorStatus(userIdOf(req));
      return reply.send(result);
    },
  );

  app.post(
    '/auth/2fa/setup',
    {
      preHandler: app.authenticate,
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const result = await deps.auth.setupTwoFactor(userIdOf(req));
      return reply.send(result);
    },
  );

  app.post<{ Body: TwoFactorCodeBody }>(
    '/auth/2fa/enable',
    {
      schema: { body: twoFactorCodeSchema },
      preHandler: app.authenticate,
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: TwoFactorCodeBody }>, reply: FastifyReply) => {
      const result = await deps.auth.enableTwoFactor(userIdOf(req), req.body.code);
      return reply.send(result);
    },
  );

  app.post<{ Body: TwoFactorCodeBody }>(
    '/auth/2fa/disable',
    {
      schema: { body: twoFactorCodeSchema },
      preHandler: app.authenticate,
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: TwoFactorCodeBody }>, reply: FastifyReply) => {
      await deps.auth.disableTwoFactor(userIdOf(req), req.body.code);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: ChangePasswordBody }>(
    '/auth/change-password',
    {
      schema: { body: changePasswordSchema },
      preHandler: app.authenticate,
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: ChangePasswordBody }>, reply: FastifyReply) => {
      await deps.auth.changePassword(
        userIdOf(req),
        req.body.currentPassword,
        req.body.newPassword,
        req.body.refreshToken,
      );
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: SessionListBody }>(
    '/auth/sessions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { refreshToken: { type: 'string', minLength: 1 } },
        },
      },
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req: FastifyRequest<{ Body: SessionListBody }>, reply: FastifyReply) => {
      const result = await deps.auth.listSessions(userIdOf(req), req.body.refreshToken);
      return reply.send(result);
    },
  );

  app.post<{ Params: SessionParams }>(
    '/auth/sessions/:id/revoke',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      await deps.auth.revokeSession(userIdOf(req), req.params.id);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: ForgotPasswordBody }>(
    '/auth/forgot-password',
    {
      schema: { body: forgotPasswordSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: ForgotPasswordBody }>, reply: FastifyReply) => {
      const result = await deps.auth.requestPasswordReset(req.body.email);
      // Always answer the same way so the endpoint never reveals whether an
      // email is registered. When SMTP is not configured (dev), surface the
      // link so the flow remains testable before mail goes live.
      return reply.send({
        ok: true,
        emailed: result.emailed,
        ...(result.devResetUrl && !deps.isProd ? { devResetUrl: result.devResetUrl } : {}),
      });
    },
  );

  app.post<{ Body: ResetPasswordBody }>(
    '/auth/reset-password',
    {
      schema: { body: resetPasswordSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: ResetPasswordBody }>, reply: FastifyReply) => {
      await deps.auth.resetPassword(req.body.token, req.body.password);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/auth/logout',
    {
      schema: { body: refreshSchema },
      config: { rateLimit: authRateLimit },
    },
    async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
      await deps.auth.logout(req.body.refreshToken);
      return reply.send({ ok: true });
    },
  );
}
