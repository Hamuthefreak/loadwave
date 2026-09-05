import { useEffect, useState } from 'react';
import { getAudit, startAudit, subscribeAudit } from '../diagnostics/audit';

// The admin key lives in memory only (never localStorage) so it can't be read
// from devtools after the tab closes.
const KEY_STORE: { value: string | null } = { value: null };

interface ServerReport {
  ok: boolean;
  configured: boolean;
  message?: string;
  app?: { name: string; env: string; port: number; uptimeMs: number };
  env?: Record<string, boolean>;
  db?: { reachable: boolean; tenantCount?: number; loadCount?: number; boardLoadCount?: number; error?: string };
  checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  modules?: string[];
}

export default function Diagnostics() {
  const [key, setKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [report, setReport] = useState<ServerReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState(getAudit());

  useEffect(() => subscribeAudit(() => setAudit(getAudit())), []);

  useEffect(() => {
    if (KEY_STORE.value) {
      setUnlocked(true);
      void fetchReport(KEY_STORE.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchReport = async (k: string) => {
    setLoading(true);
    setReportError(null);
    try {
      const res = await fetch('/api/diagnostics', { headers: { 'x-admin-key': k } });
      const data = (await res.json()) as ServerReport;
      if (!res.ok || !data.ok) {
        setReport(null);
        setReportError(data.message ?? `Server responded ${res.status}`);
      } else {
        setReport(data);
      }
    } catch {
      setReport(null);
      setReportError('Backend unreachable — is the server running? The client-side page audit still works.');
    } finally {
      setLoading(false);
    }
  };

  const unlock = async () => {
    if (!key.trim()) return;
    KEY_STORE.value = key.trim();
    setUnlocked(true);
    await fetchReport(key.trim());
  };

  const unlockFile = async (file: File) => {
    const text = (await file.text()).trim();
    KEY_STORE.value = text;
    setKey(text);
    setUnlocked(true);
    await fetchReport(text);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ report, steps: audit.steps }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loadwave-diagnostics.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const okSteps = audit.steps.filter((s) => s.ok).length;
  const failedSteps = audit.steps.filter((s) => !s.ok);

  return (
    <div className="diag-page">
      <div className="diag-shell">
        <div className="diag-head">
          <span className="ld-wordmark">Loadwave</span>
          <span className="diag-badge">System diagnostics</span>
        </div>

        {!unlocked ? (
          <section className="diag-card">
            <h2>Unlock diagnostics</h2>
            <p className="diag-muted">
              This tool tests every page in the app. It's protected by an admin key — enter it
              below or upload a <code>.key</code> file. Set <code>DIAGNOSTICS_ADMIN_KEY</code>{' '}
              (or <code>DIAGNOSTICS_KEY_FILE</code>) on the server to enable it.
            </p>
            <form
              className="diag-form"
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Admin key"
                autoComplete="off"
                aria-label="Admin key"
              />
              <button type="submit" className="btn-primary">
                Unlock
              </button>
            </form>
            <label className="diag-file">
              <span>Or upload a key file</span>
              <input
                type="file"
                accept=".key,.txt,.env"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void unlockFile(f);
                }}
              />
            </label>
          </section>
        ) : (
          <>
            <section className="diag-card">
              <div className="diag-card-head">
                <h2>Server report</h2>
                <button className="btn-ghost btn-sm" onClick={() => void fetchReport(key)} disabled={loading}>
                  {loading ? 'Checking…' : 'Refresh'}
                </button>
              </div>

              {reportError && <div className="alert alert-error">{reportError}</div>}

              {report && (
                <>
                  <div className="diag-kv">
                    <div className="detail-row"><dt>App</dt><dd>{report.app?.name} · {report.app?.env} · :{report.app?.port}</dd></div>
                    <div className="detail-row"><dt>Uptime</dt><dd>{Math.round((report.app?.uptimeMs ?? 0) / 1000)}s</dd></div>
                    <div className="detail-row"><dt>Database</dt><dd>{report.db?.reachable ? `reachable · ${report.db.tenantCount} tenants · ${report.db.loadCount} loads · ${report.db.boardLoadCount} on board` : `unreachable (${report.db?.error ?? 'n/a'})`}</dd></div>
                  </div>
                  <div className="diag-checks">
                    {(report.checks ?? []).map((c) => (
                      <div key={c.name} className="diag-check">
                        <span className={`diag-check-dot ${c.ok ? 'ok' : 'bad'}`} aria-hidden />
                        <span>{c.name}</span>
                        {c.detail && <span className="diag-muted">{c.detail}</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="diag-card-head" style={{ marginTop: 18 }}>
                <h2>Client page audit</h2>
                <button className="btn-primary" onClick={() => startAudit()} disabled={audit.running}>
                  {audit.running ? 'Running…' : audit.steps.length ? 'Run again' : 'Run full audit'}
                </button>
              </div>

              {audit.steps.length > 0 && (
                <div className="diag-summary">
                  <span><b className="ok-text">{okSteps}</b> passed</span>
                  <span><b className="bad-text">{failedSteps.length}</b> failed</span>
                  <span>of {audit.steps.length} routes</span>
                  <button className="btn-ghost btn-sm" onClick={exportJson}>Export JSON</button>
                </div>
              )}

              {audit.steps.length > 0 && (
                <div className="table-scroll">
                  <table className="diag-table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th>Status</th>
                        <th>Marker</th>
                        <th>Time</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.steps.map((s) => (
                        <tr key={s.path}>
                          <td><code>{s.path}</code></td>
                          <td>
                            <span className={`diag-status ${s.ok ? 'ok' : 'bad'}`}>{s.ok ? 'PASS' : 'FAIL'}</span>
                          </td>
                          <td>{s.markerFound ? '✓' : '✕'}</td>
                          <td className="mono-num">{s.elapsedMs}ms</td>
                          <td className="diag-detail">
                            {s.note ?? ''}
                            {s.errors.length > 0 && (
                              <ul>
                                {s.errors.slice(0, 4).map((e, i) => (
                                  <li key={i}>{e}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {audit.running && (
              <p className="diag-muted">
                Audit is running — you'll be returned here when it finishes.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
