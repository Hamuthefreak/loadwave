import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, Lane, PageHeader } from '../../components/ui';
import DispatchModal, { type DispatchLoad } from '../../components/DispatchModal';
import { LoadDocumentsModal } from '../../components/LoadDocumentsModal';
import { InvoiceLoadModal } from '../../components/InvoiceLoadModal';
import { km, money, perMile, regionLabel, shortDate } from '../../utils/format';
import { EQUIPMENT_TYPES, equipmentLabel, REGION_OPTIONS } from './regions';
import type { TruckRow } from './boardTypes';
import { Link } from 'react-router-dom';

type Tab = 'loads' | 'trucks';

export default function MyLoads() {
  const [tab, setTab] = useState<Tab>('loads');
  return (
    <div>
      <PageHeader
        title="My loads & trucks"
        sub="Everything you've posted and everything you're hauling."
      />
      <div className="tabs page-tabs">
        <button className={tab === 'loads' ? 'active' : ''} onClick={() => setTab('loads')}>
          My loads
        </button>
        <button className={tab === 'trucks' ? 'active' : ''} onClick={() => setTab('trucks')}>
          My trucks
        </button>
      </div>
      {tab === 'loads' ? <MyLoadsTab /> : <MyTrucksTab />}
    </div>
  );
}

// A tenant-owned load as served by GET /api/loads — richer than the board view:
// includes the dispatch lifecycle (status, assignee driver/unit).
interface OwnLoad extends DispatchLoad {
  equipmentType: string | null;
  distanceKmEstimate: string | null;
  freightCurrency: string;
  freightAmountBase: string | null;
  freightAmountTransaction: string | null;
  createdAt: string;
}

function laneText(l: Pick<OwnLoad, 'originRegion' | 'destinationRegion'>): string {
  return `${regionLabel(l.originRegion)} → ${regionLabel(l.destinationRegion)}`;
}

function MyLoadsTab() {
  const [rows, setRows] = useState<OwnLoad[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [dispatchFor, setDispatchFor] = useState<OwnLoad | null>(null);
  const [podFor, setPodFor] = useState<OwnLoad | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OwnLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [oCountry, setOCountry] = useState<'CA' | 'US'>('CA');
  const [oRegion, setORegion] = useState('QC');
  const [dCountry, setDCountry] = useState<'CA' | 'US'>('CA');
  const [dRegion, setDRegion] = useState('ON');
  const [distance, setDistance] = useState('');
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [equipmentType, setEquipmentType] = useState('DRY_VAN');
  const [postNow, setPostNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<OwnLoad[]>('/api/loads'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load loads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve assignee ids to names for the Dispatch column.
  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/api/drivers')
      .then((ds) => setDriverNames(Object.fromEntries(ds.map((d) => [d.id, d.name]))))
      .catch(() => {
        /* labels are best-effort */
      });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const body: Record<string, unknown> = {
      originCountry: oCountry,
      originRegion: oRegion,
      destinationCountry: dCountry,
      destinationRegion: dRegion,
      freightCurrency: currency,
      equipmentType,
      isInternational: oCountry !== dCountry,
    };
    if (distance.trim()) body.distanceKmEstimate = Number(distance);
    if (rate.trim()) body.freightAmountTransaction = Number(rate);
    try {
      const created = await api<{ id: string }>('/api/loads', { method: 'POST', body });
      if (postNow) {
        await api(`/api/board/loads/${created.id}/list`, { method: 'POST', body: {} });
        setSuccess('Load posted to the board — partner carriers can book it now.');
      } else {
        setSuccess('Load saved as private.');
      }
      setDistance('');
      setRate('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create load');
    } finally {
      setSaving(false);
    }
  };

  const postToBoard = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/board/loads/${id}/list`, { method: 'POST', body: {} });
      setSuccess('Load is now live on the board.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post load');
    }
  };

  const boardCount = rows.filter((r) => r.marketplaceStatus === 'PUBLIC').length;
  const bookedCount = rows.filter((r) => r.marketplaceStatus === 'BOOKED').length;

  return (
    <div>
      <div className="card form-card">
        <h3>Post a load</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              Origin — country
              <select value={oCountry} onChange={(e) => { setOCountry(e.target.value as 'CA' | 'US'); setORegion(e.target.value === 'CA' ? 'QC' : 'NY'); }}>
                <option value="CA">Canada</option>
                <option value="US">United States</option>
              </select>
            </label>
            <label>
              Origin — province / state
              <select value={oRegion} onChange={(e) => setORegion(e.target.value)}>
                {regionOptions(oCountry).map((r) => <option key={r.code} value={r.code}>{r.name} ({r.code})</option>)}
              </select>
            </label>
            <label>
              Delivery — country
              <select value={dCountry} onChange={(e) => { setDCountry(e.target.value as 'CA' | 'US'); setDRegion(e.target.value === 'CA' ? 'ON' : 'NY'); }}>
                <option value="CA">Canada</option>
                <option value="US">United States</option>
              </select>
            </label>
            <label>
              Delivery — province / state
              <select value={dRegion} onChange={(e) => setDRegion(e.target.value)}>
                {regionOptions(dCountry).map((r) => <option key={r.code} value={r.code}>{r.name} ({r.code})</option>)}
              </select>
            </label>
            <label>
              Equipment
              <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)}>
                {EQUIPMENT_TYPES.map((eq) => <option key={eq.value} value={eq.value}>{eq.label}</option>)}
              </select>
            </label>
            <label>
              Distance (km)
              <input type="number" min="0" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="e.g. 640" />
            </label>
            <label>
              Freight rate
              <input type="number" min="0" step="25" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1800" />
            </label>
            <label>
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value as 'CAD' | 'USD')}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-green" disabled={saving}>
              {saving ? 'Posting…' : postNow ? 'Post load to board' : 'Save load'}
            </button>
            <label className="check-inline">
              <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
              Post to the board right away
            </label>
          </div>
        </form>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="board-metrics">
        <span><b>{rows.length}</b> total loads</span>
        <span><b style={{ color: 'var(--green)' }}>{boardCount}</b> on board</span>
        <span><b style={{ color: 'var(--amber)' }}>{bookedCount}</b> booked by partners</span>
      </div>

      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading loads…</span></div>
      ) : rows.length === 0 ? (
        <Empty title="No loads yet" sub="Use the form above to post your first load — it takes under a minute." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lane</th>
                <th>Equipment</th>
                <th>Distance</th>
                <th>Rate</th>
                <th>$ / mile</th>
                <th>Status</th>
                <th>Dispatch</th>
                <th>Action</th>
                <th>Wrap-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Lane originCountry={l.originCountry} originRegion={l.originRegion} destinationCountry={l.destinationCountry} destinationRegion={l.destinationRegion} />
                  </td>
                  <td>{equipmentLabel(l.equipmentType)}</td>
                  <td>{km(l.distanceKmEstimate)}</td>
                  <td className="mono-num">{money(l.freightAmountBase ?? l.freightAmountTransaction, l.freightCurrency)}</td>
                  <td className="mono-num">{perMile(l.freightAmountBase ?? l.freightAmountTransaction, l.distanceKmEstimate) ?? '—'}</td>
                  <td>
                    {l.marketplaceStatus === 'PUBLIC' && <Badge tone="green">On the board</Badge>}
                    {l.marketplaceStatus === 'BOOKED' && <Badge tone="amber">Booked{l.bookedAt ? ` · ${shortDate(l.bookedAt)}` : ''}</Badge>}
                    {l.marketplaceStatus === 'PRIVATE' && <Badge tone="gray">Private</Badge>}
                  </td>
                  <td>
                    {!l.bookedByTenantId &&
                    (l.marketplaceStatus === 'PRIVATE'
                      ? ['OPEN', 'ASSIGNED', 'IN_TRANSIT'].includes(l.status)
                      : !!l.assigneeDriverId) ? (
                      <>
                        <button className="btn-sm" onClick={() => setDispatchFor(l)}>
                          {l.assigneeDriverId ? 'Change driver' : 'Dispatch'}
                        </button>
                        {l.assigneeDriverId && (
                          <div className="muted small" style={{ marginTop: 2 }}>
                            {driverNames[l.assigneeDriverId] ?? 'Assigned'}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>
                    {l.marketplaceStatus === 'PRIVATE' ? (
                      <button className="btn-sm" onClick={() => void postToBoard(l.id)}>Post to board</button>
                    ) : l.marketplaceStatus === 'PUBLIC' ? (
                      <span className="muted small">Live on the board</span>
                    ) : (
                      <span className="muted small">{l.bookedByTenantId ? 'Taken by partner' : 'Taken'}</span>
                    )}
                  </td>
                  <td>
                    {l.status === 'DELIVERED' ? (
                      <span className="row-actions">
                        <button className="btn-sm" onClick={() => setPodFor(l)}>Add POD</button>
                        <button className="btn-sm" onClick={() => setInvoiceFor(l)}>Create invoice</button>
                      </span>
                    ) : l.status === 'INVOICED' ? (
                      <span className="row-actions">
                        <button className="btn-sm" onClick={() => setPodFor(l)}>Add POD</button>
                        <Badge tone="green">Invoiced</Badge>
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DispatchModal
        open={dispatchFor !== null}
        onClose={() => setDispatchFor(null)}
        load={dispatchFor}
        onSaved={() => load()}
      />

      <LoadDocumentsModal
        open={podFor !== null}
        onClose={() => setPodFor(null)}
        loadId={podFor?.id ?? null}
        laneLabel={podFor ? laneText(podFor) : undefined}
      />

      <InvoiceLoadModal
        open={invoiceFor !== null}
        onClose={() => setInvoiceFor(null)}
        load={invoiceFor}
        onInvoiced={async () => {
          setSuccess('Invoice created — the load is marked Invoiced.');
          await load();
        }}
      />
    </div>
  );
}

function MyTrucksTab() {
  const [rows, setRows] = useState<TruckRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<TruckRow[]>('/api/trucks/my'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trucks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading trucks…</span></div>
      ) : rows.length === 0 ? (
        <Empty
          title="No equipment posted yet"
          sub="Post your truck so partner carriers and brokers can book it."
          action={<Link to="/app/trucks" className="btn-green">Go to Search Trucks</Link>}
        />
      ) : (
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
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><strong>{equipmentLabel(t.equipmentType)}</strong>{t.trailerType && <div className="muted small">{t.trailerType}</div>}</td>
                  <td>{regionLabel(t.locationRegion)}</td>
                  <td>{shortDate(t.availableFrom)}{t.availableTo ? ` → ${shortDate(t.availableTo)}` : ''}</td>
                  <td className="mono-num">{money(t.rateAmount, t.rateCurrency)}</td>
                  <td>
                    {t.status === 'ACTIVE' ? <Badge tone="green">Available</Badge> : <Badge tone="amber">Booked</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function regionOptions(country: 'CA' | 'US') {
  return country === 'CA'
    ? REGION_OPTIONS.filter((r) => ['QC', 'ON', 'AB', 'BC', 'MB', 'NB', 'NS', 'PE', 'SK', 'NL'].includes(r.code))
    : REGION_OPTIONS.filter((r) => ['NY', 'NJ', 'PA', 'MA', 'IL', 'MI', 'OH', 'TX', 'GA', 'FL', 'CA', 'TN', 'VA', 'NC'].includes(r.code));
}