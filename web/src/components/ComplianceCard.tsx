import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Spinner } from './ui';
import { TrustPanel, type TrustSignals } from './TrustBadges';

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UNVERIFIED', label: 'Not declared yet' },
  { value: 'REVOKED', label: 'Revoked' },
  { value: 'OUT_OF_SERVICE', label: 'Out of service' },
];

function dateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/**
 * Declare the authority and insurance facts a counterparty sees on your
 * posts. This is the other half of the trust layer: the board can only show
 * an insurance expiry if someone typed one in.
 */
export function ComplianceCard() {
  const [signals, setSignals] = useState<TrustSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [authoritySince, setAuthoritySince] = useState('');
  const [authorityStatus, setAuthorityStatus] = useState('UNVERIFIED');
  const [carrier, setCarrier] = useState('');
  const [policy, setPolicy] = useState('');
  const [limit, setLimit] = useState('');
  const [expires, setExpires] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ signals: TrustSignals }>('/api/trust/me');
      setSignals(res.signals);
      setAuthoritySince(dateInput(res.signals.authoritySince));
      setAuthorityStatus(res.signals.authorityStatus || 'UNVERIFIED');
      setExpires(dateInput(res.signals.insuranceExpiresAt));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your compliance details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Prefilled fields always send (emptying one clears it); the free-text
   * insurance fields only send when filled, so "leave it as it is" is the
   * default rather than accidentally wiping a policy on file.
   */
  const save = async (e: FormEvent | null, clearInsurance = false) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = clearInsurance
        ? {
            insuranceCarrier: null,
            insurancePolicyNumber: null,
            cargoInsuranceLimit: null,
            insuranceExpiresAt: null,
          }
        : {
            authoritySince: authoritySince || null,
            authorityStatus,
            insuranceExpiresAt: expires || null,
          };
      if (!clearInsurance) {
        if (carrier.trim()) body.insuranceCarrier = carrier.trim();
        if (policy.trim()) body.insurancePolicyNumber = policy.trim();
        if (limit.trim()) body.cargoInsuranceLimit = Number(limit);
      }

      const res = await api<{ signals: TrustSignals }>('/api/trust/me', { method: 'PATCH', body });
      setSignals(res.signals);
      setSaved(true);
      setCarrier('');
      setPolicy('');
      setLimit('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not save those details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel settings-card">
      <h3>
        Compliance & trust{' '}
        {signals &&
          (signals.insurance === 'VALID' ? (
            <span className="badge badge-green">Insured</span>
          ) : signals.insurance === 'EXPIRING' ? (
            <span className="badge badge-amber">Expiring</span>
          ) : signals.insurance === 'EXPIRED' ? (
            <span className="badge badge-red">Insurance expired</span>
          ) : (
            <span className="badge badge-muted">No insurance on file</span>
          ))}
      </h3>
      <p className="muted small">
        Carriers see these facts before they commit to your freight. They are shown as self-declared — a complete file
        is what makes a load worth booking.
      </p>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {signals && (
            <div className="compliance-preview">
              <span className="muted small">What counterparties see on your posts</span>
              <TrustPanel trust={signals} />
            </div>
          )}

          <form onSubmit={(e) => void save(e)}>
            <label>
              Authority granted
              <span className="small">The date your MC/USDOT took effect — this is the age carriers filter on.</span>
              <input type="date" value={authoritySince} onChange={(e) => setAuthoritySince(e.target.value)} />
            </label>
            <label>
              Authority status
              <select value={authorityStatus} onChange={(e) => setAuthorityStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Insurance carrier
              <input
                type="text"
                maxLength={120}
                placeholder={signals?.insurance === 'MISSING' ? 'e.g. Intact Insurance' : 'unchanged'}
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </label>
            <label>
              Policy number
              <input
                type="text"
                maxLength={80}
                placeholder={signals?.insurance === 'MISSING' ? 'e.g. 1234567' : 'unchanged'}
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
              />
            </label>
            <label>
              Cargo cover
              <input
                type="number"
                inputMode="decimal"
                min="0"
                placeholder={signals?.insurance === 'MISSING' ? 'e.g. 250000' : 'unchanged'}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <label>
              Cover expires
              <span className="small">Carriers are warned when this is within 45 days, and flagged when it lapses.</span>
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>

            {error && <div className="alert alert-error">{error}</div>}
            {saved && <div className="alert alert-success">Saved — the board shows the new details straight away.</div>}

            <div className="compliance-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save compliance details'}
              </button>
              {(signals?.insurance ?? 'MISSING') !== 'MISSING' && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void save(null, true)}
                >
                  Remove insurance details
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
