import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, purgeOfflineCache, setTokens } from '../api';

interface AuthResponse {
  user: { email: string; roles: string[] };
  tenant: { id: string; name: string; baseCurrency: string; baseJurisdiction: string };
  tokens: { accessToken: string; refreshToken: string };
  recoveryCodes?: string[];
}

type LoginResponse = AuthResponse | { requiresTwoFactor: true; twoFactorToken: string; setupRequired?: boolean };

type Mode = 'signin' | 'signup' | 'invite';
// creds → code (normal 2FA), or creds → setup → codes (tenant-mandated 2FA).
type Step = 'creds' | 'code' | 'setup' | 'codes';

export default function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  const inviteToken = params.get('invite');
  const [mode, setMode] = useState<Mode>(inviteToken ? 'invite' : params.get('mode') === 'signup' ? 'signup' : 'signin');

  useEffect(() => {
    if (inviteToken && mode !== 'invite') setMode('invite');
  }, [inviteToken, mode]);

  // Keep the tab in sync with the URL: the marketing nav links between
  // /signin and /signin?mode=signup, and when you're already on this page
  // the route change must flip the form — not silently do nothing.
  useEffect(() => {
    if (inviteToken) return;
    const want: Mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
    setMode((cur) => (cur === 'invite' ? cur : want));
  }, [params, inviteToken]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currency, setCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [jurisdiction, setJurisdiction] = useState('QC');
  const [mcNumber, setMcNumber] = useState('');
  const [usdotNumber, setUsdotNumber] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [step, setStep] = useState<Step>('creds');
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [forcedSetup, setForcedSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [forcedQr, setForcedQr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [verified, setVerified] = useState<AuthResponse | null>(null);

  const pwProps = { show: showPw, onToggle: () => setShowPw((s) => !s) };

  // Friendly, branded validation instead of the browser's raw bubble text
  // (someone typing "1" as their email gets a sentence they can act on).
  const vmsg = (message: string) => ({
    onInvalid: (e: React.InvalidEvent<HTMLInputElement>) => {
      e.currentTarget.setCustomValidity(message);
    },
    onInput: (e: React.ChangeEvent<HTMLInputElement>) => {
      e.currentTarget.setCustomValidity('');
    },
  });

  const emailCheck = vmsg('Enter a valid email address — like you@carrier.ca');
  const passwordCheck = vmsg('Your password needs at least 8 characters.');

  const toggleBtn = (visible: boolean, toggle: () => void) => (
    <button
      type="button"
      className="pw-toggle"
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      aria-label={visible ? 'Hide password' : 'Show password'}
      tabIndex={-1}
    >
      {visible ? 'Hide' : 'Show'}
    </button>
  );

  const finish = (res: AuthResponse) => {
    setTokens(res.tokens.accessToken, res.tokens.refreshToken, rememberMe);
    // Drop whoever was signed in before on this device — the offline cache
    // holds their loads and trips.
    void purgeOfflineCache().finally(() => {
      navigate(state?.from ?? '/app/dashboard', { replace: true });
    });
  };

  // Second half of a 2FA sign-in: the password already checked out, this
  // submits the authenticator (or recovery) code against the challenge token.
  // Tenant-mandated 2FA: fetch a fresh secret + QR for the sign-in screen.
  const startForcedSetup = async (token: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup-pending', {
        method: 'POST',
        body: { token },
      });
      setForcedSetup(res);
      setForcedQr(
        await QRCode.toDataURL(res.otpauthUrl, { width: 200, margin: 1, color: { dark: '#111827', light: '#ffffff' } }),
      );
      setTwoFactorToken(token);
      setStep('setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start two-factor setup');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!twoFactorToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api<AuthResponse>('/auth/2fa/verify-login', {
        method: 'POST',
        body: { token: twoFactorToken, code: twoFactorCode },
      });
      if (res.recoveryCodes) {
        // The sign-in itself enabled 2FA — recovery codes are shown once.
        setRecoveryCodes(res.recoveryCodes);
        setVerified(res);
        setStep('codes');
        return;
      }
      finish(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setTwoFactorCode('');
      codeInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'invite') {
        const res = await api<AuthResponse>('/api/team/invites/accept', {
          method: 'POST',
          body: { token: inviteToken, email, password },
        });
        finish(res);
      } else if (mode === 'signin') {
        const res = await api<LoginResponse>('/auth/login', {
          method: 'POST',
          body: { email, password, rememberMe },
        });
        if ('requiresTwoFactor' in res) {
          if (res.setupRequired) {
            await startForcedSetup(res.twoFactorToken);
          } else {
            setTwoFactorToken(res.twoFactorToken);
            setStep('code');
          }
          return;
        }
        finish(res);
      } else {
        const res = await api<AuthResponse>('/auth/register', {
          method: 'POST',
          body: {
            tenantName: companyName,
            email: newEmail,
            password: newPassword,
            tenantBaseCurrency: currency,
            tenantBaseJurisdiction: jurisdiction,
            mcNumber: mcNumber || undefined,
            usdotNumber: usdotNumber || undefined,
          },
        });
        finish(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ld-mkt ld-auth-wrap">
      <div className="ld-auth-shell">
        <div className="ld-auth-hero">
          <div className="ld-brand ld-brand-light">
            <span className="ld-wordmark">Loadwave.</span>
          </div>
          <h1>Run your truck like a business.</h1>
          <p>
            Find loads, book them in one tap, track every dollar and mile, and stay
            IFTA-ready — all from your phone or laptop.
          </p>
          <div className="points">
            <span><i>✓</i> Live load board with $/mile</span>
            <span><i>✓</i> Post a load or truck to partner carriers</span>
            <span><i>✓</i> Invoices, fuel and IFTA in one place</span>
            <span><i>✓</i> Carrier authority status on every card</span>
          </div>
        </div>

        <div className="ld-auth-card">
          <div className="ld-auth-brand">
            <span className="ld-wordmark" style={{ fontSize: '1.15rem' }}>
              Loadwave<span className="ld-wordmark-dot">.</span>
            </span>
          </div>
          {mode === 'invite' && (
            <p className="small" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
              <strong>You've been invited to join a carrier team.</strong> Finish creating your
              account below to get your role and sign in.
            </p>
          )}
          {mode !== 'invite' && (
          <div className="tabs" data-mode={mode} role="tablist" aria-label="Account mode">
            <span className="tabs-ind" aria-hidden />
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'active' : ''}
              onClick={() => { setMode('signin'); setError(null); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => { setMode('signup'); setError(null); }}
            >
              Create account
            </button>
          </div>
          )}

          <form onSubmit={submit} style={{ display: 'contents' }}>
            <div className="ld-auth-fields" key={mode}>
            {mode === 'signin' || mode === 'invite' ? (
              <>
                <label>
                  Email
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@carrier.ca" autoComplete="email" {...emailCheck} />
                </label>
                <label>
                  Password
                  <span className="pw-wrap">
                    <input type={showPw ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                    {toggleBtn(showPw, pwProps.onToggle)}
                  </span>
                </label>
                {mode === 'signin' && (
                  <p className="small" style={{ margin: '-6px 0 0', textAlign: 'right' }}>
                    <Link to="/forgot-password" style={{ color: 'var(--body)' }}>
                      Forgot password?
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <>
                <label>
                  Company / carrier name
                  <input required minLength={1} maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Maple Line Haulers" autoComplete="organization" />
                </label>
                <label>
                  Email
                  <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@carrier.ca" autoComplete="email" {...emailCheck} />
                </label>
                <label>
                  Password
                  <span className="small">
                    {newPassword.length === 0
                      ? 'At least 8 characters.'
                      : newPassword.length < 8
                        ? `${8 - newPassword.length} more character${8 - newPassword.length === 1 ? '' : 's'} to go…`
                        : '✓ Good to go.'}
                  </span>
                  <span className="pw-wrap">
                    <input type={showPw ? 'text' : 'password'} required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" {...passwordCheck} />
                    {toggleBtn(showPw, pwProps.onToggle)}
                  </span>
                </label>
                <div className="form-grid">
                  <label>
                    Base currency
                    <select value={currency} onChange={(e) => setCurrency(e.target.value as 'CAD' | 'USD')}>
                      <option value="CAD">CAD — Canadian $</option>
                      <option value="USD">USD — US $</option>
                    </select>
                  </label>
                  <label>
                    Home jurisdiction
                    <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                      {PROVINCES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    MC number <span className="small">(optional)</span>
                    <input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} placeholder="e.g. 123456" inputMode="numeric" autoComplete="off" />
                  </label>
                  <label>
                    USDOT <span className="small">(optional)</span>
                    <input value={usdotNumber} onChange={(e) => setUsdotNumber(e.target.value)} placeholder="e.g. 9876543" inputMode="numeric" autoComplete="off" />
                  </label>
                </div>
                <p className="ld-muted small" style={{ margin: 0 }}>
                  Adding your USDOT lets us check your authority against FMCSA records for an <strong>FMCSA-checked</strong> badge on the
                  load board.
                </p>
              </>
            )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" disabled={loading} className="btn-block">
              {loading
                ? 'One moment…'
                : mode === 'invite'
                  ? 'Accept invite & sign in'
                  : mode === 'signin'
                    ? 'Sign in'
                    : 'Create my account'}
            </button>
          </form>

          {mode === 'signin' && step === 'creds' && (
            <label className="remember-row">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me on this device</span>
            </label>
          )}

          {mode === 'signin' && step === 'code' && (
            <form onSubmit={submitCode} className="twofactor-screen">
              <div className="twofactor-icon" aria-hidden="true">🔐</div>
              <h3>Two-step verification</h3>
              <p className="ld-muted small">
                Enter the 6-digit code from your authenticator app{email ? ` for ${email}` : ''}.
                No app handy? Paste a <strong>recovery code</strong> instead.
              </p>
              <input
                ref={codeInputRef}
                autoFocus
                className="twofactor-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                maxLength={12}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\s/g, ''))}
              />
              <button type="submit" disabled={loading || twoFactorCode.length < 6} className="btn-block">
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <button
                type="button"
                className="link-btn small"
                onClick={() => {
                  setStep('creds');
                  setTwoFactorToken(null);
                  setTwoFactorCode('');
                  setError(null);
                }}
              >
                ← Use a different password
              </button>
            </form>
          )}

          {mode === 'signin' && step === 'setup' && forcedSetup && (
            <div className="twofactor-screen">
              <div className="twofactor-icon" aria-hidden="true">🛡️</div>
              <h3>Your carrier requires two-factor authentication</h3>
              <p className="ld-muted small">
                Office accounts sign in with an extra code. Set it up now — it takes 30 seconds
                and you're signed in right after.
              </p>
              <ol className="twofactor-steps">
                <li>Open your authenticator app and scan the QR code below.</li>
                <li>Can't scan? Type this secret instead: <code className="twofactor-secret">{forcedSetup.secret}</code></li>
                <li>Enter the 6-digit code it shows to confirm.</li>
              </ol>
              <div className="twofactor-qr" style={{ marginBottom: 12 }}>
                {forcedQr && <img src={forcedQr} alt="QR code to add Loadwave to your authenticator app" width={200} height={200} />}
              </div>
              <form onSubmit={submitCode} className="twofactor-verify" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <input
                  ref={codeInputRef}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  maxLength={6}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                />
                <button type="submit" disabled={loading || twoFactorCode.length !== 6} className="btn-block">
                  {loading ? 'Verifying…' : 'Enable & sign in'}
                </button>
              </form>
              <button
                type="button"
                className="link-btn small"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setStep('creds');
                  setTwoFactorToken(null);
                  setTwoFactorCode('');
                  setForcedSetup(null);
                  setForcedQr(null);
                  setError(null);
                }}
              >
                ← Back to sign in
              </button>
            </div>
          )}

          {mode === 'signin' && step === 'codes' && recoveryCodes && (
            <div className="twofactor-screen">
              <div className="twofactor-icon" aria-hidden="true">🔑</div>
              <h3>Your recovery codes</h3>
              <div className="alert alert-warn" style={{ textAlign: 'left' }}>
                <strong>Save these now — they're shown only once.</strong> Each code signs you in a
                single time if you ever lose your phone.
              </div>
              <div className="recovery-grid">
                {recoveryCodes.map((c) => (
                  <code key={c} className="recovery-code">{c.slice(0, 4)}-{c.slice(4)}</code>
                ))}
              </div>
              <button
                className="btn-block"
                onClick={() => {
                  if (verified) finish(verified);
                }}
              >
                I've saved my codes — continue
              </button>
            </div>
          )}

          {mode === 'signin' && (
            <p className="ld-muted small" style={{ margin: 0 }}>
              New here? Use the <strong>Create account</strong> tab — it takes 20 seconds.
            </p>
          )}
          {mode === 'invite' && (
            <p className="ld-muted small" style={{ margin: 0 }}>
              Didn't expect this? <Link to="/signin" style={{ color: 'var(--body)' }}>Sign in normally</Link> instead.
            </p>
          )}

          <p className="small" style={{ textAlign: 'center', margin: 0 }}>
            <Link to="/" style={{ color: 'var(--body)', textDecoration: 'underline' }}>
              Back to homepage
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const PROVINCES = [
  { code: 'QC', name: 'Québec' },
  { code: 'ON', name: 'Ontario' },
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'NL', name: 'Newfoundland & Labrador' },
];

const US_STATES = [
  { code: 'NY', name: 'New York' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'IL', name: 'Illinois' },
  { code: 'MI', name: 'Michigan' },
  { code: 'OH', name: 'Ohio' },
  { code: 'TX', name: 'Texas' },
  { code: 'GA', name: 'Georgia' },
  { code: 'FL', name: 'Florida' },
  { code: 'CA', name: 'California' },
  { code: 'TN', name: 'Tennessee' },
];