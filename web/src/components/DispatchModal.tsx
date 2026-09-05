import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Modal } from './ui';
import { regionLabel } from '../utils/format';

export interface DispatchLoad {
  id: string;
  originCountry: string;
  originRegion: string;
  originLocality: string | null;
  destinationCountry: string;
  destinationRegion: string;
  destinationLocality: string | null;
  status: string;
  marketplaceStatus: string;
  bookedByTenantId: string | null;
  assigneeDriverId: string | null;
  assigneeAssetId: string | null;
  bookedAt: string | null;
}

export interface DispatchDriver {
  id: string;
  name: string;
  status: string;
}

export interface DispatchAsset {
  id: string;
  powerUnitNumber: string | null;
  assetType: string;
  vin: string | null;
}

export function laneOf(l: Pick<DispatchLoad, 'originCountry' | 'originRegion' | 'originLocality' | 'destinationCountry' | 'destinationRegion' | 'destinationLocality'>): string {
  const from = l.originLocality ? `${l.originLocality}, ${regionLabel(l.originRegion)}` : regionLabel(l.originRegion);
  const to = l.destinationLocality ? `${l.destinationLocality}, ${regionLabel(l.destinationRegion)}` : regionLabel(l.destinationRegion);
  return `${from} → ${to}`;
}

function assetLabel(a: DispatchAsset): string {
  const number = a.powerUnitNumber ? ` · ${a.powerUnitNumber}` : '';
  return `${a.assetType === 'TRACTOR' ? 'Tractor' : 'Trailer'}${number}`;
}

// Cycle snapshot from GET /api/hos/overview, used to show remaining hours next
// to each driver so dispatchers don't hand trips to exhausted drivers.
interface HosMini {
  driverId: string;
  remaining7: number | null;
  warnings: string[];
  violations: string[];
}

function hoursShort(hours: number | null | undefined): string {
  const h = Number(hours ?? 0);
  if (!Number.isFinite(h) || h <= 0) return '0h';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins >= 60) return `${whole + 1}h`;
  if (whole >= 10) return `${whole}h`;
  return mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
}

function hosSuffix(hos: Record<string, HosMini>, driverId: string): string | null {
  const r = hos[driverId];
  if (!r) return null;
  const hours = r.remaining7 != null ? `${hoursShort(r.remaining7)} left (7d)` : null;
  const note = r.violations.length > 0 ? 'at limit' : r.warnings.length > 0 ? 'near limit' : null;
  if (hours && note) return `${hours} · ${note}`;
  return hours ?? note;
}

function canUnassign(load: DispatchLoad | null): boolean {
  if (!load) return false;
  return load.status !== 'IN_TRANSIT' && load.status !== 'DELIVERED' && load.status !== 'INVOICED';
}

/**
 * Dispatch a load to a driver + unit (or unassign). Two entry points:
 * - `load` focus: pick a driver/unit for a specific load (My Loads).
 * - `driver` focus: pick which load to hand to a specific driver (Drivers page).
 */
export default function DispatchModal({
  open,
  onClose,
  onSaved,
  load,
  driver,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  load?: DispatchLoad | null;
  driver?: DispatchDriver | null;
}) {
  const loadFocus = !!load;
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [assets, setAssets] = useState<DispatchAsset[]>([]);
  const [loads, setLoads] = useState<DispatchLoad[]>([]);
  const [hos, setHos] = useState<Record<string, HosMini>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [driverId, setDriverId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [loadId, setLoadId] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setDriverId(load ? (load.assigneeDriverId ?? '') : (driver?.id ?? ''));
    setAssetId(load ? (load.assigneeAssetId ?? '') : '');
    setLoadId(load?.id ?? '');

    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const [d, a, ov] = await Promise.all([
          api<DispatchDriver[]>('/api/drivers'),
          api<DispatchAsset[]>('/api/assets'),
          api<HosMini[]>('/api/hos/overview').catch(() => [] as HosMini[]),
        ]);
        if (!alive) return;
        setDrivers(d);
        setAssets(a);
        setHos(Object.fromEntries(ov.map((r) => [r.driverId, r])));
        if (!load && driver) {
          const ls = await api<DispatchLoad[]>('/api/loads');
          if (!alive) return;
          setLoads(ls);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load dispatch options');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [open, load, driver]);

  // In driver focus, the pickable pool: loads the company can still hand out —
  // private company freight that is open/dispatched, or anything already on
  // this driver (so it can be reassigned or unassigned).
  const candidates = useMemo(() => {
    if (loadFocus || !driver) return [];
    return loads.filter(
      (l) =>
        !l.bookedByTenantId &&
        ['OPEN', 'ASSIGNED', 'IN_TRANSIT'].includes(l.status) &&
        (l.marketplaceStatus === 'PRIVATE' || l.assigneeDriverId === driver.id),
    );
  }, [loads, loadFocus, driver]);

  const targetLoad: DispatchLoad | null = loadFocus
    ? (load ?? null)
    : (loads.find((l) => l.id === loadId) ?? null);

  const changed =
    targetLoad &&
    (loadFocus
      ? (driverId || null) !== targetLoad.assigneeDriverId || (assetId || null) !== targetLoad.assigneeAssetId
      : !!loadId);

  const pickLoad = (id: string) => {
    setLoadId(id);
    const picked = loads.find((l) => l.id === id);
    setAssetId(picked?.assigneeAssetId ?? '');
  };

  const save = async (nextDriverId: string | null, nextAssetId: string | null) => {
    if (!targetLoad || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/loads/${targetLoad.id}/assign`, {
        method: 'PATCH',
        body: { driverId: nextDriverId, assetId: nextAssetId },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed — try again');
      setBusy(false);
    }
  };

  const removeable = targetLoad && !!targetLoad.assigneeDriverId && canUnassign(targetLoad);
  const current = targetLoad
    ? targetLoad.assigneeDriverId
      ? `${drivers.find((d) => d.id === targetLoad?.assigneeDriverId)?.name ?? 'Assigned driver'}${targetLoad.assigneeAssetId ? ` · ${assets.find((a) => a.id === targetLoad?.assigneeAssetId) ? assetLabel(assets.find((a) => a.id === targetLoad?.assigneeAssetId)!) : ''}` : ''}`
      : 'No driver assigned'
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={loadFocus ? 'Dispatch load' : 'Assign a load'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          {removeable && (
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => void save(null, null)}
              style={{ color: 'var(--red)' }}
            >
              Remove assignment
            </button>
          )}
          <button
            className="btn-green"
            disabled={busy || loading || !changed}
            onClick={() => void save(driverId || null, assetId || null)}
          >
            {busy ? 'Saving…' : loadFocus ? (targetLoad?.assigneeDriverId ? 'Update assignment' : 'Dispatch load') : 'Assign to driver'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}>
        {loadFocus && load ? (
          <div className="muted small" style={{ fontWeight: 700 }}>
            {laneOf(load)}
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>{load.status}</span>
          </div>
        ) : (
          driver && (
            <div className="muted small" style={{ fontWeight: 700 }}>
              {driver.name}
              <span className={`badge ${driver.status === 'ACTIVE' ? 'badge-green' : driver.status === 'SUSPENDED' ? 'badge-red' : 'badge-gray'}`} style={{ marginLeft: 8 }}>
                {driver.status === 'ACTIVE' ? 'On duty' : driver.status === 'OFF_DUTY' ? 'Off duty' : driver.status}
              </span>
              {hosSuffix(hos, driver.id) && (
                <span style={{ marginLeft: 8, color: 'var(--faint)' }}>· {hosSuffix(hos, driver.id)}</span>
              )}
            </div>
          )
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading options…</span></div>
      )}

      {!loading && (
        <>
          {current && (
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Currently: <strong>{current}</strong>
            </p>
          )}

          <div className="form-grid">
            {!loadFocus && (
              <label>
                Load
                <select value={loadId} onChange={(e) => pickLoad(e.target.value)}>
                  <option value="">— Choose a load —</option>
                  {candidates.map((l) => (
                    <option key={l.id} value={l.id}>
                      {laneOf(l)}{l.assigneeDriverId ? ' (assigned)' : ''}
                    </option>
                  ))}
                </select>
                {candidates.length === 0 && (
                  <span className="muted small">No dispatchable loads — post a private load under My Loads first.</span>
                )}
              </label>
            )}
            <label>
              Driver
              <select
                value={driverId}
                disabled={!loadFocus && !!driver}
                onChange={(e) => setDriverId(e.target.value)}
              >
                {!loadFocus && <option value="">— {driver ? driver.name : 'Choose a driver'} —</option>}
                {drivers.map((d) => {
                  const suffix = hosSuffix(hos, d.id);
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.status !== 'ACTIVE' ? ` (${d.status === 'OFF_DUTY' ? 'off duty' : d.status})` : ''}
                      {suffix ? ` — ${suffix}` : ''}
                    </option>
                  );
                })}
              </select>
              {drivers.length === 0 && (
                <span className="muted small">No drivers yet — add one on the Drivers page first.</span>
              )}
            </label>
            <label>
              Unit
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">— No unit —</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{assetLabel(a)}</option>
                ))}
              </select>
              {assets.length === 0 && (
                <span className="muted small">No equipment in the fleet — add a tractor under Fleet.</span>
              )}
            </label>
          </div>

          {!loadFocus && targetLoad && (
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              Assigning flips the load from OPEN to ASSIGNED — it will appear in{' '}
              <strong>{drivers.find((d) => d.id === driverId)?.name ?? 'the driver'}'s My Trips</strong> right away.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
