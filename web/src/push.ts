import { api } from './api';

export type AlertStatus = 'granted' | 'default' | 'denied' | 'unsupported';

/** What the browser will do if we ask for notification permission. */
export function alertStatus(): AlertStatus {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerAndSubscribe(): Promise<boolean> {
  const registration = await navigator.serviceWorker.register('/sw.js');
  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    const cfg = await api<{ enabled: boolean; publicKey: string | null }>('/api/push/config');
    if (!cfg.enabled || !cfg.publicKey) return false;
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    });
  }
  await api('/api/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.toJSON().keys?.p256dh ?? '', auth: sub.toJSON().keys?.auth ?? '' },
    },
  });
  return true;
}

/**
 * Ask for permission and wire up push for this browser. Returns true when the
 * browser is now subscribed and the backend accepted it.
 */
export async function enableLoadAlerts(): Promise<boolean> {
  if (alertStatus() === 'unsupported' || alertStatus() === 'denied') return false;
  try {
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    return await registerAndSubscribe();
  } catch {
    return false;
  }
}

/**
 * Best-effort re-sync for browsers that already granted permission — called
 * silently on app start so a subscription survives refreshes. Never prompts.
 */
const RETRY_KEY = 'loadwave.pushRetryAt';

/**
 * Best-effort re-sync for browsers that already granted permission — called
 * silently on app start so a subscription survives refreshes. Never prompts,
 * and retries at most once every 5 minutes so an unreachable push service
 * (offline ELD tablet, embedded webviews) doesn't hammer the API.
 */
export function syncPushSubscription(): void {
  if (alertStatus() !== 'granted') return;
  const retryAt = Number(localStorage.getItem(RETRY_KEY) ?? 0);
  if (Date.now() < retryAt) return;
  void registerAndSubscribe()
    .then((ok) => {
      if (ok) localStorage.removeItem(RETRY_KEY);
    })
    .catch(() => {
      localStorage.setItem(RETRY_KEY, String(Date.now() + 5 * 60_000));
    });
}