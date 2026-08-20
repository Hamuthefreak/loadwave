import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Badge, Empty, PageHeader } from '../../components/ui';
import { money, num, num1, regionLabel, shortDate } from '../../utils/format';

interface IftaSummary {
  id: string;
  quarter: string;
  assetId: string | null;
  fuelType: string;
  jurisdictionCode: string;
  totalKm: string;
  litresPurchased: string;
  litresConsumed: string;
  netLitres: string;
  jurisdictionRate: string;
  netTaxDueBase: string;
  status: string;
}

interface FuelTx {
  id: string;
  assetId: string | null;
  driverId: string | null;
  occurredAt: string;
  jurisdictionCode: string;
  volumeLitres: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  transactionCurrency: string;
  amountTransaction: string;
  exchangeRateToBase: string;
  amountBase: string;
}

function currentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${q}`;
}

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

function quarterOptions(): string[] {
  const year = new Date().getFullYear();
  const out: string[] = [];
  for (const y of [year, year - 1]) for (const q of QUARTERS) out.push(`${y}-${q}`);
  return out;
}

export default function Ifta() {
  const [quarter, setQuarter] = useState<string>(currentQuarter());
  const [rows, setRows] = useState<IftaSummary[]>([]);
  const [fuel, setFuel] = useState<FuelTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [jurisdiction, setJurisdiction] = useState('QC');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const [summaries, fuelRows] = await Promise.all([
        api<IftaSummary[]>(`/api/ifta/summaries?quarter=${encodeURIComponent(q)}`),
        api<FuelTx[]>(`/api/fuel/transactions?quarter=${encodeURIComponent(q)}`),
      ]);
      setRows(summaries);
      setFuel(fuelRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load IFTA data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(quarter);
  }, [quarter, load]);

  const logFuel = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const occurredAt = new Date(`${date}T12:00:00`).toISOString();
    const body: Record<string, unknown> = {
      occurredAt,
      jurisdictionCode: jurisdiction,
      volumeLitres: Number(litres),
      amountTransaction: Number(amount),
      transactionCurrency: 'CAD',
    };
    try {
      await api('/api/fuel/transactions', { method: 'POST', body });
      setSuccess(`Logged ${litres} L of fuel in ${regionLabel(jurisdiction)}.`);
      setLitres('');
      setAmount('');
      await load(quarter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log fuel');
    } finally {
      setSaving(false);
    }
  };

  const netTotal = rows.reduce((sum, r) => sum + Number(r.netTaxDueBase || 0), 0);
  const totalLitres = fuel.reduce((s, f) => s + Number(f.volumeLitres || 0), 0);
  const totalFuel = fuel.reduce((s, f) => s + Number(f.amountBase || 0), 0);

  return (
    <div>
      <PageHeader
        title="Fuel & IFTA"
        sub="Log fuel as you go — quarterly tax computes itself."
        actions={
          <label style={{ minWidth: 180 }}>
            Quarter
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {quarterOptions().map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </label>
        }
      />

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Log a fuel purchase</h3>
        <form onSubmit={logFuel}>
          <div className="form-grid">
            <label>
              Jurisdiction
              <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                {JURISDICTIONS.map((j) => (
                  <option key={j.code} value={j.code}>{j.name} ({j.code})</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Litres
              <input type="number" min="0" step="0.1" required value={litres} onChange={(e) => setLitres(e.target.value)} placeholder="e.g. 250" />
            </label>
            <label>
              Amount (CAD)
              <input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 425.50" />
            </label>
            <button type="submit" className="btn-green" disabled={saving} style={{ alignSelf: 'end' }}>
              {saving ? 'Saving…' : 'Log fuel'}
            </button>
          </div>
        </form>
        <p className="muted small" style={{ marginTop: 12 }}>
          Each purchase is attached to {quarter} and counted toward your quarterly IFTA filing
          for the jurisdiction where you bought it.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading IFTA data…</span></div>
      ) : (
        <>
          <div className="grid">
            <div className="card">
              <span className="stat-label">Fuel purchased</span>
              <div className="stat-value">{num1(totalLitres)} <span style={{ fontSize: '1rem', color: 'var(--muted)' }}>L</span></div>
              <span className="stat-sub">{fuel.length} transactions · {quarter}</span>
            </div>
            <div className="card">
              <span className="stat-label">Fuel spend</span>
              <div className="stat-value">{money(totalFuel)}</div>
              <span className="stat-sub">In base currency (CAD)</span>
            </div>
            <div className="card">
              <span className="stat-label">Net IFTA tax due</span>
              <div className="stat-value" style={{ color: netTotal > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {money(netTotal)}
              </div>
              <span className="stat-sub">{netTotal > 0 ? 'Owed for the quarter' : 'Credit carries forward'}</span>
            </div>
          </div>

          <h2>Quarterly summary by jurisdiction</h2>
          {rows.length === 0 ? (
            <Empty
              title={`No summary yet for ${quarter}`}
              sub="Summaries appear automatically once fuel and route data land. Log a few fuel purchases above to see it take shape."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Jurisdiction</th>
                    <th>Total km</th>
                    <th>Litres purchased</th>
                    <th>Litres consumed</th>
                    <th>Net litres</th>
                    <th>Rate $/L</th>
                    <th>Net tax due (CAD)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{regionLabel(r.jurisdictionCode)}</strong></td>
                      <td className="mono-num">{num(r.totalKm)}</td>
                      <td className="mono-num">{num(r.litresPurchased)}</td>
                      <td className="mono-num">{num(r.litresConsumed)}</td>
                      <td className="mono-num">{num1(r.netLitres)}</td>
                      <td className="mono-num">{r.jurisdictionRate}</td>
                      <td className="mono-num">{money(r.netTaxDueBase)}</td>
                      <td><Badge tone={r.status === 'FILED' ? 'green' : r.status === 'DRAFT' ? 'gray' : 'blue'}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>Net tax due this quarter (fleet, CAD)</td>
                    <td className="mono-num">{money(netTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <h2>Fuel transactions</h2>
          {fuel.length === 0 ? (
            <Empty title="No fuel logged yet" sub="Log your first purchase above." />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Jurisdiction</th>
                    <th>Litres</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {fuel.map((f) => (
                    <tr key={f.id}>
                      <td>{shortDate(f.occurredAt)}</td>
                      <td>{regionLabel(f.jurisdictionCode)}</td>
                      <td className="mono-num">{num1(f.volumeLitres)}</td>
                      <td className="mono-num">{money(f.amountTransaction, f.transactionCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted small" style={{ marginTop: 14 }}>
            Values follow the QC CAZ-510 / Ontario IFTA schedule. A positive net tax due is owed;
            a negative value is a credit.
          </p>
        </>
      )}
    </div>
  );
}

const JURISDICTIONS = [
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
  { code: 'NY', name: 'New York' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'IL', name: 'Illinois' },
  { code: 'MI', name: 'Michigan' },
  { code: 'ME', name: 'Maine' },
];