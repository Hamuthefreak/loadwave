import envSchema from 'env-schema';

export interface AppEnv {
  NODE_ENV: string;
  PORT: number;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: number;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_TTL: number;
  /** TTL (seconds) for "remember me" sessions. Default 30 days. */
  JWT_REMEMBER_TTL: number;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ELD_WEBHOOK_SECRET: string;
  IFTA_JURISDICTION_RATES: string;
  LNG: 'en' | 'fr';
  LNG_COUNTRY: string;
  SMTP_URL: string;
  MAIL_FROM: string;
  DIAGNOSTICS_ADMIN_KEY: string;
  DIAGNOSTICS_KEY_FILE: string;
  /** Comma-separated allowed origins; empty = same-origin only (no CORS). */
  CORS_ORIGIN: string;
  /** Public app base URL used in emailed links (password reset, invites). */
  APP_URL: string;
  /** Web Push VAPID keys — empty disables push delivery (bell still works). */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** Contact for the push service (mailto: preferred). */
  VAPID_SUBJECT: string;
}

const schema = {
  type: 'object',
  required: ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
  properties: {
    NODE_ENV: { type: 'string', default: 'development' },
    PORT: { type: 'integer', default: 4000 },
    LOG_LEVEL: { type: 'string', default: 'info' },
    DATABASE_URL: { type: 'string', minLength: 1 },
    JWT_ACCESS_SECRET: { type: 'string', minLength: 16 },
    JWT_ACCESS_TTL: { type: 'integer', default: 900 },
    JWT_REFRESH_SECRET: { type: 'string', minLength: 16 },
    JWT_REFRESH_TTL: { type: 'integer', default: 604800 },
    JWT_REMEMBER_TTL: { type: 'integer', default: 2592000 },
    JWT_ISSUER: { type: 'string', default: 'loadwave' },
    JWT_AUDIENCE: { type: 'string', default: 'loadwave-clients' },
    ELD_WEBHOOK_SECRET: { type: 'string', default: '' },
    IFTA_JURISDICTION_RATES: { type: 'string', default: '' },
    SMTP_URL: { type: 'string', default: '' },
    MAIL_FROM: { type: 'string', default: '' },
    DIAGNOSTICS_ADMIN_KEY: { type: 'string', default: '' },
    DIAGNOSTICS_KEY_FILE: { type: 'string', default: '' },
    CORS_ORIGIN: { type: 'string', default: '' },
    APP_URL: { type: 'string', default: 'http://localhost:5173' },
    VAPID_PUBLIC_KEY: { type: 'string', default: '' },
    VAPID_PRIVATE_KEY: { type: 'string', default: '' },
    VAPID_SUBJECT: { type: 'string', default: 'mailto:ops@loadwave.app' },
    LNG: { type: 'string', enum: ['en', 'fr'], default: 'en' },
    LNG_COUNTRY: { type: 'string', default: 'CA' },
  },
} as const;

export function loadEnv(overrides: Partial<Record<string, string>> = {}): AppEnv {
  const env = envSchema({
    schema,
    data: { ...process.env, ...overrides },
    dotenv: true,
  }) as AppEnv;
  return env;
}
