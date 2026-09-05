import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AUDIT_ROUTES,
  getAudit,
  pushStep,
  setCurrentPath,
  stopAudit,
  subscribeAudit,
  type AuditRoute,
  type StepResult,
} from '../diagnostics/audit';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(pred: () => boolean, timeout: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return;
    await wait(40);
  }
}

async function runStep(route: AuditRoute, navigate: (p: string) => void): Promise<StepResult> {
  const errors: string[] = [];
  const start = performance.now();
  const origError = console.error;
  const origFetch = window.fetch;

  const onErr = (e: ErrorEvent) => errors.push(e.message || 'uncaught error');
  const onRej = (e: PromiseRejectionEvent) =>
    errors.push(e.reason instanceof Error ? e.reason.message : String(e.reason));

  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    try {
      const r = await origFetch(...args);
      if (!r.ok) errors.push(`fetch ${r.status} ${String(args[0])}`);
      return r;
    } catch (e) {
      errors.push(`fetch failed ${String(args[0])}`);
      throw e;
    }
  }) as typeof fetch;

  try {
    navigate(route.path);
    const reached = () =>
      window.location.pathname === route.path ||
      (route.expectRedirect ? window.location.pathname === route.expectRedirect : false) ||
      Boolean(route.protected && window.location.pathname === '/signin');
    await waitUntil(reached, 5000);
    await wait(700);

    const finalPath = window.location.pathname;
    const expectedRedirect = route.expectRedirect !== undefined && finalPath === route.expectRedirect;
    const protectedRedirect = route.protected && finalPath === '/signin';

    let markerFound = true;
    if (route.marker) markerFound = Boolean(document.querySelector(route.marker));
    if (route.text) markerFound = markerFound && document.body.innerText.includes(route.text);
    // Auth/404 redirects are expected behavior, not a missing render.
    if (expectedRedirect || protectedRedirect) markerFound = true;

    const ok = errors.length === 0 && markerFound;
    return {
      path: route.path,
      name: route.name,
      ok,
      errors,
      markerFound,
      redirectedTo: finalPath !== route.path ? finalPath : undefined,
      elapsedMs: Math.round(performance.now() - start),
      note: expectedRedirect
        ? 'expected redirect to /'
        : protectedRedirect
          ? 'protected (redirected to sign-in)'
          : undefined,
    };
  } finally {
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    console.error = origError;
    window.fetch = origFetch;
  }
}

export default function DiagnosticsHarness() {
  const navigate = useNavigate();
  const [state, setState] = useState(getAudit());
  const runningRef = useRef(false);

  useEffect(() => subscribeAudit(() => setState(getAudit())), []);

  useEffect(() => {
    if (!state.running || runningRef.current) return;
    runningRef.current = true;

    void (async () => {
      for (const route of AUDIT_ROUTES) {
        if (!getAudit().running) break;
        setCurrentPath(route.path);
        const result = await runStep(route, (p) => navigate(p));
        if (getAudit().running) pushStep(result);
      }
      navigate('/diagnostics');
      stopAudit();
      runningRef.current = false;
    })();
  }, [state.running, navigate]);

  if (!state.running) return null;

  const total = AUDIT_ROUTES.length;
  const done = state.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="diag-overlay" role="status" aria-live="polite">
      <div className="diag-overlay-card">
        <div className="diag-overlay-head">
          <span className="diag-pulse" aria-hidden />
          <span>Site diagnostic running</span>
          <button className="icon-btn" onClick={() => stopAudit()} aria-label="Stop diagnostic">
            ✕
          </button>
        </div>
        <div className="diag-progress" aria-hidden>
          <div className="diag-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="diag-overlay-meta">
          {done}/{total} · {state.currentPath ?? '…'}
        </div>
      </div>
    </div>
  );
}
