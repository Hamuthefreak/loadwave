import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Badge, Spinner, Modal, lockScroll } from '../../components/ui';
import { SaveSearchModal } from '../../components/SaveSearchModal';
import { daysLabel, daysUntil, km, money, moneyShort, perMile, regionLabel, shortDate, timeAgo } from '../../utils/format';
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [view, setView] = useState<View>('list');
  const [compare, setCompare] = useState<BoardLoad[]>([]);
  const [selected, setSelected] = useState<BoardLoad | null>(null);
  const [booking, setBooking] = useState<BoardLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState('newest');

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

  // Client-side sort on top of the board's newest-first feed.
  const sorted = useMemo(() => {
    const perMileNum = (l: BoardLoad): number => {
      const r = Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0);
      const k = Number(l.distanceKmEstimate ?? 0);
      return r > 0 && k > 0 ? r / k / 0.621371 : -1;
    };
    const list = [...filtered];
    if (sort === 'rate') list.sort((a, b) => Number(b.freightAmountBase ?? b.freightAmountTransaction ?? 0) - Number(a.freightAmountBase ?? a.freightAmountTransaction ?? 0));
    else if (sort === 'perMile') list.sort((a, b) => perMileNum(b) - perMileNum(a));
    else if (sort === 'distance') list.sort((a, b) => Number(a.distanceKmEstimate ?? Infinity) - Number(b.distanceKmEstimate ?? Infinity));
    return list;
  }, [filtered, sort]);

  const open = sorted.filter((l) => l.marketplaceStatus === 'PUBLIC');
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

  // Snapshot of the current filters for the "save & alert me" flow.
  const saveFilters = (): Record<string, string> => {
    const f: Record<string, string> = {};
    if (origin) f.originRegion = origin;
    if (destination) f.destinationRegion = destination;
    if (equipment) f.equipmentType = equipment;
    if (minRate.trim()) f.minFreight = String(Number(minRate));
    if (dateAfter) f.pickupAfter = dateAfter;
    return f;
  };
  const laneLabel = origin || destination
    ? `${origin ? regionLabel(origin) : 'Any'} → ${destination ? regionLabel(destination) : 'Any'}`
    : null;

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
          <label className="span-2">
            Equipment
            <select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value="">Any equipment</option>
              {EQUIPMENT_TYPES.map((eq) => (
                <option key={eq.value} value={eq.value}>{eq.label}</option>
              ))}
            </select>
          </label>
          <label className="span-2">
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
      {savedMsg && <div className="alert alert-success">{savedMsg}</div>}

      <div className="board-tools">
        <span className="muted small">
          {laneLabel
            ? `Watching ${laneLabel}`
            : 'Tip: narrow the search first, or this alerts you on every posted load.'}
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setSavedMsg(null);
            setSaveOpen(true);
          }}
        >
          🔔 Save & alert me
        </button>
      </div>

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
        <label className="board-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort loads">
            <option value="newest">Newest first</option>
            <option value="rate">Best rate</option>
            <option value="perMile">Best $ / mile</option>
            <option value="distance">Shortest haul</option>
          </select>
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner label="Loading the board…" />
      ) : view === 'list' ? (
        sorted.length === 0 ? (
          <EmptyState
            title="No loads match right now"
            sub="Try a wider lane or lower the minimum rate. New loads appear the moment a partner posts."
            action={<button className="btn-ghost" onClick={() => void load()}>Refresh board</button>}
          />
        ) : (
          <div className="load-grid">
            {sorted.map((l) => (
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
        <RouteView rows={sorted} onOpen={setSelected} />
      ) : (
        <CompareView rows={sorted} compare={compare} onToggle={toggleCompare} onOpen={setSelected} />
      )}

      {selected && (
        <DetailDrawer load={selected} onClose={() => setSelected(null)} onBook={() => { setBooking(selected); setSelected(null); }} onBooked={() => { setSelected(null); void load(); }} />
      )}

      <BookingModal
        load={booking}
        busy={busy}
        onClose={() => setBooking(null)}
        onConfirm={(l) => void book(l)}
      />

      <SaveSearchModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        filters={saveFilters()}
        laneLabel={laneLabel}
        onSaved={() => setSavedMsg('Alert saved — we’ll ping you when new loads match.')}
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
  const verified = load.postedByVerified ?? Boolean(load.postedByMcNumber || load.postedByUsdotNumber);
  const perMileVal = perMile(rate, load.distanceKmEstimate);
  // Rate-my-lane: how this load's $/mile compares to the marketplace average
  // for the same lane over the last 90 days.
  const numRate = Number(rate ?? 0);
  const numKm = Number(load.distanceKmEstimate ?? 0);
  const myPerMile = numRate > 0 && numKm > 0 ? numRate / numKm / 0.621371 : null;
  const laneAvg = load.laneAvgPerMile ?? null;
  const laneDelta = myPerMile != null && laneAvg != null ? myPerMile - laneAvg : null;
  const laneDeltaLabel =
    laneDelta == null
      ? null
      : `${laneDelta >= 0 ? '+' : '\u2212'}$${Math.abs(laneDelta).toFixed(2)}/mi ${laneDelta >= 0 ? 'above' : 'below'} lane avg`;

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
          {laneDeltaLabel && laneDelta != null && (
            <div className={`lane-flag ${laneDelta >= 0 ? 'lane-flag-good' : 'lane-flag-bad'}`}>{laneDeltaLabel}</div>
          )}
        </div>
      </div>
      <div className="carrier-row">
        <span className="carrier-name">{load.postedByTenantName}</span>
        {(load.postedByRatingCount ?? 0) > 0 && load.postedByRatingAvg != null && (
          <span
            className="rating-chip"
            title="Average rating from carriers who completed loads with this poster"
          >
            ★ {Number(load.postedByRatingAvg).toFixed(1)}
            <small>({load.postedByRatingCount})</small>
          </span>
        )}
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
        {load.pickupDate && <PickupHint date={load.pickupDate} />}
      </div>
    </div>
  );
}

function PickupHint({ date }: { date: string }) {
  const days = daysUntil(date);
  if (days === null) return <span className="muted small">Pickup {shortDate(date)}</span>;
  const tone =
    days < 0 ? 'pickup-overdue' : days === 0 ? 'pickup-today' : days <= 2 ? 'pickup-soon' : '';
  return (
    <span className={`pickup-hint ${tone}`} title={`Pickup ${shortDate(date)}`}>
      Pickup {daysLabel(date)}
      <span className="pickup-date muted">{shortDate(date)}</span>
    </span>
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
                {(() => {
                  const r = Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0);
                  const k = Number(l.distanceKmEstimate ?? 0);
                  const mine = r > 0 && k > 0 ? r / k / 0.621371 : null;
                  const d = mine != null && l.laneAvgPerMile != null ? mine - l.laneAvgPerMile : null;
                  if (d == null) return null;
                  return (
                    <div className={`lane-flag ${d >= 0 ? 'lane-flag-good' : 'lane-flag-bad'}`}>
                      {d >= 0 ? '+' : '\u2212'}${Math.abs(d).toFixed(2)}/mi
                    </div>
                  );
                })()}
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

/**
 * Quick "what does this actually pay?" estimate in the drawer: diesel cost for
 * the linehaul at the user's fuel price and economy. Values persist on the
 * device so repeat checks are zero-tap; nothing is sent to the server.
 */
function FuelNetEstimator({
  rate,
  currency,
  distanceKm,
}: {
  rate: string | null;
  currency: string;
  distanceKm: string | null;
}) {
  const isCad = currency === 'CAD';
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<string>(() => {
    try { return localStorage.getItem('loadwave.fuelPrice') ?? ''; } catch { return ''; }
  });
  const [efficiency, setEfficiency] = useState<string>(() => {
    try {
      return localStorage.getItem(isCad ? 'loadwave.kmL' : 'loadwave.mpg') ?? (isCad ? '2.6' : '6.0');
    } catch { return isCad ? '2.6' : '6.0'; }
  });

  const numRate = Number(rate ?? 0);
  const numKm = Number(distanceKm ?? 0);
  const p = Number(price);
  const eff = Number(efficiency);

  const litres = isCad && eff > 0 ? numKm / eff : null;
  const gallons = !isCad && eff > 0 ? (numKm * 0.621371) / eff : null;
  const qty = isCad ? litres : gallons;
  const unit = isCad ? 'L' : 'gal';
  const fuelCost = qty != null && p > 0 ? qty * p : null;
  const net = fuelCost != null ? numRate - fuelCost : null;
  const netPerKm = net != null && numKm > 0 ? net / numKm : null;

  if (!numRate || !numKm) return null;

  const persist = (key: string, val: string) => {
    try { localStorage.setItem(key, val); } catch { /* private mode */ }
  };

  return (
    <div className="net-est">
      <button type="button" className="net-est-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden>⛽</span>
        {net != null ? (
          <span>
            ≈ {money(net.toFixed(2), currency)} after diesel
            {netPerKm != null && <small> · {money(netPerKm.toFixed(2), currency)}/km</small>}
          </span>
        ) : (
          <span>Estimate fuel cost &amp; net pay</span>
        )}
        <span className="net-est-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="net-est-body">
          <div className="net-est-grid">
            <label>
              <span>Fuel price ({isCad ? '$/L' : '$/gal'})</span>
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => { setPrice(e.target.value); persist('loadwave.fuelPrice', e.target.value); }}
                placeholder={isCad ? '1.65' : '3.80'}
              />
            </label>
            <label>
              <span>Fuel economy ({isCad ? 'km/L' : 'mpg'})</span>
              <input
                inputMode="decimal"
                value={efficiency}
                onChange={(e) => { setEfficiency(e.target.value); persist(isCad ? 'loadwave.kmL' : 'loadwave.mpg', e.target.value); }}
                placeholder={isCad ? '2.6' : '6.0'}
              />
            </label>
          </div>
          {fuelCost != null && net != null ? (
            <dl className="net-est-lines">
              <div>
                <dt>Diesel for {Math.round(qty ?? 0)} {unit}</dt>
                <dd>−{money(fuelCost.toFixed(2), currency)}</dd>
              </div>
              <div className="net-est-total">
                <dt>Estimated net</dt>
                <dd>{money(net.toFixed(2), currency)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Enter your fuel price to see the estimate. Your numbers stay on this device.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Copies a compact public share text for this load to the clipboard. */
async function shareLoad(load: BoardLoad): Promise<'shared' | 'copied'> {
  const rate = load.freightAmountTransaction ?? load.freightAmountBase;
  const text = [
    `${regionLabel(load.originRegion)} → ${regionLabel(load.destinationRegion)} — ${load.distanceKmEstimate ? km(load.distanceKmEstimate) : 'distance n/a'}`,
    `${load.equipmentType ? equipmentLabel(load.equipmentType) + ' · ' : ''}${rate ? money(Number(rate), load.freightCurrency) : 'rate on request'}`,
    `Pickup ${load.pickupDate ? shortDate(load.pickupDate) : 'flexible'} · Loadwave board`,
  ].join('\n');
  if (navigator.share) {
    await navigator.share({ title: 'Load on Loadwave', text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

/** Days × avg-rate sparkline for the load's lane (marketplace history). */
function LaneTrend({ origin, destination }: { origin: string; destination: string }) {
  const [points, setPoints] = useState<Array<{ statDate: string; avgRate: number | null }> | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ lane: Array<{ statDate: string; avgRate: number | null }> }>(
      `/api/market/lanes/${origin}/${destination}/trend?days=30`,
    )
      .then((res) => {
        if (alive) setPoints(res.lane ?? []);
      })
      .catch(() => {
        if (alive) setPoints([]);
      });
    return () => {
      alive = false;
    };
  }, [origin, destination]);

  if (points === null) return null;
  const samples = points.filter((p) => p.avgRate != null) as Array<{ statDate: string; avgRate: number }>;
  if (samples.length < 2) return null; // not enough history to be meaningful

  const w = 240;
  const h = 44;
  const vals = samples.map((s) => s.avgRate);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (samples.length - 1);
  const path = samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - 4 - ((s.avgRate - min) / span) * (h - 8)).toFixed(1)}`).join(' ');
  const rising = vals[vals.length - 1] >= vals[0];

  return (
    <div className="lane-trend">
      <div className="lane-trend-head">
        <span className="muted small">30-day lane rate trend</span>
        <span className={`lane-trend-dir ${rising ? 'up' : 'down'}`}>{rising ? '▲' : '▼'} {moneyShort(min) === moneyShort(max) ? moneyShort(min) : `${moneyShort(min)}–${moneyShort(max)}`}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="lane-trend-svg" aria-hidden>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function DetailDrawer({ load, onClose, onBook, onBooked }: { load: BoardLoad; onClose: () => void; onBook: () => void; onBooked?: () => void }) {
  const rate = load.freightAmountBase ?? load.freightAmountTransaction;
  const verified = load.postedByVerified ?? Boolean(load.postedByMcNumber || load.postedByUsdotNumber);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    lockScroll(true);
    return () => {
      window.removeEventListener('keydown', onKey);
      lockScroll(false);
    };
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>Load details</h3>
          <div className="drawer-head-actions">
            <button className="icon-btn" title="Share this load" onClick={() => { void shareLoad(load).then((r) => { if (r === 'copied') { setCopied(true); window.setTimeout(() => setCopied(false), 1500); } }).catch(() => {}); }}>{copied ? '✓' : '📤'}</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="drawer-body">
          <LaneXL load={load} />
          <LaneTrend origin={load.originRegion} destination={load.destinationRegion} />
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
          <FuelNetEstimator rate={rate} currency={load.freightCurrency} distanceKm={load.distanceKmEstimate} />
          {load.marketplaceStatus === 'PUBLIC' && <NegotiationPanel loadId={load.id} posterName={load.postedByTenantName} loadRate={rate ? Number(rate) : null} currency={load.freightCurrency} onBooked={onBooked} />}
          <div className="drawer-carrier">
            <div className="carrier-name">{load.postedByTenantName}</div>
            {verified ? (
              <Badge tone="green"><span className="badge-dot" /> Verified carrier · {[/^(MC|USDOT)/i.test(load.postedByMcNumber ?? '') ? load.postedByMcNumber : load.postedByMcNumber ? `MC ${load.postedByMcNumber}` : null, load.postedByUsdotNumber].filter(Boolean).join(' / ')}</Badge>
            ) : (
              <Badge tone="gray">New carrier</Badge>
            )}
            {(load.postedByRatingCount ?? 0) > 0 && load.postedByRatingAvg != null && (
              <div className="rating-chip" style={{ marginTop: 6 }}>
                ★ {Number(load.postedByRatingAvg).toFixed(1)} from {load.postedByRatingCount} carrier rating{load.postedByRatingCount === 1 ? '' : 's'}
              </div>
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
/** Rate negotiation: a compact thread between this carrier and the poster. */
function NegotiationPanel({
  loadId,
  posterName,
  loadRate,
  currency,
  onBooked,
}: {
  loadId: string;
  posterName: string;
  loadRate: number | null;
  currency: string;
  /** Fired after this carrier commits to an agreed rate, so the board reloads. */
  onBooked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<MessageRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** What this carrier can do about the price: an accepted offer is bookable. */
  const [booking, setBooking] = useState<ThreadBooking | null>(null);
  const [confirmBook, setConfirmBook] = useState(false);
  const [bookedAt, setBookedAt] = useState<string | null>(null);

  const fetchThread = useCallback(async () => {
    const res = await api<{ thread: MessageRow[]; booking?: ThreadBooking }>(
      `/api/board/loads/${loadId}/messages`,
    );
    setThread(res.thread ?? []);
    setBooking(res.booking ?? null);
    setUnread(0);
    return res;
  }, [loadId]);

  // Opening the thread marks the poster's replies as read, so clear the badge.
  useEffect(() => {
    if (!open) return;
    void fetchThread().catch(() => setThread([]));
  }, [open, fetchThread]);

  // Unread replies from the poster on this load (carrier-side badge).
  useEffect(() => {
    let alive = true;
    api<{ threads: Array<{ loadId: string; unread: number }> }>('/api/messages/unread')
      .then((res) => {
        if (!alive) return;
        setUnread((res.threads ?? []).find((t) => t.loadId === loadId)?.unread ?? 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [loadId]);

  const send = async () => {
    if (busy) return;
    const body = draft.trim();
    const amt = amount.trim() ? Number(amount.trim()) : undefined;
    if (!body && amt == null) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/board/loads/${loadId}/messages`, {
        method: 'POST',
        body: { body: body || undefined, proposedAmount: amt },
      });
      setDraft('');
      setAmount('');
      await fetchThread();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not send');
    } finally {
      setBusy(false);
    }
  };

  /** Commit to the rate the poster already accepted — the load books at it. */
  const commit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ amount: string; currency: string }>(
        `/api/board/loads/${loadId}/commit-offer`,
        { method: 'POST', body: {} },
      );
      setConfirmBook(false);
      setBookedAt(money(res.amount, res.currency));
      await fetchThread().catch(() => undefined);
      onBooked?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not book this load');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="negotiation">
      {!open ? (
        <button type="button" className="btn-ghost btn-block" onClick={() => setOpen(true)}>
          💬 Message {posterName} or offer a rate
          {unread > 0 && <span className="msg-count">{unread}</span>}
        </button>
      ) : (
        <div className="negotiation-open">
          <div className="negotiation-head">
            <span className="muted small">Rate negotiation — {posterName}</span>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close negotiation">✕</button>
          </div>
          <div className="negotiation-thread">
            {thread.length === 0 && (
              <p className="muted small" style={{ margin: '4px 0 8px' }}>
                Ask about the lane, or offer your rate — the poster gets a notification.
              </p>
            )}
            {thread.map((m) => (
              <div key={m.id} className={`msg ${m.mine ? 'mine' : 'theirs'} ${m.kind === 'SYSTEM' ? 'sys' : ''}`}>
                {m.kind === 'RATE_PROPOSAL' && m.proposedAmount != null && (
                  <div className={`msg-offer ${Number(m.proposedAmount) > (loadRate ?? 0) ? 'over' : 'under'}`}>
                    {money(m.proposedAmount, m.currency ?? currency)}
                    {loadRate != null && Number(m.proposedAmount) !== loadRate && (
                      <span className="muted small"> {Number(m.proposedAmount) > loadRate ? 'above' : 'below'} asking {money(loadRate, currency)}</span>
                    )}
                  </div>
                )}
                {m.body && <div className="msg-body">{m.body}</div>}
                <div className="msg-meta muted small">{m.authorLabel} · {timeAgo(m.createdAt)}</div>
              </div>
            ))}
          </div>
          {bookedAt && (
            <p className="neg-booked" role="status">
              ✓ Booked at {bookedAt} — the rate you both agreed on.
            </p>
          )}
          {!bookedAt && booking?.canBook && booking.committedAmount && (
            confirmBook ? (
              <div className="neg-confirm" role="alertdialog" aria-label="Confirm booking">
                <p>
                  Book <strong>{posterName}</strong> at{' '}
                  <strong>{money(booking.committedAmount, currency)}</strong> — the rate they accepted?
                  Booking is final.
                </p>
                <div className="neg-confirm-actions">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmBook(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="btn-green btn-sm" onClick={() => void commit()} disabled={busy}>
                    {busy ? 'Booking…' : 'Confirm booking'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-green btn-block neg-book" onClick={() => setConfirmBook(true)}>
                Book this load at {money(booking.committedAmount, currency)} — agreed rate
              </button>
            )
          )}
          {err && <p className="app-crash-msg" style={{ margin: '6px 0' }}>{err}</p>}
          <div className="negotiation-compose">
            <input
              className="neg-amount"
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              placeholder={loadRate != null ? `Offer (${currency})` : 'Offer amount'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Proposed amount"
            />
            <input
              className="neg-text"
              type="text"
              inputMode="text"
              placeholder="Add a note…"
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              aria-label="Message"
            />
            <button type="button" className="btn-green" onClick={() => void send()} disabled={busy || (!draft.trim() && !amount.trim())}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageRow {
  id: string;
  mine: boolean;
  authorLabel: string;
  kind: 'MESSAGE' | 'RATE_PROPOSAL' | 'SYSTEM';
  body: string | null;
  proposedAmount: string | null;
  currency: string | null;
  createdAt: string;
}

interface ThreadBooking {
  acceptedAmount: string | null;
  canBook: boolean;
  committedAmount: string | null;
  isBooker: boolean;
}
