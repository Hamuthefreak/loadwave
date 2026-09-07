import { useState, type FormEvent } from 'react';
import { api, getTokenUser } from '../api';
import { Modal } from './ui';
import { money, regionLabel, timeAgo } from '../utils/format';

export interface FuelLogRow {
  id: string;
  volumeLitres: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  transactionCurrency: string;
  amountTransaction: string;
  amountBase: string;
  jurisdictionCode: string;
  occurredAt: string;
}

// Provinces first (typical home turf), then a spread of US states.
const JURISDICTIONS = [
  'QC', 'ON', 'AB', 'BC', 'MB', 'SK', 'NB', 'NS', 'PE', 'NL',
  'NY', 'NJ', 'PA', 'MA', 'CT', 'VT', 'NH', 'ME', 'IL', 'MI', 'OH', 'IN', 'TX', 'GA', 'FL', 'TN', 'VA', 'NC', 'WA', 'OR', 'CO',
];

export function FuelLogModal({
  open,
  onClose,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  onLogged: () => void | Promise<void>;
}) {
  const [jurisdiction, setJurisdiction] = useState('QC');
  const [unit, setUnit] = useState<'L' | 'GAL'>('L');
  const [volume, setVolume] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<'volume' | 'amount'>('volume');

  /** Shared phone numpad: type into whichever big field is highlighted. */
  const pressKey = (k: string) => {
    const cur = active === 'volume' ? volume : amount;
    let next = cur;
    if (k === '.') {
      if (!cur.includes('.')) next = cur === '' ? '0.' : cur + '.';
    } else if (k === 'del') {
      next = cur.slice(0, -1);
    } else if (k === 'clear') {
      next = '';
    } else {
      // Leading zero: replace instead of "0.5" -> "00.5".
      if (cur === '0') next = k;
      else if (cur.split('.')[1]?.length >= 3) return;
      else next = cur + k;
    }
    if (active === 'volume') setVolume(next);
    else setAmount(next);
  };

  const quickVolume = (v: number) => setVolume(String(v));

  const reset = () => {
    setJurisdiction('QC');
    setUnit('L');
    setVolume('');
    setAmount('');
    setCurrency('CAD');
    setWhen('');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const vol = Number(volume);
    const amt = Number(amount);
    if (!Number.isFinite(vol) || vol <= 0) {
      setError('Enter how much fuel you pumped.');
      setBusy(false);
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter the total you paid.');
      setBusy(false);
      return;
    }
    try {
      await api('/api/fuel/me', {
        method: 'POST',
        body: {
          jurisdictionCode: jurisdiction,
          volume: vol,
          unit,
          amountTransaction: amt,
          transactionCurrency: currency,
          ...(when ? { occurredAt: new Date(when).toISOString() } : {}),
        },
      });
      reset();
      await onLogged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the fuel stop');
    } finally {
      setBusy(false);
    }
  };

  const perUnit =
    volume && amount && Number(volume) > 0 && Number(amount) > 0
      ? Number(amount) / Number(volume)
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a fuel stop"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-green" type="submit" form="fuel-log-form" disabled={busy}>
            {busy ? 'Saving…' : 'Log fuel stop'}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        One tap at the pump — it lands on your unit and flows straight into your fleet's
        fuel records and IFTA.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <form id="fuel-log-form" onSubmit={(e) => void submit(e)}>
        <div className="form-grid fuel-form-grid">
          <label>
            Where did you fill up?
            <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
              {JURISDICTIONS.map((code) => (
                <option key={code} value={code}>{regionLabel(code)} ({code})</option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'L' | 'GAL')}>
              <option value="L">Litres (L)</option>
              <option value="GAL">US gallons (GAL)</option>
            </select>
          </label>
          <label className="fuel-form-fields">
            Volume
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              required
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder={unit === 'L' ? 'e.g. 250' : 'e.g. 66'}
            />
          </label>
          <label className="fuel-form-fields">
            Total paid
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 320.50"
            />
          </label>
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value as 'CAD' | 'USD')}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>
            When (optional — defaults to now)
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        </div>

        {/* Phone: big paired fields + shared numpad (hidden on desktop) */}
        <div className="fuel-pad">
          <div className="fuel-pad-fields">
            <button
              type="button"
              className={`fuel-pad-field ${active === 'volume' ? 'active' : ''}`}
              onClick={() => setActive('volume')}
              aria-pressed={active === 'volume'}
            >
              <span className="fuel-pad-label">
                Volume <b>{unit === 'L' ? 'L' : 'GAL'}</b>
              </span>
              <span className="fuel-pad-value">{volume || '0'}</span>
              <span className="fuel-pad-hint">{active === 'volume' ? 'tapping keys fills this' : 'tap to enter'}</span>
            </button>
            <button
              type="button"
              className={`fuel-pad-field ${active === 'amount' ? 'active' : ''}`}
              onClick={() => setActive('amount')}
              aria-pressed={active === 'amount'}
            >
              <span className="fuel-pad-label">
                Total paid <b>{currency}</b>
              </span>
              <span className="fuel-pad-value">{amount || '0'}</span>
              <span className="fuel-pad-hint">{active === 'amount' ? 'tapping keys fills this' : 'tap to enter'}</span>
            </button>
          </div>

          {perUnit !== null && (
            <p className="fuel-pad-price">
              ≈ {money(perUnit, currency)} /{unit === 'L' ? 'L' : 'gal'}
              {unit === 'GAL' ? ` · ${money(perUnit / 3.78541, currency)}/L` : ''}
            </p>
          )}

          <div className="fuel-pad-chips">
            {(unit === 'L' ? [100, 200, 300] : [25, 50, 75]).map((v) => (
              <button key={v} type="button" className="chip" onClick={() => quickVolume(v)}>
                {v} {unit === 'L' ? 'L' : 'gal'}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setActive('amount')}>
              enter total…
            </button>
          </div>

          <div className="fuel-pad-keys" role="group" aria-label="Number pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
              <button
                key={k}
                type="button"
                className={`fuel-key ${k === 'del' ? 'del' : ''}`}
                onClick={() => pressKey(k)}
                aria-label={k === 'del' ? 'Backspace' : k}
              >
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Compact trigger for the cab-side fuel form (hidden unless a driver is linked). */
export function FuelLogButton({
  label = 'Log fuel stop',
  onLogged,
}: {
  label?: string;
  onLogged?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const driverId = getTokenUser()?.driverId;
  if (!driverId) return null;
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
      <FuelLogModal open={open} onClose={() => setOpen(false)} onLogged={onLogged ?? (() => undefined)} />
    </>
  );
}

/** Compact list of a driver's own recent fuel stops. */
export function FuelStopsList({ rows }: { rows: FuelLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        No stops logged from your truck yet — next fill-up, log it above and it shows up here.
      </p>
    );
  }
  return (
    <ul className="fuel-list">
      {rows.map((r) => (
        <li key={r.id} className="fuel-item">
          <strong>{regionLabel(r.jurisdictionCode)}</strong>
          <span className="mono-num">{money(r.amountTransaction, r.transactionCurrency)}</span>
          <span className="muted small">
            {Number(r.volumeLitres).toLocaleString('en-CA', { maximumFractionDigits: 1 })} L
          </span>
          <time className="muted small">{timeAgo(r.occurredAt)}</time>
        </li>
      ))}
    </ul>
  );
}
