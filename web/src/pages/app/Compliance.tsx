import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, Modal, PageHeader, Stat, type Tone } from '../../components/ui';

type ComplianceSubject = 'DRIVER' | 'ASSET' | 'TENANT';
type ComplianceStatus = 'EXPIRED' | 'MISSING' | 'EXPIRING' | 'OK';

interface ChecklistItem {
  kind: string;
  label: string;
  scope: ComplianceSubject;
  required: boolean;
  reference: string;
  status: ComplianceStatus;
  expiresAt: string | null;
  daysUntil: number | null;
  identifier: string | null;
  hasFile: boolean;
  /** Row id of the document on file, so update/delete need no second lookup. */
  documentId: string | null;
  notes: string | null;
}

interface SubjectView {
  subject: ComplianceSubject;
  subjectId: string;
  label: string;
  detail: string | null;
  status: ComplianceStatus;
  headline: string;
  items: ChecklistItem[];
}

interface OverrideRow {
  id: string;
  loadId: string;
  loadReference: string | null;
  driverId: string | null;
  assetId: string | null;
  blockers: Array<{ label: string; kind: string; status: ComplianceStatus; expiresAt: string | null }>;
  reason: string;
  actorName: string | null;
  createdAt: string;
}

interface ComplianceView {
  asOf: string;
  drivers: SubjectView[];
  assets: SubjectView[];
  carrier: SubjectView;
  totals: { expired: number; missing: number; expiring: number; ok: number };
  overrides: OverrideRow[];
}

interface KindSpec {
  kind: string;
  label: string;
  scope: ComplianceSubject;
  required: boolean;
  validityMonths: number | null;
  reference: string;
}

const STATUS_TONE: Record<ComplianceStatus, Tone> = {
  EXPIRED: 'red',
  MISSING: 'amber',
  EXPIRING: 'amber',
  OK: 'green',
};

const STATUS_WORD: Record<ComplianceStatus, string> = {
  EXPIRED: 'Expired',
  MISSING: 'Not on file',
  EXPIRING: 'Expiring',
  OK: 'On file',
};

function expiryText(item: ChecklistItem): string {
  if (item.status === 'MISSING') return 'Nothing on file';
  if (!item.expiresAt) return 'No expiry date';
  const date = item.expiresAt.slice(0, 10);
  if (item.status === 'EXPIRED') {
    const days = item.daysUntil === null ? null : Math.abs(item.daysUntil);
    return `Expired ${date}${days ? ` · ${days} day${days === 1 ? '' : 's'} ago` : ''}`;
  }
  if (item.status === 'EXPIRING') {
    const days = item.daysUntil ?? 0;
    return `Expires ${date} · ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`;
  }
  return `Valid to ${date}`;
}

export default function Compliance() {
  const [view, setView] = useState<ComplianceView | null>(null);
  const [kinds, setKinds] = useState<KindSpec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<SubjectView | null>(null);
  // Which document the editor is open on, or 'new'.
  const [editing, setEditing] = useState<ChecklistItem | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [v, k] = await Promise.all([
        api<ComplianceView>('/api/compliance'),
        api<{ kinds: KindSpec[] }>('/api/compliance/kinds'),
      ]);
      setView(v);
      setKinds(k.kinds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load compliance records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const subjects = useMemo(
    () => (view ? [...view.drivers, ...view.assets, view.carrier] : []),
    [view],
  );

  if (loading && !view) {
    return (
      <div className="spinner-wrap">
        <span className="spinner" aria-hidden />
        <span className="muted small">Loading compliance records…</span>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Compliance"
        sub="The paperwork that decides whether a truck may legally move."
        actions={<button className="btn-ghost" onClick={() => void load()}>↻ Refresh</button>}
      />

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {view && (
        <>
          <div className="grid">
            <Stat
              label="Expired"
              value={view.totals.expired}
              sub="Already out of date"
              tone={view.totals.expired > 0 ? 'red' : 'green'}
            />
            <Stat
              label="Not on file"
              value={view.totals.missing}
              sub="Required documents with nothing recorded"
              tone={view.totals.missing > 0 ? 'amber' : 'green'}
            />
            <Stat
              label="Expiring"
              value={view.totals.expiring}
              sub="Inside the next 30 days"
              tone={view.totals.expiring > 0 ? 'amber' : 'green'}
            />
            <Stat label="On file" value={view.totals.ok} sub="Current" tone="cyan" />
          </div>

          <p className="muted small" style={{ marginTop: 0 }}>
            Nothing here is a legal opinion — it is what you have recorded. Expiry dates come from
            the document itself; annual items get their date derived from the issue date.
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Status</th>
                  <th>Most urgent</th>
                  <th>Open items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => {
                  const open1 = s.items.filter(
                    (i) => i.status === 'EXPIRED' || (i.required && i.status === 'MISSING') || i.status === 'EXPIRING',
                  );
                  return (
                    <tr key={`${s.subject}:${s.subjectId}`}>
                      <td>
                        <strong>{s.label}</strong>
                        <div className="muted small">{s.detail ?? s.subject.toLowerCase()}</div>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[s.status]}>{STATUS_WORD[s.status]}</Badge>
                      </td>
                      <td>{s.headline}</td>
                      <td className="mono-num">{open1.length}</td>
                      <td>
                        <button className="btn-sm" onClick={() => setOpen(s)}>
                          Open file
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && view && subjects.length === 0 && (
        <Empty title="Nothing to track yet" sub="Add a driver or a unit first — their documents hang off them." />
      )}

      {/* A dispatch on a lapsed document is the thing this module exists to stop,
          so when somebody overrode that it belongs on the same screen — not
          buried in an audit log nobody opens. */}
      {view && view.overrides.length > 0 && (
        <section className="card override-log">
          <h3 style={{ marginBottom: 2 }}>Dispatches cleared despite a lapse</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Each one was allowed deliberately, with a reason recorded against the person who made the call.
          </p>
          <ul className="query-list">
            {view.overrides.map((o) => (
              <li className="query-row query-row-done" key={o.id}>
                <div className="query-row-main">
                  <div className="query-row-title">
                    <strong>{o.loadReference ?? o.loadId.slice(0, 8).toUpperCase()}</strong>
                    <Badge tone="red">
                      {o.blockers.length} lapsed document{o.blockers.length === 1 ? '' : 's'}
                    </Badge>
                    <span className="muted small">{o.createdAt.slice(0, 10)}</span>
                  </div>
                  <span className="muted small">
                    {o.blockers.map((b) => `${b.label} — ${b.kind}`).join(' · ')}
                  </span>
                  <span className="muted small">“{o.reason}”</span>
                  <span className="muted small">
                    {o.actorName ? `Recorded against ${o.actorName}` : 'No account recorded'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={open !== null}
        onClose={() => {
          setOpen(null);
          setEditing(null);
        }}
        title={open ? `${open.label} — compliance file` : 'Compliance file'}
      >
        {open && (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              {open.headline}
            </p>
            <div className="compliance-list">
              {open.items.map((item) => (
                <div className="compliance-row" key={item.kind}>
                  <div className="compliance-row-main">
                    <span className="compliance-row-label">
                      {item.label}
                      {!item.required && <span className="muted small"> · optional</span>}
                    </span>
                    <span className="muted small">
                      {expiryText(item)}
                      {item.hasFile ? ' · scan on file' : ''}
                      {item.identifier ? ` · ${item.identifier}` : ''}
                    </span>
                  </div>
                  <Badge tone={STATUS_TONE[item.status]}>{STATUS_WORD[item.status]}</Badge>
                  <button className="btn-sm" onClick={() => setEditing(item)}>
                    {item.status === 'MISSING' ? 'Add' : 'Update'}
                  </button>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Requirement references come straight from the rulebook so you can check them — for
              example {open.items[0]?.reference}.
            </p>
          </>
        )}
      </Modal>

      {open && (
        <DocumentEditor
          subject={open}
          kinds={kinds}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setNotice(msg);
            const v = await api<ComplianceView>('/api/compliance');
            setView(v);
            // Keep the open file in sync with the refreshed data.
            const fresh = [...v.drivers, ...v.assets, v.carrier].find(
              (s) => s.subject === open.subject && s.subjectId === open.subjectId,
            );
            if (fresh) setOpen(fresh);
            window.setTimeout(() => setNotice(null), 4000);
          }}
        />
      )}
    </div>
  );
}

function DocumentEditor({
  subject,
  kinds,
  editing,
  onCancel,
  onSaved,
}: {
  subject: SubjectView;
  kinds: KindSpec[];
  editing: ChecklistItem | 'new' | null;
  onCancel: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const relevant = useMemo(
    () => kinds.filter((k) => k.scope === subject.subject),
    [kinds, subject.subject],
  );
  const existing = editing && editing !== 'new' ? editing : null;
  const editingKind = existing?.kind ?? null;
  const [kind, setKind] = useState(existing?.kind ?? relevant[0]?.kind ?? '');
  const [identifier, setIdentifier] = useState(existing?.identifier ?? '');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset the form when the *target* document changes, and only then. Keying
  // this on `existing` or `relevant` re-ran it on every render — they're new
  // objects each time — so it wiped the field the user had just typed into and
  // the saved note came back empty.
  useEffect(() => {
    setKind(existing?.kind ?? relevant[0]?.kind ?? '');
    setIdentifier(existing?.identifier ?? '');
    setExpiresAt(existing?.expiresAt?.slice(0, 10) ?? '');
    setIssuedAt('');
    setNotes(existing?.notes ?? '');
    setFile(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKind, existing?.documentId, subject.subject, subject.subjectId]);

  const spec = kinds.find((k) => k.kind === kind);
  const derivesExpiry = Boolean(spec?.validityMonths && !expiresAt && issuedAt);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      let data: string | undefined;
      let fileName: string | undefined;
      let mimeType: string | undefined;
      if (file) {
        // Base64 in the JSON body, same as POD uploads: one request, no signed URL.
        const buf = await file.arrayBuffer();
        data = base64FromBytes(new Uint8Array(buf));
        fileName = file.name;
        mimeType = file.type || 'application/octet-stream';
      }
      await api(`/api/compliance/${subject.subject}/${subject.subjectId}/${kind}`, {
        method: 'PUT',
        body: {
          identifier: identifier || null,
          issuedAt: issuedAt || null,
          expiresAt: expiresAt || null,
          notes: notes || null,
          ...(data ? { data, fileName, mimeType } : {}),
        },
      });
      await onSaved(existing ? `${existing.label} updated.` : 'Document saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that document');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing?.documentId) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/compliance/${existing.documentId}`, { method: 'DELETE', body: {} });
      await onSaved(`${existing.label} removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that document');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={editing !== null}
      onClose={onCancel}
      title={existing ? `Update ${existing.label}` : 'Add a document'}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-green" form="compliance-form" type="submit" disabled={busy || !kind}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="compliance-form" onSubmit={submit}>
        {!existing && (
          <label>
            Document
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {relevant.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                  {k.required ? '' : ' (optional)'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-grid">
          <label>
            Number on the document
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="licence, policy or plate"
            />
          </label>
          <label>
            Issued
            <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </label>
          <label>
            Expires
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
        </div>
        {derivesExpiry && (
          <p className="muted small">
            Leaving this blank records a {spec?.validityMonths}-month validity from the issue date
            ({spec?.reference}).
          </p>
        )}
        <label>
          Scan or photo {existing?.hasFile ? '(leaving this empty keeps the one on file)' : '(optional)'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything the office needs to know" />
        </label>
        {spec && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Requirement: {spec.reference}
          </p>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        {existing && (
          <div className="form-actions">
            <button type="button" className="btn-danger" onClick={() => void remove()} disabled={deleting}>
              {deleting ? 'Removing…' : 'Remove from file'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** btoa on a byte array, chunked so a photo doesn't blow the argument limit. */
function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
