import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Badge, Modal } from './ui';
import { timeAgo } from '../utils/format';

interface SavedSearchRow {
  id: string;
  name: string;
  notify: boolean;
  createdAt: string;
}

export function SaveSearchModal({
  open,
  onClose,
  filters,
  laneLabel,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  filters: Record<string, string>;
  laneLabel: string | null;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<SavedSearchRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api<SavedSearchRow[]>('/api/searches'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load saved searches');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFlash(null);
    setName('');
    void load();
  }, [open, load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/searches', {
        method: 'POST',
        body: {
          name: name.trim() || (laneLabel ? `${laneLabel} · alerts` : 'Board alerts'),
          filters,
          notify: true,
        },
      });
      setFlash('Saved — you’ll get a notification the moment a new load matches.');
      onSaved?.();
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the search');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: SavedSearchRow) => {
    try {
      await api(`/api/searches/${row.id}`, { method: 'PATCH', body: { notify: !row.notify } });
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, notify: !row.notify } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the alert');
    }
  };

  const remove = async (row: SavedSearchRow) => {
    try {
      await api(`/api/searches/${row.id}`, { method: 'DELETE' });
      setRows((cur) => cur.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the search');
    }
  };

  const laneSummary = Object.keys(filters).length
    ? (laneLabel ?? `${Object.keys(filters).length} filter${Object.keys(filters).length === 1 ? '' : 's'} applied`)
    : 'no filters (alerts on every posted load)';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save & alert me"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-green" type="submit" form="save-search-form" disabled={busy}>
            {busy ? 'Saving…' : 'Save with alerts'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}
      {flash && <div className="alert alert-success">{flash}</div>}

      <form id="save-search-form" onSubmit={(e) => void save(e)}>
        <label style={{ display: 'block' }}>
          What are you watching?
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={laneLabel ? `${laneLabel} · alerts` : 'Board alerts'}
            style={{ marginTop: 6 }}
          />
        </label>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Current search: <strong>{laneSummary}</strong>. We check every few minutes and ping your
          notification feed (and email, if configured) when a new load appears.
        </p>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />

      <h4 style={{ margin: '0 0 6px' }}>Your saved searches</h4>
      {rows.length === 0 ? (
        <p className="muted small">Nothing saved yet — save your current filters above.</p>
      ) : (
        <ul className="doc-list">
          {rows.map((r) => (
            <li key={r.id} className="doc-item">
              <div>
                <strong>{r.name}</strong>
                <div className="muted small">saved {timeAgo(r.createdAt)}</div>
              </div>
              <span className="row-actions" style={{ flexDirection: 'row', alignItems: 'center' }}>
                {r.notify ? <Badge tone="green">Alerts on</Badge> : <Badge tone="gray">Muted</Badge>}
                <button className="btn-sm" onClick={() => void toggle(r)}>
                  {r.notify ? 'Mute' : 'Enable'}
                </button>
                <button className="btn-sm" onClick={() => void remove(r)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
