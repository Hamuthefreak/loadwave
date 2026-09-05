import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken } from '../api';

interface AuthResponse {
  user: { email: string; roles: string[] };
  tenant: { id: string; name: string; baseCurrency: string; baseJurisdiction: string };
  tokens: { accessToken: string };
}

type Mode = 'signin' | 'signup';

export default function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');

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

  const finish = (res: AuthResponse) => {
    setToken(res.tokens.accessToken);
    navigate(state?.from ?? '/app/dashboard', { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
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
            <span><i>✓</i> Verified carrier badges on every card</span>
          </div>
        </div>

        <div className="ld-auth-card">
          <div className="ld-auth-brand">
            <span className="ld-wordmark" style={{ fontSize: '1.15rem' }}>
              Loadwave<span className="ld-wordmark-dot">.</span>
            </span>
          </div>
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

          <form onSubmit={submit} style={{ display: 'contents' }}>
            <div className="ld-auth-fields" key={mode}>
            {mode === 'signin' ? (
              <>
                <label>
                  Email
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@carrier.ca" autoComplete="email" />
                </label>
                <label>
                  Password
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                </label>
              </>
            ) : (
              <>
                <label>
                  Company / carrier name
                  <input required minLength={1} maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Maple Line Haulers" autoComplete="organization" />
                </label>
                <label>
                  Email
                  <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@carrier.ca" autoComplete="email" />
                </label>
                <label>
                  Password
                  <span className="small">At least 8 characters.</span>
                  <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
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
                    <input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} placeholder="e.g. 123456" />
                  </label>
                  <label>
                    USDOT <span className="small">(optional)</span>
                    <input value={usdotNumber} onChange={(e) => setUsdotNumber(e.target.value)} placeholder="e.g. 9876543" />
                  </label>
                </div>
                <p className="ld-muted small" style={{ margin: 0 }}>
                  Adding your MC or USDOT earns the <strong>Verified carrier</strong> badge on the
                  load board.
                </p>
              </>
            )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" disabled={loading} className="btn-block">
              {loading ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create my account'}
            </button>
          </form>

          {mode === 'signin' && (
            <p className="ld-muted small" style={{ margin: 0 }}>
              New here? Use the <strong>Create account</strong> tab — it takes 20 seconds.
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