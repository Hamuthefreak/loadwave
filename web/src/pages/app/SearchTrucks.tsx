import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Modal, Spinner } from '../../components/ui';
import { money, regionLabel, shortDate, timeAgo } from '../../utils/format';
import { EQUIPMENT_TYPES, equipmentLabel, REGION_OPTIONS } from './regions';
import type { TruckRow } from './boardTypes';

export default function SearchTrucks() {
  const [rows, setRows] = useState<TruckRow[]>([]);
  const [mine, setMine] = useState<TruckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSince, setNewSince] = useState(0);
  const prevIds = useRef<Set<string>>(new Set());

  const [region, setRegion] = useState('');
  const [equipment, setEquipment] = useState('');
  const [minRate, setMinRate] = useState('');

  const [showPost, setShowPost] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (region) params.set('locationRegion', region);
      if (equipment) params.set('equipmentType', equipment);
      if (minRate.trim()) params.set('minRate', minRate.trim());
      const qs = params.toString();
      const [trucks, mineRows] = await Promise.all([
        api<TruckRow[]>(`/api/trucks${qs ? `?${qs}` : ''}`),
        api<TruckRow[]>('/api/trucks/my'),
      ]);
      setRows(trucks);
      setMine(mineRows);
      const next = new Set(trucks.map((t) => t.id));
      setNewSince(prevIds.current.size ? [...next].filter((id) => !prevIds.current.has(id)).length : 0);
      prevIds.current = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trucks');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [region, equipment, minRate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => void load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const open = rows.filter((r) => r.status === 'ACTIVE');
  const avgRate = useMemo(() => {
    const rates = open.map((r) => Number(r.rateAmount ?? 0)).filter((n) => n > 0);
    return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  }, [open]);

  const book = async (target: TruckRow) => {
    setError(null);
    try {
      await api<TruckRow>(`/api/trucks/${target.id}/book`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
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
          <h1>Search trucks</h1>
          <p className="muted">
            Available equipment from partner carriers{' '}
            {newSince > 0 && <strong style={{ color: 'var(--green)' }}>· {newSince} new</strong>}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-green" onClick={() => setShowPost(true)}>+ Post a truck</button>
        </div>
      </div>

      <form className="board-search" onSubmit={submit}>
        <div className="form-grid search-filters">
          <label>
            Location
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Anywhere</option>
              {REGION_OPTIONS.map((r) => (
                <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
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
            <input type="number" min="0" step="50" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="1500" />
          </label>
          <button type="submit" className="btn-primary" disabled={loading && rows.length === 0}>
            Search
          </button>
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="board-metrics">
        <span><b>{open.length}</b> units available</span>
        <span>avg rate <b style={{ color: 'var(--green)' }}>{money(avgRate)}</b></span>
        <span><span className="live-dot" aria-hidden /> live marketplace</span>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner label="Loading available equipment…" />
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="empty-mark" aria-hidden />
          <strong>No equipment listed yet</strong>
          <p className="muted small">
            Be the first — post your truck and let the market book it.
          </p>
          <button className="btn-green" onClick={() => setShowPost(true)}>+ Post a truck</button>
        </div>
      ) : (
        <div className="load-grid">
          {rows.map((t) => {
            const taken = t.status === 'BOOKED';
            return (
              <div className="load-card" key={t.id}>
                <div className="load-card-top">
                  <div>
                    <div className="lane lane-big">
                      <span className="lane-city">{equipmentLabel(t.equipmentType)}</span>
                    </div>
                    <div className="load-meta">
                      <span>Located in <strong>{regionLabel(t.locationRegion)}</strong></span>
                      <span>Ready {shortDate(t.availableFrom)}</span>
                      {t.trailerType && <Badge tone="cyan">{t.trailerType}</Badge>}
                    </div>
                  </div>
                  <div className="load-rate">
                    <div className="amount">{money(t.rateAmount, t.rateCurrency)}</div>
                    <div className="ppm">posted {timeAgo(t.createdAt)}</div>
                  </div>
                </div>
                {t.notes && <p className="muted small">{t.notes}</p>}
                <div className="carrier-row">
                  <span className="carrier-name">{t.postedByTenantName}</span>
                  <Badge tone="gray">Listed {shortDate(t.createdAt)}</Badge>
                </div>
                <div className="load-foot">
                  {taken ? (
                    <Badge tone="gray"><span className="badge-dot" /> Booked</Badge>
                  ) : (
                    <button className="btn-green" onClick={() => void book(t)}>Book equipment</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mine.length > 0 && (
        <>
          <h2>My listings</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Location</th>
                  <th>Available</th>
                  <th>Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{equipmentLabel(t.equipmentType)}</strong></td>
                    <td>{regionLabel(t.locationRegion)}</td>
                    <td>{shortDate(t.availableFrom)}{t.availableTo ? ` → ${shortDate(t.availableTo)}` : ''}</td>
                    <td className="mono-num">{money(t.rateAmount, t.rateCurrency)}</td>
                    <td>
                      {t.status === 'ACTIVE' ? <Badge tone="green">Available</Badge> : <Badge tone="amber">Booked {t.bookedByTenantId ? '· by partner' : ''}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PostTruckModal
        open={showPost}
        onClose={() => setShowPost(false)}
        onPosted={async () => {
          setShowPost(false);
          await load();
        }}
      />
    </div>
  );
}

function PostTruckModal({
  open,
  onClose,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [equipmentType, setEquipmentType] = useState('DRY_VAN');
  const [trailerType, setTrailerType] = useState('');
  const [locationRegion, setLocationRegion] = useState('QC');
  const [availableFrom, setAvailableFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableTo, setAvailableTo] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      equipmentType,
      trailerType: trailerType || undefined,
      locationCountry: locationRegionCode(locationRegion),
      locationRegion,
      availableFrom: new Date(`${availableFrom}T09:00:00`).toISOString(),
      rateCurrency: 'CAD',
    };
    if (availableTo) body.availableTo = new Date(`${availableTo}T18:00:00`).toISOString();
    if (rate.trim()) body.rateAmount = Number(rate);
    if (notes.trim()) body.notes = notes;
    try {
      await api('/api/trucks', { method: 'POST', body });
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post truck');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post a truck"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-green" onClick={submit} disabled={saving}>
            {saving ? 'Posting…' : 'Post to market'}
          </button>
        </>
      }
    >
      <form id="post-truck" onSubmit={submit} className="drawer-form">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <label>
            Equipment type
            <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)}>
              {EQUIPMENT_TYPES.map((eq) => (
                <option key={eq.value} value={eq.value}>{eq.label}</option>
              ))}
            </select>
          </label>
          <label>
            Trailer / notes short name
            <input value={trailerType} onChange={(e) => setTrailerType(e.target.value)} placeholder="e.g. 53′ flatbed" />
          </label>
          <label>
            Home location
            <select value={locationRegion} onChange={(e) => setLocationRegion(e.target.value)}>
              {REGION_OPTIONS.map((r) => (
                <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
              ))}
            </select>
          </label>
          <label>
            Available from
            <input type="date" required value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} />
          </label>
          <label>
            Available until (optional)
            <input type="date" value={availableTo} onChange={(e) => setAvailableTo(e.target.value)} />
          </label>
          <label>
            Ask rate (CAD, optional)
            <input type="number" min="0" step="25" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1800" />
          </label>
        </div>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. dry van, 2 stop-off OK, no hazmat" style={{ resize: 'vertical' }} />
        </label>
      </form>
    </Modal>
  );
}

function locationRegionCode(region: string): string {
  return ['QC', 'ON', 'AB', 'BC', 'MB', 'NB', 'NS', 'PE', 'SK', 'NL'].includes(region) ? 'CA' : 'US';
}