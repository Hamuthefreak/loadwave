import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api, getRefreshToken } from '../../api';
import { Modal, PageHeader, Spinner } from '../../components/ui';
import { shortDate, timeAgo } from '../../utils/format';

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
}

interface SessionsResponse {
  sessions: SessionRow[];
  currentId: string | null;
}

interface SetupResult {
  secret: string;
  otpauthUrl: string;
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('Mac OS') || ua.includes('Macintosh')
      ? 'macOS'
      : ua.includes('iPhone')
        ? 'iPhone'
        : ua.includes('iPad')
          ? 'iPad'
          : ua.includes('Android')
            ? 'Android'
            : ua.includes('Linux')
              ? 'Linux'
              : '';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Browser';
}

type TwoFactorStep = 'idle' | 'intro' | 'scan' | 'codes';

export default function Settings() {
  // --- Change password ----------------------------------------------------
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  // --- Two-factor ---------------------------------------------------------
  const [twoFactorOn, setTwoFactorOn] = useState<boolean | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorStep, setTwoFactorStep] = useState<TwoFactorStep>('idle');
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // --- Sessions -----------------------------------------------------------
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      const res = await api<SessionsResponse>('/auth/sessions', {
        method: 'POST',
        body: { refreshToken: getRefreshToken() ?? undefined },
      });
      setSessions(res);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not load sessions');
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    api<{ enabled: boolean; required: boolean }>('/auth/2fa/status')
      .then((r) => {
        setTwoFactorOn(r.enabled);
        setTwoFactorRequired(r.required);
      })
      .catch(() => setTwoFactorOn(false));
  }, [loadSessions]);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);
    if (pwForm.next !== pwForm.confirm) {
      setPwError("Those passwords don't match.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }
    setPwBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: pwForm.current,
          newPassword: pwForm.next,
          refreshToken: getRefreshToken() ?? undefined,
        },
      });
      setPwForm({ current: '', next: '', confirm: '' });
      setPwDone(true);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setPwBusy(false);
    }
  };

  const startSetup = async () => {
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const res = await api<SetupResult>('/auth/2fa/setup', { method: 'POST' });
      setSetup(res);
      setTwoFactorStep('scan');
      const dataUrl = await QRCode.toDataURL(res.otpauthUrl, { width: 220, margin: 1, color: { dark: '#111827', light: '#ffffff' } });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setTwoFactorError(err instanceof Error ? err.message : 'Could not start setup');
      setTwoFactorStep('idle');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const verifySetup = async (e: FormEvent) => {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { code: twoFactorCode },
      });
      setRecoveryCodes(res.recoveryCodes);
      setTwoFactorStep('codes');
      setTwoFactorOn(true);
    } catch (err) {
      setTwoFactorError(err instanceof Error ? err.message : 'That code did not verify');
      setTwoFactorCode('');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    } catch {
      /* clipboard blocked — the codes stay on screen */
    }
  };

  const confirmDisable = async (e: FormEvent) => {
    e.preventDefault();
    setDisableError(null);
    setDisableBusy(true);
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { code: disableCode } });
      setTwoFactorOn(false);
      setShowDisable(false);
      setDisableCode('');
      setTwoFactorStep('idle');
      setSetup(null);
      setQrDataUrl(null);
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : 'Could not disable 2FA');
      setDisableCode('');
    } finally {
      setDisableBusy(false);
    }
  };

  const revokeSession = async (id: string) => {
    setSessionsBusy(true);
    try {
      await api(`/auth/sessions/${id}/revoke`, { method: 'POST' });
      await loadSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not revoke session');
    } finally {
      setSessionsBusy(false);
    }
  };

  const pwToggleRef = useRef<HTMLButtonElement>(null);
  void pwToggleRef;

  return (
    <div className="page settings-page">
      <PageHeader title="Settings & security" sub="Your account, your devices, your call." />

      <div className="settings-grid">
        {/* Change password */}
        <section className="panel settings-card">
          <h3>Password</h3>
          <p className="muted small">
            Changing your password signs out every other device — this one stays signed in.
          </p>
          <form onSubmit={submitPassword}>
            <label>
              Current password
              <input type="password" required autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} />
            </label>
            <label>
              New password
              <span className="small">At least 8 characters.</span>
              <input type="password" required minLength={8} autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} />
            </label>
            <label>
              Confirm new password
              <input type="password" required minLength={8} autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} />
            </label>
            {pwError && <div className="alert alert-error">{pwError}</div>}
            {pwDone && <div className="alert alert-success">Password updated — other devices were signed out.</div>}
            <button type="submit" disabled={pwBusy} className="btn-primary">
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </section>

        {/* Two-factor authentication */}
        <section className="panel settings-card">
          <h3>
            Two-factor authentication{' '}
            {twoFactorOn === null ? (
              <Spinner />
            ) : twoFactorOn ? (
              <span className="badge badge-green">On</span>
            ) : twoFactorRequired ? (
              <span className="badge badge-red">Required</span>
            ) : (
              <span className="badge badge-muted">Off</span>
            )}
          </h3>
          <p className="muted small">
            {twoFactorOn
              ? 'Every sign-in asks for a code from your authenticator app. Keep your recovery codes somewhere safe.'
              : twoFactorRequired
                ? "Your carrier requires two-factor authentication for office accounts — sign-in will ask you to set it up until it's on."
                : 'Add a second step to sign-in — a 6-digit code from an authenticator app like Google Authenticator, Authy or 1Password.'}
          </p>

          {twoFactorOn ? (
            <>
              <div className="settings-check-row">
                <span>✔️ Sign-ins require a verification code</span>
                <button className="btn-danger-outline" onClick={() => { setShowDisable(true); setDisableError(null); }}>
                  Turn off
                </button>
              </div>
              <button className="link-btn small" onClick={() => { setTwoFactorStep('intro'); }}>
                Show recovery codes
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={startSetup} disabled={twoFactorBusy}>
              {twoFactorBusy ? 'Generating…' : 'Set up two-factor authentication'}
            </button>
          )}

          {twoFactorError && <div className="alert alert-error" style={{ marginTop: 12 }}>{twoFactorError}</div>}
        </section>

        {/* Sessions */}
        <section className="panel settings-card">
          <h3>Active sessions</h3>
          <p className="muted small">Devices signed in to this account. Revoke anything you don't recognize.</p>
          {sessionsError && <div className="alert alert-error">{sessionsError}</div>}
          {sessionsBusy && sessions === null ? (
            <Spinner label="Loading sessions…" />
          ) : (
            <div className="session-list">
              {sessions?.sessions.map((s) => {
                const isCurrent = s.id === sessions.currentId;
                const active = !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now();
                return (
                  <div key={s.id} className={`session-row${active ? '' : ' session-row-dead'}`}>
                    <div className="session-main">
                      <span className="session-device">{deviceLabel(s.userAgent)}</span>
                      {isCurrent ? <span className="badge badge-green">This device</span> : active ? <span className="badge badge-muted">Active</span> : <span className="badge badge-muted">{s.revokedAt ? 'Revoked' : 'Expired'}</span>}
                      <span className="session-meta small muted">
                        Signed in {s.createdAt ? timeAgo(s.createdAt) : 'recently'} · expires {shortDate(s.expiresAt)}
                      </span>
                    </div>
                    {active && !isCurrent && (
                      <button className="link-btn small" onClick={() => void revokeSession(s.id)}>
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })}
              {sessions && sessions.sessions.length === 0 && <p className="muted small">No sessions yet.</p>}
            </div>
          )}
        </section>
      </div>

      {/* 2FA setup flow */}
      <Modal
        open={twoFactorStep === 'scan' || twoFactorStep === 'codes'}
        onClose={() => {
          if (twoFactorStep === 'codes') return; // recovery codes must be saved first
          setTwoFactorStep('idle');
          setSetup(null);
          setQrDataUrl(null);
          setTwoFactorError(null);
        }}
        title={twoFactorStep === 'codes' ? 'Your recovery codes' : 'Scan with your authenticator app'}
      >
        {twoFactorStep === 'scan' && setup && (
          <div className="twofactor-setup">
            <ol className="twofactor-steps">
              <li>Open your authenticator app and scan the QR code below.</li>
              <li>Can't scan? Type this secret instead: <code className="twofactor-secret">{setup.secret}</code></li>
              <li>Enter the 6-digit code it shows to confirm.</li>
            </ol>
            <div className="twofactor-qr">{qrDataUrl && <img src={qrDataUrl} alt="QR code to add Loadwave to your authenticator app" width={220} height={220} />}</div>
            <form onSubmit={verifySetup} className="twofactor-verify">
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
              />
              <button type="submit" disabled={twoFactorBusy || twoFactorCode.length !== 6} className="btn-primary">
                {twoFactorBusy ? 'Verifying…' : 'Enable two-factor authentication'}
              </button>
            </form>
            {twoFactorError && <div className="alert alert-error">{twoFactorError}</div>}
          </div>
        )}

        {twoFactorStep === 'codes' && recoveryCodes && (
          <div className="twofactor-codes">
            <div className="alert alert-warn">
              <strong>Save these now — they're shown only once.</strong> Each code signs you in a single
              time if you ever lose your phone.
            </div>
            <div className="recovery-grid">
              {recoveryCodes.map((c) => (
                <code key={c} className="recovery-code">{c.slice(0, 4)}-{c.slice(4)}</code>
              ))}
            </div>
            <div className="twofactor-codes-actions">
              <button className="btn-primary" onClick={() => void copyRecoveryCodes()}>
                {copiedCodes ? 'Copied ✓' : 'Copy all codes'}
              </button>
              <button className="btn-ghost" onClick={() => { setTwoFactorStep('idle'); setRecoveryCodes(null); setTwoFactorCode(''); setSetup(null); setQrDataUrl(null); }}>
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 2FA disable confirm */}
      <Modal open={showDisable} onClose={() => setShowDisable(false)} title="Turn off two-factor authentication?">
        <p className="small" style={{ marginTop: 0 }}>
          Enter a code from your authenticator app to confirm. Your account becomes password-only again.
        </p>
        <form onSubmit={confirmDisable}>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            maxLength={6}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
          />
          {disableError && <div className="alert alert-error">{disableError}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setShowDisable(false)}>Cancel</button>
            <button type="submit" disabled={disableBusy || disableCode.length !== 6} className="btn-danger">
              {disableBusy ? 'Turning off…' : 'Turn off 2FA'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}