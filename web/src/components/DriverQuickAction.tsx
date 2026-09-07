import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getTokenUser } from '../api';
import { setDuty, useDuty } from '../duty-store';
import { FuelLogModal } from './FuelLogger';
import { Modal } from './ui';
import { km, money, regionLabel } from '../utils/format';

interface MiniTrip {
  id: string;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  status: string;
  freightCurrency: string;
  freightAmountBase: string | null;
  freightAmountTransaction: string | null;
  distanceKmEstimate: string | null;
}

type Notice = { kind: 'ok' | 'err'; text: string } | null;

function laneOf(t: MiniTrip): string {
  return `${regionLabel(t.originRegion)} → ${regionLabel(t.destinationRegion)}`;
}

/**
 * Driver quick actions, floating above the mobile bottom nav so they're
 * reachable from the dashboard without scrolling:
 *
 *   Primary FAB (one tap):
 *     - Off duty                  → "Go on duty"
 *     - On duty + assigned load   → "Start trip"      (confirm modal)
 *     - On duty, in transit       → "Mark delivered"  (confirm modal)
 *     - On duty, nothing assigned → "Find loads"      (jump to the board)
 *
 *   Shortcut dock (above the FAB):
 *     - Log fuel  (opens the cab-side fuel form)
 *     - My trips  (jump to the trips page)
 *
 * Hidden for suspended drivers and on desktop (the sidebar has the duty
 * toggle). Duty flips stay one-tap — they're instantly reversible toggles —
 * while trip transitions always ask for confirmation.
 */
export default function DriverQuickAction() {
  const user = useMemo(() => getTokenUser(), []);
  const duty = useDuty();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<MiniTrip[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<'start' | 'deliver' | null>(null);
  const [confirmDuty, setConfirmDuty] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const loadTrips = useCallback(async () => {
    try {
      setTrips(await api<MiniTrip[]>('/api/loads/mine'));
    } catch {
      /* keep last known list */
    }
  }, []);

  // Keep the assigned-load state fresh: on mount, whenever the tab regains
  // focus (dispatch may have assigned something), and every 45s.
  useEffect(() => {
    void loadTrips();
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadTrips();
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => void loadTrips(), 45_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [loadTrips]);

  useEffect(() => {
    // A duty flip can surface an assigned load that was fetched before it.
    if (duty === 'ACTIVE') void loadTrips();
  }, [duty, loadTrips]);

  const flash = (n: Notice, ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    setNotice(n);
    timer.current = window.setTimeout(() => setNotice(null), ms);
  };

  const goOnDuty = async () => {
    if (busy || !user?.driverId) return;
    setBusy(true);
    try {
      await api('/api/drivers/me/status', { method: 'PATCH', body: { status: 'ACTIVE' } });
      setDuty('ACTIVE');
    } catch {
      flash({ kind: 'err', text: "Couldn't go on duty — try again" }, 2600);
    } finally {
      setBusy(false);
    }
  };

  const runTripAction = async (trip: MiniTrip, status: 'IN_TRANSIT' | 'DELIVERED', okMsg: string) => {
    if (busy) return;
    setBusy(true);
    setConfirm(null);
    try {
      await api(`/api/loads/${trip.id}/status`, { method: 'PATCH', body: { status } });
      // Keep the trip in the local list with its new status so the FAB can
      // immediately offer the next step (Mark delivered after starting, etc.).
      setTrips((cur) => (cur ?? []).map((t) => (t.id === trip.id ? { ...t, status } : t)));
      flash({ kind: 'ok', text: okMsg }, 2000);
    } catch {
      flash({ kind: 'err', text: "Couldn't update — try again" }, 2600);
    } finally {
      setBusy(false);
    }
  };

  if (!user?.driverId || duty == null || duty === 'SUSPENDED') return null;

  const onDuty = duty === 'ACTIVE';
  const assigned = (trips ?? []).find((t) => t.status === 'ASSIGNED');
  const inTransit = (trips ?? []).find((t) => t.status === 'IN_TRANSIT');
  const confirmTrip = confirm ? (assigned ?? inTransit) ?? null : null;
  const started = notice?.kind === 'ok';

  let label: string;
  let sub: string | null = null;
  let action: () => void;
  let tone = '';
  let iconDot = true;

  if (notice?.kind === 'err') {
    label = notice.text;
    action = !onDuty ? goOnDuty : () => setConfirm(assigned ? 'start' : inTransit ? 'deliver' : null);
    tone = ' driver-fab-err';
  } else if (!onDuty) {
    label = 'Go on duty';
    action = () => setConfirmDuty(true);
  } else if (assigned) {
    label = 'Start trip';
    sub = laneOf(assigned);
    action = () => setConfirm('start');
  } else if (inTransit) {
    label = 'Mark delivered';
    sub = laneOf(inTransit);
    action = () => setConfirm('deliver');
  } else if (started) {
    label = notice?.text ?? 'Done';
    action = () => {};
    iconDot = false;
  } else {
    label = 'Find loads';
    sub = 'Nothing assigned right now';
    action = () => navigate('/app/board');
    iconDot = false;
  }

  const disabled = busy || (started && !assigned && !inTransit);

  return (
    <>
      <div className="driver-dock" aria-label="Quick shortcuts">
        <button
          type="button"
          className="driver-dock-btn"
          onClick={() => setFuelOpen(true)}
        >
          <FuelIcon />
          <span>Log fuel</span>
        </button>
        <button
          type="button"
          className="driver-dock-btn"
          onClick={() => navigate('/app/trips')}
        >
          <RouteIcon />
          <span>My trips</span>
        </button>
      </div>

      <button
        type="button"
        className={`driver-fab${tone}`}
        onClick={action}
        disabled={disabled}
        aria-live="polite"
        aria-label={`${label}${sub ? ` — ${sub}` : ''}`}
      >
        {iconDot && <span className="driver-fab-dot" aria-hidden />}
        <span className="driver-fab-label">
          <span>{label}</span>
          {sub && <span className="driver-fab-sub">{sub}</span>}
        </span>
      </button>

      <Modal
        open={confirmDuty}
        onClose={() => setConfirmDuty(false)}
        title="Go on duty?"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmDuty(false)}>Not yet</button>
            <button
              className="btn-green"
              disabled={busy}
              onClick={() => {
                setConfirmDuty(false);
                void goOnDuty();
              }}
            >
              {busy ? 'Updating…' : 'Go on duty'}
            </button>
          </>
        }
      >
        <p className="muted" style={{ margin: 0 }}>
          You'll show as <strong>available</strong> to dispatch — assigned loads can come your
          way, and time on duty counts against your HOS cycle.
        </p>
      </Modal>

      <Modal
        open={confirm !== null && confirmTrip !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'deliver' ? 'Mark delivered?' : 'Start this trip?'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirm(null)}>Not yet</button>
            <button
              className="btn-green"
              disabled={busy}
              onClick={() =>
                confirmTrip && void runTripAction(
                  confirmTrip,
                  confirm === 'deliver' ? 'DELIVERED' : 'IN_TRANSIT',
                  confirm === 'deliver' ? 'Delivered — nice run!' : 'Trip started — drive safe',
                )
              }
            >
              {busy ? 'Confirming…' : confirm === 'deliver' ? 'Delivered' : 'Start trip'}
            </button>
          </>
        }
      >
        {confirmTrip && (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              {confirm === 'deliver' ? (
                <>
                  This tells dispatch the freight is off your truck at{' '}
                  <strong>{laneOf(confirmTrip)}</strong> — they'll take it from here
                  (invoice time).
                </>
              ) : (
                <>
                  Rolling out on <strong>{laneOf(confirmTrip)}</strong> tells dispatch you're
                  on the way with the load.
                </>
              )}
            </p>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {money(
                confirmTrip.freightAmountBase ?? confirmTrip.freightAmountTransaction,
                confirmTrip.freightCurrency,
              )}
              {confirmTrip.distanceKmEstimate ? ` · ${km(confirmTrip.distanceKmEstimate)}` : ''}
            </p>
          </div>
        )}
      </Modal>

      <FuelLogModal
        open={fuelOpen}
        onClose={() => setFuelOpen(false)}
        onLogged={() => {
          setFuelOpen(false);
          // Tell the dashboard's fuel card to refresh.
          window.dispatchEvent(new Event('loadwave:fuel-logged'));
        }}
      />
    </>
  );
}

function FuelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17M3 21h12M13 8h3a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-2.5-2.5M6.5 7h5" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V4M4 5h16l-3 3.5L20 12H4" />
    </svg>
  );
}