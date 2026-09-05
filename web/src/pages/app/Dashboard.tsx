import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Badge, Lane, PageHeader, Stat } from '../../components/ui';
import { currencyOf, km, money, perMile, regionLabel, timeAgo } from '../../utils/format';

interface Tenant {
  id: string;
  name: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  verified: boolean;
}

interface LoadRow {
  id: string;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  distanceKmEstimate: string | null;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
  status: string;
  marketplaceStatus: string;
  equipmentType: string | null;
  createdAt: string;
}

interface BoardLoad {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  distanceKmEstimate: string | null;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
  marketplaceStatus: 'PRIVATE' | 'PUBLIC' | 'BOOKED';
  bookedByTenantId: string | null;
  bookedAt: string | null;
  createdAt: string;
}

interface Invoice { id: string; issueDate: string; totalBase: string; currencyTransaction: string }
interface FuelTx { id: string; amountBase: string; transactionCurrency: string }

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const m = new Date(`${key}-01T00:00:00`);
  return m.toLocaleString('en-US', { month: 'short' });
}

function currentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${q}`;
}

export default function Dashboard() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [board, setBoard] = useState<BoardLoad[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [fuel, setFuel] = useState<FuelTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, l, b, inv, f] = await Promise.all([
        api<Tenant>('/api/tenants/me'),
        api<LoadRow[]>('/api/loads').catch(() => []),
        api<BoardLoad[]>('/api/board/loads').catch(() => []),
        api<Invoice[]>('/api/invoices').catch(() => []),
        api<FuelTx[]>(`/api/fuel/transactions?quarter=${currentQuarter()}`).catch(() => []),
      ]);
      setTenant(t);
      setLoads(l);
      setBoard(b);
      setInvoices(inv);
      setFuel(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trendMonths = useMemo(() => {
    const months: string[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
    }
    const sums = months.reduce<Record<string, number>>((acc, m) => {
      acc[m] = invoices
        .filter((i) => (i.issueDate ?? '').startsWith(m))
        .reduce((s, i) => s + Number(i.totalBase ?? 0), 0);
      return acc;
    }, {});
    const max = Math.max(...Object.values(sums), 0);
    return { months, sums, max };
  }, [invoices]);

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard" sub="An overview of your operation" />
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="spinner-wrap">
        <span className="spinner" aria-hidden />
        <span className="muted small">Loading dashboard…</span>
      </div>
    );
  }

  const base = currencyOf(tenant.baseCurrency);
  const monthKey = currentMonthKey();

  const revenueMonth = invoices
    .filter((i) => (i.issueDate ?? '').startsWith(monthKey))
    .reduce((s, i) => s + Number(i.totalBase ?? 0), 0);

  const totalKm = loads.reduce((s, l) => s + Number(l.distanceKmEstimate ?? 0), 0);
  const allRates = loads.map((l) => Number(l.freightAmountBase ?? 0)).filter((n) => n > 0);
  const avgRate = allRates.length ? allRates.reduce((a, b) => a + b, 0) / allRates.length : 0;
  const fuelSpendQuarter = fuel.reduce((s, f) => s + Number(f.amountBase ?? 0), 0);

  const hauled = board.filter((r) => r.bookedByTenantId === tenant.id);
  const nowHauling = hauled.find((r) => r.marketplaceStatus === 'BOOKED') ?? hauled[0] ?? null;
  const openBookings = board.filter((r) => r.marketplaceStatus === 'PUBLIC').length;
  const perMileOverall = revenueMonth > 0 && totalKm > 0 ? perMile(revenueMonth, totalKm) : null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const setupSteps = [
    { label: 'Post your first load', done: loads.length > 0, to: '/app/myloads' },
    { label: 'Log a fuel purchase', done: fuel.length > 0, to: '/app/ifta' },
    { label: 'Book a load on the board', done: board.some((r) => r.bookedByTenantId === tenant.id), to: '/app/board' },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${tenant.name}`}
        sub="Here is how your operation is doing."
        actions={<button className="btn-ghost" onClick={() => void load()}>↻ Refresh</button>}
      />

      <div className="grid">
        <Stat label={`Revenue · ${monthKey}`} value={money(revenueMonth, base)} sub={`Invoiced this month (${tenant.baseCurrency} base)`} tone="green" />
        <Stat label="Loaded miles" value={km(totalKm)} sub={`${loads.length} loads on file`} />
        <Stat label="Avg rate / load" value={money(avgRate, base)} sub={perMileOverall ? `≈ ${perMileOverall}/mile overall` : 'Add a distance to see $/mile'} tone="cyan" />
        <Stat label={`Fuel · ${currentQuarter()}`} value={money(fuelSpendQuarter, base)} sub="Quarter-to-date fuel spend" tone="amber" />
      </div>

      <h2>Revenue trend</h2>
      <div className="card">
        {trendMonths.max === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No invoiced revenue yet — revenue appears here as you invoice loads.
          </p>
        ) : (
          <div className="revenue-bars" role="img" aria-label="Revenue over the last 6 months">
            {trendMonths.months.map((m) => {
              const v = trendMonths.sums[m] ?? 0;
              const pct = trendMonths.max ? (v / trendMonths.max) * 100 : 0;
              return (
                <div className="revenue-bar" key={m} title={money(v, base)}>
                  <div className="revenue-bar-fill" style={{ height: `${pct}%` }} />
                  <span className="revenue-bar-label">{monthLabel(m)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2>Right now</h2>
      <div className="card now-loading" style={nowHauling ? {} : { opacity: 0.75 }}>
        {nowHauling ? (
          <>
            <Lane
              big
              originCountry={nowHauling.originCountry}
              originRegion={nowHauling.originRegion}
              destinationCountry={nowHauling.destinationCountry}
              destinationRegion={nowHauling.destinationRegion}
            />
            <div>
              <div className="amount">{money(nowHauling.freightAmountBase ?? nowHauling.freightAmountTransaction, nowHauling.freightCurrency)}</div>
              <div className="muted small">
                {km(nowHauling.distanceKmEstimate)}
                {nowHauling.distanceKmEstimate
                  ? ` · ${perMile(nowHauling.freightAmountBase ?? nowHauling.freightAmountTransaction, nowHauling.distanceKmEstimate) ?? '—'}/mi`
                  : ''}
              </div>
            </div>
          </>
        ) : (
          <div>
            <strong>No active load right now.</strong>
            <p className="muted small">
              {openBookings > 0
                ? `${openBookings} load${openBookings === 1 ? '' : 's'} on the board waiting for a carrier.`
                : 'Nothing on the board yet. Post a load below or ask a partner carrier to post one.'}
            </p>
          </div>
        )}
      </div>

      {!setupSteps.every((s) => s.done) && (
        <div className="card onboarding">
          <h3>Get set up</h3>
          <p className="muted small" style={{ marginTop: 4 }}>A few quick wins to get your operation moving.</p>
          <div className="onboarding-steps">
            {setupSteps.map((s) => (
              <Link key={s.label} to={s.to} className={`onboarding-step ${s.done ? 'done' : ''}`}>
                <span className="onboarding-check" aria-hidden>{s.done ? '✓' : '○'}</span>
                <span>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <h3>Quick actions</h3>
          <div className="quick-actions">
            <button className="quick-action" onClick={() => navigate('/app/board')}>
              <strong>Find loads</strong><span>Search the board · book in one tap</span>
            </button>
            <button className="quick-action" onClick={() => navigate('/app/trucks')}>
              <strong>Post a truck</strong><span>Advertise available capacity</span>
            </button>
            <button className="quick-action" onClick={() => navigate('/app/myloads')}>
              <strong>Post a load</strong><span>Share freight with partners</span>
            </button>
            <button className="quick-action" onClick={() => navigate('/app/ifta')}>
              <strong>Log fuel</strong><span>Track litres & tax</span>
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Company profile</h3>
          <dl className="detail-list">
            <div className="detail-row"><dt>Carrier</dt><dd>{tenant.name}</dd></div>
            <div className="detail-row">
              <dt>Verification</dt>
              <dd>
                {tenant.verified ? <Badge tone="green"><span className="badge-dot" /> Verified</Badge> : <Badge tone="gray">Unverified</Badge>}
              </dd>
            </div>
            <div className="detail-row"><dt>MC / USDOT</dt><dd>{tenant.mcNumber ? `MC ${tenant.mcNumber}` : '—'}{tenant.usdotNumber ? ` · USDOT ${tenant.usdotNumber}` : ''}</dd></div>
            <div className="detail-row"><dt>Home jurisdiction</dt><dd>{regionLabel(tenant.baseJurisdiction)}</dd></div>
            <div className="detail-row"><dt>Base currency</dt><dd>{tenant.baseCurrency}</dd></div>
          </dl>
          {!tenant.verified && (
            <p className="muted small">
              Add your MC or USDOT number to earn the Verified badge on the board.
            </p>
          )}
        </div>
      </div>

      <h2>Recent loads</h2>
      {loads.length === 0 ? (
        <div className="empty">
          <strong>No loads yet</strong>
          <p className="muted small">Post your first load under My Loads — it takes under a minute.</p>
          <button className="btn-green" onClick={() => navigate('/app/myloads')}>Post a load</button>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lane</th>
                <th>Distance</th>
                <th>Rate</th>
                <th>$ / mile</th>
                <th>Status</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {loads.slice(0, 8).map((l) => (
                <tr key={l.id}>
                  <td>
                    <Lane originCountry={l.originCountry} originRegion={l.originRegion} destinationCountry={l.destinationCountry} destinationRegion={l.destinationRegion} />
                  </td>
                  <td>{km(l.distanceKmEstimate)}</td>
                  <td className="mono-num">{money(l.freightAmountBase ?? l.freightAmountTransaction, l.freightCurrency)}</td>
                  <td className="mono-num">{perMile(l.freightAmountBase ?? l.freightAmountTransaction, l.distanceKmEstimate) ?? '—'}</td>
                  <td>
                    <Badge tone={l.marketplaceStatus === 'PUBLIC' ? 'green' : l.marketplaceStatus === 'BOOKED' ? 'amber' : 'gray'}>
                      {l.marketplaceStatus === 'PUBLIC' ? 'On the board' : l.marketplaceStatus === 'BOOKED' ? 'Booked' : 'Private'}
                    </Badge>
                  </td>
                  <td className="muted">{timeAgo(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}