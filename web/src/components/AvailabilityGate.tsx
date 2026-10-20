import { useEffect, useState, type ReactNode } from 'react';
import AuthLayout from './AuthLayout';

/**
 * The country gate.
 *
 * The server resolves the visitor's country from the request address and
 * decides whether Loadwave is offered there. This component asks once on
 * mount and, when the answer is a definite "no", replaces the whole app with
 * the notice instead of letting someone fill in a signup that cannot be
 * supported.
 *
 * Two deliberate behaviours:
 *  - a failed or not-yet-finished check renders the app (fail open), because a
 *    geo provider outage must not take the product down;
 *  - the notice is built on the auth shell, so it carries the same brand,
 *    theme support and version stamp as the rest of the unauthenticated
 *    screens.
 */

export const UNAVAILABLE_MESSAGE = 'LoadWave is not currently available in your country.';

export interface Availability {
  country: string | null;
  region: 'north-america' | 'europe' | null;
  available: boolean;
  checked: boolean;
}

export type AvailabilityCheck = (signal?: AbortSignal) => Promise<Availability | null>;

export async function fetchAvailability(signal?: AbortSignal): Promise<Availability | null> {
  try {
    const response = await fetch('/api/availability', {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<Availability>;
    if (typeof body.available !== 'boolean') return null;
    return {
      country: typeof body.country === 'string' ? body.country : null,
      region:
        body.region === 'north-america' || body.region === 'europe' ? body.region : null,
      available: body.available,
      checked: body.checked === true,
    };
  } catch {
    // Unknown is not the same as blocked.
    return null;
  }
}

export default function AvailabilityGate({
  children,
  check = fetchAvailability,
}: {
  children: ReactNode;
  check?: AvailabilityCheck;
}) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    check(controller.signal)
      .then((result) => {
        if (!alive || !result) return;
        if (result.checked && !result.available) setBlocked(true);
      })
      .catch(() => {
        /* fail open */
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [check]);

  if (blocked) {
    return (
      <AuthLayout>
        <h1 className="ld-auth-title">{UNAVAILABLE_MESSAGE}</h1>
        <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
          Loadwave is available in North America and Europe. If you are using a VPN, turn it off
          and try again.
        </p>
      </AuthLayout>
    );
  }

  return <>{children}</>;
}
