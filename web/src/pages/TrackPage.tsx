import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IconClock, IconTruck } from '../components/icons';

/**
 * The page a broker or a receiver opens from a link, with no account and no
 * session.
 *
 * Two things shape every decision here. First, the fetch is a bare `fetch` with
 * a relative path rather than the `api` helper: the helper attaches a session
 * and bounces to the sign-in page on a 401, which is exactly wrong for someone
 * who was never meant to have an account. Second, everything shown comes from
 * the public endpoint, which carries no rates, no customer, no driver and no
 * company — so this page cannot show money even by accident, and it must not try.
 */

interface PublicStop {
  place: string;
  kind: string;
  stopOrder: number;
  scheduledAt: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  dwellMinutes: number | null;
  lateMinutes: number | null;
}

interface PublicTracking {
  reference: string;
  status: { code: 'BOOKED' | 'IN_TRANSIT' | 'DELIVERED'; label: string };
  lane: string;
  stops: PublicStop[];
  position: { lat: number; lon: number; at: string } | null;
  current: { place: string; kind: string; arrivedAt: string | null } | null;
  kmToCurrent: number | null;
  headline: string;
  updatedAt: string;
}

const STATUS_TONE: Record<PublicTracking['status']['code'], string> = {
  BOOKED: 'badge-gray',
  IN_TRANSIT: 'badge-amber',
  DELIVERED: 'badge-green',
};

const STOP_KIND: Record<string, string> = {
  ORIGIN: 'Pickup',
  INTERMEDIATE: 'Stop',
  DELIVERY: 'Delivery',
};

/** "Oct 5, 2:15 p.m." — a reader with no context needs the day, not just a time. */
function stamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

function lateness(minutes: number | null): { text: string; late: boolean } | null {
  if (minutes === null) return null;
  if (minutes === 0) return { text: 'on time', late: false };
  if (minutes > 0) return { text: `${minutes} min late`, late: true };
  return { text: `${Math.abs(minutes)} min early`, late: false };
}

function stopTimes(stop: PublicStop): { text: string; late: boolean } {
  const arrived = stamp(stop.arrivedAt);
  const departed = stamp(stop.departedAt);
  const scheduled = stamp(stop.scheduledAt);
  const late = lateness(stop.lateMinutes)?.late ?? false;

  if (arrived && departed) {
    const dwell = stop.dwellMinutes === null ? '' : ` · ${stop.dwellMinutes} min on site`;
    return { text: `Arrived ${arrived} · departed ${departed}${dwell}`, late };
  }
  if (arrived) return { text: `Arrived ${arrived} · on site now`, late };
  if (scheduled) return { text: `Booked for ${scheduled} · not reached yet`, late: false };
  return { text: 'No movement recorded here yet', late: false };
}

/** "Pickup", "Delivery", or "Stop 2" — the wording a receiver expects. */
function stopKind(stop: PublicStop): string {
  if (stop.kind === 'INTERMEDIATE') return `Stop ${stop.stopOrder}`;
  return STOP_KIND[stop.kind] ?? stop.kind;
}

export default function TrackPage() {
  const { loadId = '', token = '' } = useParams();

  const [view, setView] = useState<PublicTracking | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    (async () => {
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(loadId)}/${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`tracking link rejected (${res.status})`);
        const body = (await res.json()) as PublicTracking;
        if (!cancelled) setView(body);
      } catch {
        // A wrong token and an unknown load are the same answer on purpose, so
        // this page does not try to tell the reader which one they have.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadId, token]);

  useEffect(() => {
    document.title = view ? `Tracking — ${view.lane}` : 'Tracking — Loadwave';
  }, [view]);

  // A tracker left open on a broker's desk should keep moving, but only once
  // there is something to keep moving: a rejected link is not polled at all, and
  // a transient failure keeps the last good view instead of blanking the page.
  useEffect(() => {
    if (!view) return;
    const refresh = setInterval(() => {
      void fetch(`/api/track/${encodeURIComponent(loadId)}/${encodeURIComponent(token)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: PublicTracking | null) => {
          if (body) setView(body);
        })
        .catch(() => {
          /* keep the last good view rather than blanking the page */
        });
    }, 60_000);
    return () => clearInterval(refresh);
  }, [loadId, token, view]);

  if (loading && !view) {
    return (
      <div className="track-page">
        <p className="muted">Loading this load…</p>
      </div>
    );
  }

  if (failed || !view) {
    return (
      <div className="track-error">
        <h1>Tracking unavailable</h1>
        <p className="muted">
          This tracking link is not valid, or it has expired. Ask whoever sent it for a fresh one.
        </p>
      </div>
    );
  }

  const updated = stamp(view.updatedAt);
  const current = view.current;

  return (
    <div className="track-page">
      <div className="track-head">
        <span className="track-brand">Loadwave tracking</span>
        <span className={`badge ${STATUS_TONE[view.status.code]}`}>{view.status.label}</span>
      </div>

      <h1 className="track-lane">{view.lane}</h1>

      <div className="track-headline">
        <IconTruck size={16} className="inline-ico" /> {view.headline}
      </div>

      <div className="track-meta">
        {view.kmToCurrent !== null && current ? (
          <span>
            {view.kmToCurrent} km to {current.place}
          </span>
        ) : (
          <span>No position reported yet</span>
        )}
        {updated && (
          <span>
            <IconClock size={13} className="inline-ico" /> Updated {updated}
          </span>
        )}
      </div>

      <ul className="track-timeline">
        {view.stops.map((stop) => {
          const timing = stopTimes(stop);
          const latenessNote = lateness(stop.lateMinutes);
          const isCurrent = current !== null && stop.place === current.place;
          const done = stop.departedAt !== null;
          const classes = [
            'track-stop',
            done ? 'track-stop--done' : '',
            !done && isCurrent ? 'track-stop--current' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={`${stop.stopOrder}-${stop.place}`} className={classes}>
              <span className="track-stop__marker" aria-hidden />
              <span className="track-stop__kind">{stopKind(stop)}</span>
              <span className="track-stop__place">{stop.place}</span>
              <span className="track-stop__times">
                <span className={timing.late ? 'track-stop__late' : undefined}>{timing.text}</span>
                {latenessNote ? ` · ${latenessNote.text}` : null}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="track-footnote">
        Positions come from the truck's own ELD and are rounded before they are shown here. The
        arrived and departed times are worked out from those positions, so a stop can read as
        reached before the driver has phoned it in — and a stop with no position nearby stays
        blank rather than guessed. This page refreshes about once a minute.
      </p>
    </div>
  );
}
