import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, getToken } from '../api';
import { Modal } from './ui';
import { shortDate } from '../utils/format';

interface DocRow {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const KINDS = [
  { value: 'POD', label: 'Proof of delivery (POD)' },
  { value: 'BOL', label: 'Bill of lading (BOL)' },
  { value: 'DAMAGE', label: 'Damage photo' },
  { value: 'OTHER', label: 'Other' },
];

const MAX_BYTES = 10 * 1024 * 1024;

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function LoadDocumentsModal({
  open,
  onClose,
  loadId,
  laneLabel,
}: {
  open: boolean;
  onClose: () => void;
  loadId: string | null;
  laneLabel?: string;
}) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [kind, setKind] = useState('POD');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (loadIdParam: string) => {
    setError(null);
    try {
      setDocs(await api<DocRow[]>(`/api/loads/${loadIdParam}/documents`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    }
  }, []);

  useEffect(() => {
    if (!open || !loadId) return;
    setSuccess(null);
    void load(loadId);
  }, [open, loadId, load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loadId) return;
    const input = (e.target as HTMLFormElement).elements.namedItem('file') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError('Pick a file to upload first.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File is too large — keep it under ${MAX_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reader = new FileReader();
      const data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });
      await api(`/api/loads/${loadId}/documents`, {
        method: 'POST',
        body: {
          kind,
          fileName: fileName.trim() || file.name,
          mimeType: file.type || 'application/octet-stream',
          data,
        },
      });
      setFileName('');
      input.value = '';
      setSuccess(`${kind === 'POD' ? 'POD' : kind} attached — it's now part of this load's paperwork.`);
      await load(loadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — try again');
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: DocRow) => {
    if (!loadId || downloading) return;
    setDownloading(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/documents/${doc.id}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delivery paperwork"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-green" type="submit" form="pod-upload-form" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload file'}
          </button>
        </>
      }
    >
      {laneLabel && <p className="muted small" style={{ marginTop: 0, fontWeight: 700 }}>{laneLabel}</p>}
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <h4 style={{ margin: '0 0 8px' }}>Attach a document</h4>
      <form id="pod-upload-form" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <label>
            File name (optional)
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="Keeps the original name" />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 10 }}>
          <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" />
          <span className="muted small">PDF or photo up to 10 MB</span>
        </label>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

      <h4 style={{ margin: 0 }}>On file ({docs.length})</h4>
      {docs.length === 0 ? (
        <p className="muted small">Nothing attached yet — upload the signed POD once delivery is confirmed.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="doc-item">
              <div>
                <strong>{d.fileName}</strong>
                <div className="muted small">
                  {d.kind} · {fileSize(d.sizeBytes)} · {shortDate(d.createdAt)}
                </div>
              </div>
              <button className="btn-sm" disabled={downloading === d.id} onClick={() => void download(d)}>
                {downloading === d.id ? 'Opening…' : 'Download'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
