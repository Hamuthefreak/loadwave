import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface ForgotResponse {
  ok: boolean;
  emailed: boolean;
  devResetUrl?: string;
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ emailed: boolean; devResetUrl?: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<ForgotResponse>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setDone({ emailed: res.emailed, devResetUrl: res.devResetUrl });
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
            <h1 className="ld-auth-title">Check your inbox</h1>
            <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
              If an account exists for <strong>{email}</strong>, we've sent a link to reset your
              password. It expires in one hour.
            </p>
            {done.emailed && (
              <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
                Didn't get it? Check spam, or double-check you typed the right email.
              </p>
            )}
            {done.devResetUrl && (
              <div className="alert" style={{ margin: 0 }}>
                <strong>Dev mode:</strong> SMTP isn't configured yet, so here's your reset link
                (only shown in development):
                <br />
                <a href={done.devResetUrl} style={{ wordBreak: 'break-all' }}>
                  {done.devResetUrl}
                </a>
              </div>
            )}
            <Link to="/signin" className="btn-block btn-primary" style={{ textAlign: 'center' }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="ld-auth-title">Forgot your password?</h1>
            <p className="ld-muted small" style={{ lineHeight: 1.6, margin: 0 }}>
              Enter the email you use to sign in and we'll send you a reset link.
            </p>

            <form onSubmit={submit} style={{ display: 'contents' }}>
              <div className="ld-auth-fields">
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@carrier.ca"
                    autoComplete="email"
                    autoFocus
                  />
                </label>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <button type="submit" disabled={loading} className="btn-block">
                {loading ? 'One moment…' : 'Send reset link'}
              </button>
            </form>

            <p className="ld-muted small" style={{ textAlign: 'center', margin: 0 }}>
              Remembered it? <Link to="/signin" style={{ color: 'var(--body)' }}>Sign in</Link>
            </p>
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
