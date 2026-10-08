import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Notice } from './Notice';
import { IconClock, IconFuel, IconInfo, IconTruck } from './icons';
import { Modal } from './ui';
import { km, money } from '../utils/format';

/**
 * What each unit costs to run, and the fixed cost behind the number.
 *
 * The interesting part of this panel is not the division — it is that the
 * figures arrive with a list of what they leave out. A cost per mile that
 * quietly omits maintenance and tolls reads as the whole truth, and an owner
 * who prices a lane off it loses money, so the omissions are rendered as
 * prominently as the numbers they qualify.
 */

export interface CostPerMile {
  currency: string;
  buckets: { fuel: number; fixed: number };
  totalCost: number;
  loadedKm: number;
  emptyKm: number;
  totalKm: number;
  costPerMile: number | null;
  costPerLoadedMile: number | null;
  emptyRatio: number | null;
  detentionRecovered: number;
  detentionMinutes: number;
  excludedCosts: string[];
  mileageBasis: 'ASSIGNMENT_WINDOW';
}

export interface UnitCost {
  unit: { id: string; label: string; assetType: string };
  cost: CostPerMile;
  declared: { centsPerDay: number; note?: string } | null;
}

export interface FleetCost {
  window: { from: string; to: string; days: number };
  fleet: CostPerMile;
  units: UnitCost[];
  declared: Record<string, { centsPerDay: number; note?: string }>;
}

/** Spelled out, because a chip that repeats the server's enum explains nothing. */
const OMISSION_LABELS: Record<string, string> = {
  MAINTENANCE: 'Maintenance not counted — no repair records yet',
  TOLLS: 'Tolls not counted — no toll feed connected',
};

function omissionLabel(code: string): string {
  return OMISSION_LABELS[code] ?? `${code.toLowerCase()} not counted`;
}

/** A per-mile rate, or the reason there isn't one. */
function rate(value: number | null, why: string): string {
  return value === null ? why : money(value);
}

function percent(value: number | null, why: string): string {
  return value === null ? why : `${Math.round(value * 100)}%`;
}

export default function CostPanel() {
  const [data, setData] = useState<FleetCost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<UnitCost | null>(null);
  const [dollarsPerDay, setDollarsPerDay] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<FleetCost>('/api/costs/per-mile'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cost per mile is unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row: UnitCost) => {
    setEditing(row);
    setEditError(null);
    setDollarsPerDay(row.declared ? (row.declared.centsPerDay / 100).toFixed(2) : '');
    setNote(row.declared?.note ?? '');
  };

  /**
   * Zero is the clear signal the server understands, so an empty field and a
   * typed zero mean the same thing here rather than two different outcomes.
   */
  const save = async (clear: boolean) => {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const parsed = clear ? 0 : Number(dollarsPerDay);
      if (!clear && (!Number.isFinite(parsed) || parsed < 0)) {
        setEditError('Enter a daily amount in dollars, for example 185.50');
        return;
      }
      const result = await api<{ declared: FleetCost['declared'] }>(
        `/api/costs/declared/${editing.unit.id}`,
        { method: 'PUT', body: { centsPerDay: Math.round(parsed * 100), note: note.trim() || undefined } },
      );
      setData((current) => (current ? { ...current, declared: result.declared } : current));
      setEditing(null);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not save the fixed cost');
    } finally {
      setSaving(false);
    }
  };

  const fleet = data?.fleet;
  const windowLabel = data ? `Last ${data.window.days} days` : '';

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3>Cost per mile</h3>

      {loading && !data ? (
        <div className="spinner-wrap">
          <span className="spinner" aria-hidden />
          <span className="muted small">Working out what the trucks cost…</span>
        </div>
      ) : !data || !fleet ? (
        // The failure is named exactly: a 403 means the report needs an office
        // account and a dropped request means the request dropped. Guessing
        // between them would teach the owner to distrust the panel.
        <Notice tone="warn" title="Cost per mile could not be loaded">
          {error ?? 'This report needs an office (admin or dispatcher) account.'}
        </Notice>
      ) : (
        <>
          <div className="cost-panel">
            <div className="cost-stat">
              <span className="cost-stat__label">Cost per loaded mile</span>
              <span className="cost-stat__value">
                {rate(fleet.costPerLoadedMile, 'No loaded miles')}
              </span>
              <span className="cost-stat__sub">
                {fleet.costPerLoadedMile === null
                  ? 'Nothing ran under an assigned load in this window'
                  : `Every dollar spent spread over ${km(fleet.loadedKm)}, ${windowLabel.toLowerCase()}`}
              </span>
            </div>

            <div className="cost-stat">
              <span className="cost-stat__label">Cost per mile</span>
              <span className="cost-stat__value">{rate(fleet.costPerMile, 'No movement')}</span>
              <span className="cost-stat__sub">
                {fleet.costPerMile === null
                  ? 'No distance was recorded in this window'
                  : `Loaded and empty together — ${km(fleet.totalKm)}`}
              </span>
            </div>

            <div className="cost-stat">
              <span className="cost-stat__label">Ran empty</span>
              <span className="cost-stat__value">{percent(fleet.emptyRatio, 'No movement')}</span>
              <span className="cost-stat__sub">
                {fleet.emptyRatio === null
                  ? 'Nothing to divide by yet'
                  : `${km(fleet.emptyKm)} empty of ${km(fleet.totalKm)}`}
              </span>
            </div>

            <div className="cost-stat">
              <span className="cost-stat__label">
                <IconClock size={12} className="inline-ico" /> Detention recovered
              </span>
              <span className="cost-stat__value">{money(fleet.detentionRecovered, fleet.currency)}</span>
              <span className="cost-stat__sub">
                {fleet.detentionMinutes > 0
                  ? `${(fleet.detentionMinutes / 60).toFixed(1)} h on a clock — revenue, not a cost`
                  : 'No detention clock ran in this window'}
              </span>
            </div>

            <div className="cost-stat">
              <span className="cost-stat__label">
                <IconFuel size={12} className="inline-ico" /> Fuel bought
              </span>
              <span className="cost-stat__value">{money(fleet.buckets.fuel, fleet.currency)}</span>
              <span className="cost-stat__sub">
                Declared fixed {money(fleet.buckets.fixed, fleet.currency)} · {windowLabel}
              </span>
            </div>
          </div>

          <div className="cost-omissions">
            {fleet.excludedCosts.map((code) => (
              <span className="cost-omission" key={code}>
                {omissionLabel(code)}
              </span>
            ))}
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>
            A kilometre counts as loaded only while a load was assigned to the unit, so a truck
            running home on a live trip is counted as loaded. Treat the figure as close, not
            exact — and read it against the omissions above.
          </p>

          {data.units.length === 0 ? (
            <p className="muted small">
              No power units yet. Add one below and its fuel and distance will start counting here.
            </p>
          ) : (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Per loaded mile</th>
                    <th>Per mile</th>
                    <th>Loaded / empty</th>
                    <th>Fixed cost</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.units.map((row) => (
                    <tr key={row.unit.id}>
                      <td>
                        <strong>{row.unit.label}</strong>
                        <div className="muted small">{row.unit.assetType}</div>
                      </td>
                      <td className="mono-num">{rate(row.cost.costPerLoadedMile, 'No loaded miles')}</td>
                      <td className="mono-num">{rate(row.cost.costPerMile, 'No movement')}</td>
                      <td className="muted small">
                        {km(row.cost.loadedKm)} / {km(row.cost.emptyKm)}
                      </td>
                      <td className="mono-num">
                        {row.declared
                          ? `${money(row.declared.centsPerDay / 100, row.cost.currency)} / day`
                          : 'Not declared'}
                      </td>
                      <td>
                        <button className="btn-sm" onClick={() => openEditor(row)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {error && data && (
        <Notice tone="warn" title="The last refresh failed" className="notice-spaced">
          {error}
        </Notice>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Fixed cost for ${editing.unit.label}` : 'Fixed cost'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => void save(true)} disabled={saving}>
              Clear
            </button>
            <button className="btn-green" onClick={() => void save(false)} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="cost-declared">
          <p className="muted small">
            Truck payment, insurance and permits — what the unit costs whether it moves or not.
            Without it the panel can only show fuel, which is the smaller half of the truth.
          </p>
          <div className="cost-declared__row">
            <label>
              Cost per day (dollars)
              <input
                inputMode="decimal"
                value={dollarsPerDay}
                onChange={(e) => setDollarsPerDay(e.target.value)}
                placeholder="e.g. 185.50"
              />
            </label>
            <label>
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. payment + insurance"
              />
            </label>
          </div>
          {editError && <div className="alert alert-error">{editError}</div>}
          <p className="muted small">
            <IconInfo size={12} className="inline-ico" /> A day is counted for every day in the
            window, whether or not the truck ran.
          </p>
        </div>
      </Modal>

      <p className="muted small" style={{ marginTop: 6 }}>
        <IconTruck size={12} className="inline-ico" /> Distances come from the positions your ELD
        reports.
      </p>
    </div>
  );
}
