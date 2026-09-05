import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, PageHeader } from '../../components/ui';
import DispatchModal, { type DispatchDriver, type DispatchLoad } from '../../components/DispatchModal';
import { regionLabel } from '../../utils/format';

interface Driver extends DispatchDriver {
  externalEldId: string | null;
  licenseNumber: string | null;
  homeTerminalTz: string;
  cycleType: 'CYCLE_1' | 'CYCLE_2';
}

// Cycle snapshot served by GET /api/hos/overview.
interface HosOverviewRow {
  driverId: string;
  cycleType: 'CYCLE_1' | 'CYCLE_2';
  onDutyHours7: number;
  remaining7: number | null;
  limit7: number | null;
  onDutyHours14: number;
  remaining14: number | null;
  limit14: number | null;
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

export default function Drivers() {
  const [rows, setRows] = useState<Driver[]>([]);
  const [onTrip, setOnTrip] = useState<Record<string, string>>({});
  const [hos, setHos] = useState<Record<string, HosOverviewRow>>({});
  const [dispatchFor, setDispatchFor] = useState<Driver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [cycle, setCycle] = useState<'CYCLE_1' | 'CYCLE_2'>('CYCLE_1');
  const [tz, setTz] = useState('America/Toronto');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ds, ov, ls] = await Promise.all([
        api<Driver[]>('/api/drivers'),
        api<HosOverviewRow[]>('/api/hos/overview').catch(() => [] as HosOverviewRow[]),
        api<DispatchLoad[]>('/api/loads').catch(() => [] as DispatchLoad[]),
      ]);
      setRows(ds);
      setHos(Object.fromEntries(ov.map((r) => [r.driverId, r])));
      const trip: Record<string, string> = {};
      for (const l of ls) {
        if (
          l.assigneeDriverId &&
          ['ASSIGNED', 'IN_TRANSIT'].includes(l.status) &&
          !trip[l.assigneeDriverId]
        ) {
          trip[l.assigneeDriverId] = `${regionLabel(l.originRegion)} → ${regionLabel(l.destinationRegion)}`;
        }
      }
      setOnTrip(trip);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drivers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<Driver>('/api/drivers', {
        method: 'POST',
        body: { name, licenseNumber: license || undefined, cycleType: cycle, homeTerminalTz: tz },
      });
      setName('');
      setLicense('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add driver');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Drivers"
        sub="The people behind the wheel — HOS cycle and home timezone."
      />

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Add a driver</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              Full name
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marie Tremblay" />
            </label>
            <label>
              License number
              <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g. 1234567" />
            </label>
            <label>
              HOS cycle
              <select value={cycle} onChange={(e) => setCycle(e.target.value as 'CYCLE_1' | 'CYCLE_2')}>
                <option value="CYCLE_1">Cycle 1 — 70h / 7 days</option>
                <option value="CYCLE_2">Cycle 2 — 120h / 14 days</option>
              </select>
            </label>
            <label>
              Home timezone
              <select value={tz} onChange={(e) => setTz(e.target.value)}>
                <option value="America/Toronto">Eastern (Toronto)</option>
                <option value="America/Montreal">Eastern (Montréal)</option>
                <option value="America/Winnipeg">Central (Winnipeg)</option>
                <option value="America/Edmonton">Mountain (Edmonton)</option>
                <option value="America/Vancouver">Pacific (Vancouver)</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add driver'}</button>
          </div>
        </form>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading drivers…</span></div>
      ) : rows.length === 0 ? (
        <Empty title="No drivers yet" sub="Add your first driver above." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>License</th>
                <th>HOS cycle</th>
                <th>Hours left</th>
                <th>Timezone</th>
                <th>Status</th>
                <th>On trip</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                    {d.externalEldId && <div className="muted small">ELD: {d.externalEldId}</div>}
                  </td>
                  <td>{d.licenseNumber ?? '—'}</td>
                  <td>{d.cycleType}</td>
                  <td title={hos[d.id]?.warnings.join(' · ') || undefined}>
                    {hos[d.id] ? (
                      <>
                        <Badge
                          tone={
                            hos[d.id].violations.length > 0
                              ? 'red'
                              : hos[d.id].warnings.length > 0
                                ? 'amber'
                                : 'green'
                          }
                        >
                          {hoursShort(hos[d.id].remaining7)} left
                        </Badge>
                        {hos[d.id].limit14 != null && hos[d.id].remaining14 != null && (
                          <div className="muted small">14d: {hoursShort(hos[d.id].remaining14)} left</div>
                        )}
                      </>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>{d.homeTerminalTz}</td>
                  <td><Badge tone={d.status === 'ACTIVE' ? 'green' : d.status === 'SUSPENDED' ? 'red' : 'gray'}>{d.status}</Badge></td>
                  <td>
                    {onTrip[d.id] ? <Badge tone="cyan">{onTrip[d.id]}</Badge> : <span className="muted small">—</span>}
                  </td>
                  <td>
                    <button className="btn-sm" onClick={() => setDispatchFor(d)}>Dispatch</button>
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
        driver={dispatchFor}
        onSaved={() => load()}
      />
    </div>
  );
}