import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Passwords need at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match — check them and try again.");
      return;
    }
    setLoading(true);
    try {
      await api<{ ok: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ld-mkt ld-auth-wrap">
      <div className="ld-auth-card ld-auth-solo">
        <div className="ld-auth-brand" style={{ justifyContent: 'center' }}>
          <span className="ld-wordmark" style={{ fontSize: '1.15rem' }}>
            Loadwave<span className="ld-wordmark-dot">.</span>
          </span>
        </div>

        {done ? (
          <>
            <h1 className="ld-auth-title">Password updated</h1>
            <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
              Your password is changed and every other session has been signed out. Go ahead and
              sign in with the new one.
            </p>
            <Link to="/signin" className="btn-block btn-primary" style={{ textAlign: 'center' }}>
              Sign in
            </Link>
          </>
        ) : !token ? (
          <>
            <h1 className="ld-auth-title">Link missing</h1>
            <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
              This reset link is incomplete — open the full link from the email, or request a new
              one below.
            </p>
            <Link to="/forgot-password" className="btn-block" style={{ textAlign: 'center' }}>
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <h1 className="ld-auth-title">Choose a new password</h1>
            <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
              At least 8 characters. Keep it different from your old one.
            </p>

            <form onSubmit={submit} style={{ display: 'contents' }}>
              <div className="ld-auth-fields">
                <label>
                  New password
                  <span className="pw-wrap">
                    <input
                      type={showPw ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="pw-toggle"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showPw ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>
                <label>
                  Confirm new password
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </label>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <button type="submit" disabled={loading} className="btn-block">
                {loading ? 'One moment…' : 'Update password'}
              </button>
            </form>
          </>
        )}

        <p className="small" style={{ textAlign: 'center', margin: 0 }}>
          <Link to="/" style={{ color: 'var(--body)', textDecoration: 'underline' }}>
            Back to homepage
          </Link>
        </p>
      </div>
    </div>
  );
}
