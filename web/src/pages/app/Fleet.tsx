import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, PageHeader } from '../../components/ui';

interface Asset {
  id: string;
  vin: string | null;
  powerUnitNumber: string | null;
  assetType: 'TRACTOR' | 'TRAILER';
  eldDeviceId: string | null;
}

export default function Fleet() {
  const [rows, setRows] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<'TRACTOR' | 'TRAILER'>('TRACTOR');
  const [powerUnit, setPowerUnit] = useState('');
  const [vin, setVin] = useState('');
  const [eldId, setEldId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Asset[]>('/api/assets'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fleet');
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
      await api<Asset>('/api/assets', {
        method: 'POST',
        body: { assetType: type, powerUnitNumber: powerUnit || undefined, vin: vin || undefined, eldDeviceId: eldId || undefined },
      });
      setPowerUnit('');
      setVin('');
      setEldId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add asset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Fleet" sub="Your power units and trailers." />

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Add equipment</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value as 'TRACTOR' | 'TRAILER')}>
                <option value="TRACTOR">Tractor (power unit)</option>
                <option value="TRAILER">Trailer</option>
              </select>
            </label>
            <label>
              Power unit number
              <input value={powerUnit} onChange={(e) => setPowerUnit(e.target.value)} placeholder="e.g. TRK-001" />
            </label>
            <label>
              VIN
              <input value={vin} onChange={(e) => setVin(e.target.value)} placeholder="e.g. 1FUJBB..." />
            </label>
            <label>
              ELD device ID
              <input value={eldId} onChange={(e) => setEldId(e.target.value)} placeholder="e.g. ELD-4A9F" />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add equipment'}</button>
          </div>
        </form>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading fleet…</span></div>
      ) : rows.length === 0 ? (
        <Empty title="No equipment yet" sub="Add your tractor so ELD and fuel records can attach to it." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Power unit</th>
                <th>VIN</th>
                <th>ELD device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><Badge tone={a.assetType === 'TRACTOR' ? 'blue' : 'purple'}>{a.assetType}</Badge></td>
                  <td><strong>{a.powerUnitNumber ?? '—'}</strong></td>
                  <td className="mono-num">{a.vin ?? '—'}</td>
                  <td>{a.eldDeviceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}