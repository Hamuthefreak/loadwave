import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, PageHeader } from '../../components/ui';

interface Driver {
  id: string;
  name: string;
  externalEldId: string | null;
  licenseNumber: string | null;
  homeTerminalTz: string;
  cycleType: 'CYCLE_1' | 'CYCLE_2';
  status: string;
}

export default function Drivers() {
  const [rows, setRows] = useState<Driver[]>([]);
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
      setRows(await api<Driver[]>('/api/drivers'));
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
                <th>Timezone</th>
                <th>Status</th>
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
                  <td>{d.homeTerminalTz}</td>
                  <td><Badge tone={d.status === 'ACTIVE' ? 'green' : 'gray'}>{d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}