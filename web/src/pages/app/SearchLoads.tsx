import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Badge, Spinner, Modal } from '../../components/ui';
import { km, money, perMile, regionLabel, shortDate, timeAgo } from '../../utils/format';
import {
  EQUIPMENT_TYPES,
  equipmentLabel,
  REGION_OPTIONS,
} from './regions';
import type { BoardLoad } from './boardTypes';

type View = 'list' | 'route' | 'compare';

const LANE_PRESETS: Array<{ origin: string; destination: string; label: string }> = [
  { origin: 'QC', destination: 'ON', label: 'Québec → Ontario' },
  { origin: 'ON', destination: 'NY', label: 'Ontario → New York' },
  { origin: 'QC', destination: 'NY', label: 'Québec → New York' },
  { origin: 'QC', destination: 'IL', label: 'Québec → Illinois' },
  { origin: 'ON', destination: 'MI', label: 'Ontario → Michigan' },
  { origin: 'AB', destination: 'BC', label: 'Alberta → BC' },
];

export default function SearchLoads() {
  const [rows, setRows] = useState<BoardLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [newSince, setNewSince] = useState(0);
  const prevIds = useRef<Set<string>>(new Set());

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [equipment, setEquipment] = useState('');
  const [minRate, setMinRate] = useState('');
  const [dateAfter, setDateAfter] = useState('');
  const [preset, setPreset] = useState<string | null>(null);

  const [view, setView] = useState<View>('list');
  const [compare, setCompare] = useState<BoardLoad[]>([]);
  const [selected, setSelected] = useState<BoardLoad | null>(null);
  const [booking, setBooking] = useState<BoardLoad | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (origin) params.set('originRegion', origin);
      if (destination) params.set('destinationRegion', destination);
      if (minRate.trim()) params.set('minFreight', minRate.trim());
      const qs = params.toString();
      const data = await api<BoardLoad[]>(`/api/board/loads${qs ? `?${qs}` : ''}`);
      setRows(data);
      const next = new Set(data.map((l) => l.id));
      setNewSince(prevIds.current.size ? [...next].filter((id) => !prevIds.current.has(id)).length : 0);
      prevIds.current = next;
      setSyncedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the board');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [origin, destination, minRate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((l) => {
      if (equipment && (l.equipmentType ?? 'DRY_VAN') !== equipment) return false;
      if (dateAfter && l.pickupDate && new Date(l.pickupDate).toISOString().slice(0, 10) < dateAfter) return false;
      return true;
    });
  }, [rows, equipment, dateAfter]);

  const open = filtered.filter((l) => l.marketplaceStatus === 'PUBLIC');
  const avgRate = useMemo(() => {
    const rates = filtered
      .map((l) => Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0))
      .filter((n) => n > 0);
    return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  }, [filtered]);

  const applyPreset = (p: { origin: string; destination: string; label: string }) => {
    setPreset(p.label);
    setOrigin(p.origin);
    setDestination(p.destination);
  };

  const toggleCompare = (l: BoardLoad) => {
    setCompare((cur) => {
      if (cur.some((c) => c.id === l.id)) return cur.filter((c) => c.id !== l.id);
      if (cur.length >= 3) return cur;
      return [...cur, l];
    });
  };

  const clearFilters = () => {
    setOrigin('');
    setDestination('');
    setEquipment('');
    setMinRate('');
    setDateAfter('');
    setPreset(null);
  };

  const book = async (target: BoardLoad) => {
    setBusy(true);
    setError(null);
    try {
      await api<BoardLoad>(`/api/board/loads/${target.id}/book`, { method: 'POST', body: {} });
      setBooking(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    void load();
  };

  return (
    <div className="search-page">
      <div className="page-head">
        <div>
          <h1>Search loads</h1>
          <p className="muted">
            Live loads from verified partner carriers{' '}
            {syncedAt && (
              <span className="freshness">
                <span className="live-dot" aria-hidden /> synced {timeAgo(syncedAt.toISOString())}
                {newSince > 0 && <strong style={{ color: 'var(--green)' }}> · {newSince} new</strong>}
              </span>
            )}
          </p>
        </div>
        <div className="page-actions">
          <div className="view-toggle" role="tablist">
            {(['list', 'route', 'compare'] as View[]).map((v) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                onClick={() => {
                  setView(v);
                  if (v !== 'compare') setCompare([]);
                }}
              >
                {v === 'list' ? 'List' : v === 'route' ? 'Route view' : `Compare${compare.length ? ` (${compare.length})` : ''}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form className="board-search" onSubmit={submit}>
        <div className="form-grid search-filters">
          <label>
            Origin
            <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPreset(null); }}>
              <option value="">Any origin</option>
              {REGION_OPTIONS.map((r) => (
                <option key={`o-${r.code}`} value={r.code}>{r.name} ({r.code})</option>
              ))}
            </select>
          </label>
          <button type="button" className="swap-btn" title="Swap lanes" onClick={() => { setOrigin(destination); setDestination(origin); setPreset(null); }}>
            ⇄
          </button>
          <label>
            Destination
            <select value={destination} onChange={(e) => { setDestination(e.target.value); setPreset(null); }}>
              <option value="">Any destination</option>
              {REGION_OPTIONS.map((r) => (
                <option key={`d-${r.code}`} value={r.code}>{r.name} ({r.code})</option>
              ))}
            </select>
          </label>
          <label>
            Equipment
            <select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value="">Any equipment</option>
              {EQUIPMENT_TYPES.map((eq) => (
                <option key={eq.value} value={eq.value}>{eq.label}</option>
              ))}
            </select>
          </label>
          <label>
            Min rate
            <input type="number" min="0" step="50" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="1200" />
          </label>
          <label>
            Pickup after
            <input type="date" value={dateAfter} onChange={(e) => setDateAfter(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" disabled={loading && rows.length === 0}>
            {loading && rows.length === 0 ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="lane-chips">
          {LANE_PRESETS.map((p) => (
            <button key={p.label} type="button" className={`chip ${preset === p.label ? 'active' : ''}`} onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
          {(origin || destination || equipment || minRate || dateAfter) && (
            <button type="button" className="chip" onClick={clearFilters}>Clear filters ✕</button>
          )}
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="board-metrics">
        <span>
          <b>{open.length}</b> loads open
        </span>
        <span>
          avg rate <b style={{ color: 'var(--green)' }}>{money(avgRate)}</b>
        </span>
        <span>
          <span className="live-dot" aria-hidden /> live marketplace
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner label="Loading the board…" />
      ) : view === 'list' ? (
        filtered.length === 0 ? (
          <EmptyState
            title="No loads match right now"
            sub="Try a wider lane or lower the minimum rate. New loads appear the moment a partner posts."
            action={<button className="btn-ghost" onClick={() => void load()}>Refresh board</button>}
          />
        ) : (
          <div className="load-grid">
            {filtered.map((l) => (
              <LoadCard
                key={l.id}
                load={l}
                compareMode={compare.length > 0 && compare.some((c) => c.id === l.id)}
                onSelect={() => setSelected(l)}
                onCompare={() => toggleCompare(l)}
                onBook={() => setBooking(l)}
              />
            ))}
          </div>
        )
      ) : view === 'route' ? (
        <RouteView rows={filtered} onOpen={setSelected} />
      ) : (
        <CompareView rows={filtered} compare={compare} onToggle={toggleCompare} onOpen={setSelected} />
      )}

      {selected && (
        <DetailDrawer load={selected} onClose={() => setSelected(null)} onBook={() => { setBooking(selected); setSelected(null); }} />
      )}

      <BookingModal
        load={booking}
        busy={busy}
        onClose={() => setBooking(null)}
        onConfirm={(l) => void book(l)}
      />
    </div>
  );
}

function EmptyState({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden />
      <strong>{title}</strong>
      <p className="muted small">{sub}</p>
      {action}
    </div>
  );
}

export function LoadCard({
  load,
  compareMode,
  onSelect,
  onCompare,
  onBook,
}: {
  load: BoardLoad;
  compareMode: boolean;
  onSelect: () => void;
  onCompare: () => void;
  onBook: () => void;
}) {
  const rate = load.freightAmountBase ?? load.freightAmountTransaction;
  const taken = load.marketplaceStatus === 'BOOKED';
  const verified = Boolean(load.postedByMcNumber || load.postedByUsdotNumber);
  const perMileVal = perMile(rate, load.distanceKmEstimate);

  return (
    <div className={compareMode ? 'load-card compare-on' : 'load-card'}>
      <div className="load-card-bar">
        <span className="load-card-id">{load.id.slice(0, 8).toUpperCase()}</span>
        <button
          className={compareMode ? 'compare-toggle on' : 'compare-toggle'}
          onClick={onCompare}
          aria-pressed={compareMode}
          aria-label={compareMode ? 'Remove from comparison' : 'Add to comparison'}
          title={compareMode ? 'Remove from comparison' : 'Add to comparison'}
        >
          {compareMode ? '✓' : '+'}
        </button>
      </div>
      <div className="load-card-top" onClick={onSelect}>
        <div>
          <div className="lane lane-big">
            <span className="lane-city">{regionLabel(load.originRegion)}</span>
            <span className="lane-arrow">→</span>
            <span className="lane-city">{regionLabel(load.destinationRegion)}</span>
          </div>
          <div className="load-meta">
            <span>{km(load.distanceKmEstimate)}</span>
            <span>
              {equipmentLabel(load.equipmentType)}
            </span>
            {load.isInternational && <Badge tone="blue">Cross-border</Badge>}
            <span className="muted">{timeAgo(load.createdAt)}</span>
          </div>
        </div>
        <div className="load-rate">
          <div className="amount">{money(rate, load.freightCurrency)}</div>
          <div className="ppm">{perMileVal ? `${perMileVal}/mi` : '—'}</div>
        </div>
      </div>
      <div className="carrier-row">
        <span className="carrier-name">{load.postedByTenantName}</span>
        {verified ? (
          <Badge tone="green">
            <span className="badge-dot" /> Verified{load.postedByMcNumber ? ` · ${/^(MC|USDOT)/i.test(load.postedByMcNumber) ? load.postedByMcNumber : `MC ${load.postedByMcNumber}`}` : ''}
          </Badge>
        ) : (
          <Badge tone="gray">New carrier</Badge>
        )}
      </div>
      <div className="load-foot">
        {taken ? (
          <Badge tone="gray"><span className="badge-dot" /> Booked</Badge>
        ) : (
          <button className="btn-green" onClick={onBook}>Book load</button>
        )}
        {load.pickupDate && <span className="muted small">Pickup {shortDate(load.pickupDate)}</span>}
      </div>
    </div>
  );
}

function RouteView({ rows, onOpen }: { rows: BoardLoad[]; onOpen: (l: BoardLoad) => void }) {
  const lanes = useMemo(() => {
    const map = new Map<string, { from: string; to: string; loads: number; avg: number; count: number }>();
    for (const l of rows) {
      const key = `${l.originRegion}-${l.destinationRegion}`;
      const cur = map.get(key) ?? { from: l.originRegion, to: l.destinationRegion, loads: 0, avg: 0, count: 0 };
      cur.loads += 1;
      const r = Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0);
      if (r > 0) cur.avg += r;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count) as Array<{
      from: string; to: string; loads: number; avg: number; count: number;
    }>;
  }, [rows]);

  return (
    <div className="route-view">
      <div className="route-map" aria-hidden>
        <div className="route-map-lanes">
          {lanes.slice(0, 5).map((l, idx) => (
            <div key={l.from + l.to} className="route-lane-line" style={{ '--i': idx } as React.CSSProperties}>
              <span>{regionLabel(l.from)}</span>
              <i>{regionLabel(l.to)}</i>
            </div>
          ))}
        </div>
        <span className="route-map-caption muted small">Schematic view — tap a lane to see its loads</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Lane</th>
              <th>Loads</th>
              <th>Avg rate</th>
              <th>Best</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((l) => {
              const laneLoads = rows.filter((r) => r.originRegion === l.from && r.destinationRegion === l.to);
              const best = Math.max(...laneLoads.map((r) => Number(r.freightAmountBase ?? r.freightAmountTransaction ?? 0)).filter((n) => n > 0), 0);
              return (
                <tr key={l.from + l.to} onClick={() => onOpen(laneLoads[0])} style={{ cursor: 'pointer' }}>
                  <td>
                    <strong>{regionLabel(l.from)}</strong> → <strong>{regionLabel(l.to)}</strong>
                  </td>
                  <td>{l.loads}</td>
                  <td>{money(l.avg / Math.max(l.count, 1))}</td>
                  <td>{best > 0 ? money(best) : '—'}</td>
                </tr>
              );
            })}
            {lanes.length === 0 && (
              <tr><td colSpan={4} className="muted">No loads to map yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareView({
  rows,
  compare,
  onToggle,
  onOpen,
}: {
  rows: BoardLoad[];
  compare: BoardLoad[];
  onToggle: (l: BoardLoad) => void;
  onOpen: (l: BoardLoad) => void;
}) {
  return (
    <div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Tap up to 3 loads to compare side by side. {compare.length < 3 && `${3 - compare.length} more slot(s).`}
      </p>
      <div className="load-grid">
        {rows.map((l) => (
          <div key={l.id} onClick={() => onToggle(l)} className={compare.some((c) => c.id === l.id) ? 'load-card compare-on pickable' : 'load-card pickable'}>
            <div className="load-card-top">
              <div>
                <div className="lane">
                  <span className="lane-city">{regionLabel(l.originRegion)}</span>
                  <span className="lane-arrow">→</span>
                  <span className="lane-city">{regionLabel(l.destinationRegion)}</span>
                </div>
                <div className="load-meta">
                  <span>{km(l.distanceKmEstimate)}</span>
                  <span>{equipmentLabel(l.equipmentType)}</span>
                </div>
              </div>
              <div className="load-rate">
                <div className="amount">{money(l.freightAmountBase ?? l.freightAmountTransaction, l.freightCurrency)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {compare.length > 0 && (
        <div className="compare-sheet">
          <div className="compare-sheet-head">
            <strong>Comparing {compare.length} load{compare.length === 1 ? '' : 's'}</strong>
            <button className="btn-ghost btn-sm" onClick={() => onOpen(compare[0])}>Details</button>
          </div>
          <div className="compare-cols">
            {compare.map((c) => (
              <div key={c.id} className="compare-col">
                <div className="lane">
                  <span className="lane-city">{regionLabel(c.originRegion)}</span>
                  <span className="lane-arrow">→</span>
                  <span className="lane-city">{regionLabel(c.destinationRegion)}</span>
                </div>
                <div className="cmp-amount">{money(c.freightAmountBase ?? c.freightAmountTransaction, c.freightCurrency)}</div>
                <div className="muted small">{perMile(c.freightAmountBase ?? c.freightAmountTransaction, c.distanceKmEstimate) ?? '—'}/mi · {km(c.distanceKmEstimate)}</div>
                <div className="muted small">{equipmentLabel(c.equipmentType)} · {c.postedByTenantName}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailDrawer({ load, onClose, onBook }: { load: BoardLoad; onClose: () => void; onBook: () => void }) {
  const rate = load.freightAmountBase ?? load.freightAmountTransaction;
  const verified = Boolean(load.postedByMcNumber || load.postedByUsdotNumber);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>Load details</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <LaneXL load={load} />
          <dl className="detail-list">
            <DetailRow label="Rate" value={money(rate, load.freightCurrency)} strong />
            <DetailRow label="Rate per mile" value={perMile(rate, load.distanceKmEstimate) ?? '—'} />
            <DetailRow label="Distance" value={km(load.distanceKmEstimate)} />
            <DetailRow label="Equipment" value={equipmentLabel(load.equipmentType)} />
            <DetailRow label="Pickup" value={load.pickupDate ? shortDate(load.pickupDate) : 'Flexible'} />
            <DetailRow label="Delivery" value={load.deliveryDate ? shortDate(load.deliveryDate) : 'Flexible'} />
            <DetailRow label="Cross-border" value={load.isInternational ? 'Yes' : 'No'} />
            <DetailRow label="Posted" value={timeAgo(load.createdAt)} />
          </dl>
          <div className="drawer-carrier">
            <div className="carrier-name">{load.postedByTenantName}</div>
            {verified ? (
              <Badge tone="green"><span className="badge-dot" /> Verified carrier · {[/^(MC|USDOT)/i.test(load.postedByMcNumber ?? '') ? load.postedByMcNumber : load.postedByMcNumber ? `MC ${load.postedByMcNumber}` : null, load.postedByUsdotNumber].filter(Boolean).join(' / ')}</Badge>
            ) : (
              <Badge tone="gray">New carrier</Badge>
            )}
          </div>
        </div>
        <div className="drawer-foot">
          {load.marketplaceStatus === 'BOOKED' ? (
            <Badge tone="gray"><span className="badge-dot" /> Already booked</Badge>
          ) : (
            <button className="btn-green btn-block" onClick={onBook}>Book this load</button>
          )}
        </div>
      </aside>
    </div>
  );
}

function LaneXL({ load }: { load: BoardLoad }) {
  return (
    <div className="lane lane-big">
      <span className="lane-city">{regionLabel(load.originRegion)}</span>
      <span className="lane-arrow">→</span>
      <span className="lane-city">{regionLabel(load.destinationRegion)}</span>
    </div>
  );
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd style={strong ? { color: 'var(--green)' } : undefined}>{value}</dd>
    </div>
  );
}

export function BookingModal({
  load,
  busy,
  onClose,
  onConfirm,
}: {
  load: BoardLoad | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (l: BoardLoad) => void;
}) {
  return (
    <Modal
      open={load !== null}
      onClose={onClose}
      title="Book this load?"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-green" onClick={() => load && onConfirm(load)} disabled={busy}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </>
      }
    >
      {load && (
        <>
          <LaneXL load={load} />
          <dl className="detail-list">
            <DetailRow label="Rate" value={money(load.freightAmountBase ?? load.freightAmountTransaction, load.freightCurrency)} strong />
            <DetailRow label="Rate per mile" value={perMile(load.freightAmountBase ?? load.freightAmountTransaction, load.distanceKmEstimate) ?? '—'} />
            <DetailRow label="Distance" value={km(load.distanceKmEstimate)} />
            <DetailRow label="Posted by" value={load.postedByTenantName} />
          </dl>
          <p className="muted small">
            Booking is final and instant. Once booked, the load is marked taken for every carrier
            on the board.
          </p>
        </>
      )}
    </Modal>
  );
}