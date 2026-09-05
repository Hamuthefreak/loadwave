import nodemailer, { type Transporter } from 'nodemailer';
import type { PrismaClient } from '@prisma/client';

export interface SmtpSettings {
  enabled: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
}

export interface EmailService {
  /** Resolves SMTP settings for a tenant (tenant overrides → env defaults). */
  settings(tenantId: string): Promise<SmtpSettings>;
  /** Persists SMTP settings for a tenant. */
  save(tenantId: string, patch: Partial<SmtpSettings>): Promise<SmtpSettings>;
  /** Sends an email if SMTP is configured; otherwise resolves to a no-op. */
  send(tenantId: string, to: string, subject: string, text: string): Promise<void>;
  /** True when SMTP is fully configured (for UI hints / test). */
  isConfigured(tenantId: string): Promise<boolean>;
}

const SETTING_KEY = 'smtp';

export function tenantEmail(prisma: PrismaClient): (tenantId: string) => Promise<string | null> {
  return async (tenantId) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { users: { take: 1, select: { email: true } } },
    });
    return tenant?.users?.[0]?.email ?? null;
  };
}

/**
 * SMTP-backed email sender. Tenants can configure their own SMTP server from
 * the Settings page (stored in TenantSetting); when nothing is configured the
 * service falls back to the SMTP_URL + MAIL_FROM env vars and, if neither is
 * present, silently no-ops (in-app notifications still work).
 */
export class PrismaEmailService implements EmailService {
  private readonly cache = new Map<string, SmtpSettings | null>();
  private readonly envSettings: SmtpSettings;

  constructor(
    private readonly prisma: PrismaClient,
    env: { SMTP_URL?: string; MAIL_FROM?: string },
  ) {
    this.envSettings = env.SMTP_URL
      ? { enabled: true, from: env.MAIL_FROM ?? 'dispatch@loadwave.app', ...parseUrl(env.SMTP_URL) }
      : { enabled: false };
  }

  async settings(tenantId: string): Promise<SmtpSettings> {
    if (this.cache.has(tenantId)) return { ...(this.cache.get(tenantId) ?? this.envSettings) } as SmtpSettings;
    const row = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    let settings: SmtpSettings = this.envSettings;
    if (row?.valueJson) {
      try {
        const parsed = JSON.parse(row.valueJson) as Partial<SmtpSettings>;
        settings = { ...settings, ...parsed, enabled: parsed.enabled ?? settings.enabled };
      } catch {
        settings = settings;
      }
    }
    this.cache.set(tenantId, settings);
    return settings;
  }

  async isConfigured(tenantId: string): Promise<boolean> {
    const s = await this.settings(tenantId);
    return Boolean(s.enabled && s.host);
  }

  async send(tenantId: string, to: string, subject: string, text: string): Promise<void> {
    const settings = await this.settings(tenantId);
    if (!settings.enabled || !settings.host) return; // graceful no-op
    let transport: Transporter;
    try {
      transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port ?? 587,
        secure: settings.secure ?? settings.port === 465,
        auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
      });
      await transport.sendMail({
        from: settings.from ?? 'dispatch@loadwave.app',
        to,
        subject,
        text,
      });
    } catch {
      // Best-effort: never break the request flow because mail failed.
    }
  }

  async save(tenantId: string, patch: Partial<SmtpSettings>): Promise<SmtpSettings> {
    const current = await this.settings(tenantId);
    const next: SmtpSettings = { ...current, ...patch };
    this.cache.delete(tenantId);
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      update: { valueJson: JSON.stringify(next) },
      create: { tenantId, key: SETTING_KEY, valueJson: JSON.stringify(next) },
    });
    this.cache.delete(tenantId);
    return next;
  }
}

function parseUrl(url: string): { host?: string; port?: number; secure?: boolean; user?: string; password?: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || undefined,
      port: u.port ? Number(u.port) : undefined,
      secure: u.protocol === 'smtps:',
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return {};
  }
}