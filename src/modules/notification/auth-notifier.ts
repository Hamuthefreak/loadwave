import type { SessionIssuedInfo } from '../auth/auth.service';
import type { NotificationService } from './notification.service';

export interface AuthNotifierDeps {
  notifications: NotificationService;
  logger?: { warn(obj: unknown, msg?: string): void };
}

/** Human-readable device label from a User-Agent string, matching the one the
 *  Sessions page shows ("Chrome on Windows", "iPhone Safari", …). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'a browser';
  const os = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('Mac OS') || ua.includes('Macintosh')
      ? 'macOS'
      : ua.includes('iPhone')
        ? 'iPhone'
        : ua.includes('iPad')
          ? 'iPad'
          : ua.includes('Android')
            ? 'Android'
            : ua.includes('Linux')
              ? 'Linux'
              : '';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : '';
  return [browser, os].filter(Boolean).join(' on ') || 'a browser';
}

/**
 * Alerts on sign-ins from previously unseen devices: an in-app notification
 * (scoped to the user) plus an email when SMTP is configured. Only fires when
 * isNewDevice — routine sign-ins from known devices stay silent.
 */
export async function onSessionIssued(
  deps: AuthNotifierDeps,
  info: SessionIssuedInfo,
): Promise<void> {
  if (!info.isNewDevice) return;
  try {
    const label = deviceLabel(info.userAgent);
    await deps.notifications.notify({
      tenantId: info.tenantId,
      userId: info.userId,
      kind: 'auth',
      title: 'New sign-in from an unfamiliar device',
      body: `Your account was signed in from ${label}. If that wasn't you, change your password and revoke the session under Settings & security.`,
      link: '/app/settings',
      email: true,
      emailTo: info.email,
    });
  } catch (err) {
    // Best-effort: the sign-in itself already succeeded.
    deps.logger?.warn({ err, userId: info.userId }, 'new-device alert failed');
  }
}