import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, canManageRoles, getTokenUser } from '../../api';
import { useDuty } from '../../duty-store';
import { alertStatus as pushAlertStatus, enableLoadAlerts } from '../../push';
import { Badge, Lane, PageHeader, Stat } from '../../components/ui';
import DriverQuickAction from '../../components/DriverQuickAction';
import { PayCard } from '../../components/PayCard';
import { DocumentRenewModal } from '../../components/DocumentRenewModal';
import DutyLogModal, { type HosDailyLogRow, type HosDayRow } from '../../components/DutyLogModal';
import { FuelLogButton, FuelStopsList, type FuelLogRow } from '../../components/FuelLogger';
import { Notice } from '../../components/Notice';
import { IconBell, IconClock, IconFuel, IconSend, IconTimer } from '../../components/icons';
import { fuelJurisdictionInsight, type JurisdictionRates } from '../../utils/fuelPrefill';
import {
  discardWaitingFuelStop,
  discardWaitingRenewal,
  dismissFuelQueueNotice,
  dismissRenewalNotice,
  sendWaitingFuelStops,
  sendWaitingRenewals,
  useFuelQueue,
  useRenewals,
} from '../../pending-store';
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
  const user = useMemo(() => getTokenUser(), []);
  const canManage = canManageRoles(user?.roles);
  return canManage ? <ManagerDashboard /> : <DriverDashboard />;
}

function ManagerDashboard() {
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
        <Stat
          label={`Revenue · ${monthLabel(monthKey)} ${monthKey.slice(0, 4)}`}
          value={money(revenueMonth, base)}
          sub={`Invoiced this month (${tenant.baseCurrency} base)`}
          tone="green"
        />
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
              Add your USDOT number, then have it checked against FMCSA records to earn the checked badge on the board.
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

interface DriverRow {
  id: string;
  name: string;
  externalEldId: string | null;
  licenseNumber: string | null;
  homeTerminalTz: string;
  cycleType: 'CYCLE_1' | 'CYCLE_2';
  status: string;
}

interface HosCycle {
  cycleType: 'CYCLE_1' | 'CYCLE_2';
  asOf: string;
  onDutyHours7: number;
  onDutyHours14: number;
  limit7: number | null;
  limit14: number | null;
  remaining7: number | null;
  remaining14: number | null;
  has24hOffIn14: boolean;
  resetRequiresHours: number;
  warnings: string[];
  violations: string[];
}

interface TruckMini {
  id: string;
  status: string;
}

interface DocItem {
  kind: string;
  label: string;
  required: boolean;
  reference: string;
  status: 'EXPIRED' | 'MISSING' | 'EXPIRING' | 'OK';
  expiresAt: string | null;
  daysUntil: number | null;
  documentId: string | null;
  hasFile: boolean;
  /** Uploaded by the driver and not yet confirmed by the office. */
  pendingReview: boolean;
}

interface MyDocs {
  status: 'EXPIRED' | 'MISSING' | 'EXPIRING' | 'OK';
  headline: string;
  items: DocItem[];
}

/**
 * Only what needs doing — a driver doesn't need a list of documents that are
 * fine. An upload waiting on the office counts: the driver has done their part
 * and needs to know it is not the finished job yet.
 */
function docProblems(items: DocItem[]): DocItem[] {
  return items.filter(
    (i) =>
      i.pendingReview ||
      i.status === 'EXPIRED' ||
      (i.required && i.status === 'MISSING') ||
      i.status === 'EXPIRING',
  );
}

function docLine(item: DocItem): string {
  if (item.pendingReview) return 'sent — waiting for the office to confirm';
  if (item.status === 'MISSING') return 'not on file';
  const days = item.daysUntil;
  if (item.status === 'EXPIRED') {
    const late = days === null ? null : Math.abs(days);
    return late === 0 || late === null ? 'expired today' : `expired ${late} day${late === 1 ? '' : 's'} ago`;
  }
  if (days === 0) return 'expires today';
  return `expires in ${days ?? 0} day${days === 1 ? '' : 's'}`;
}

/** Litres the way a driver reads them off a statement: "1,240 L". */
function litresLabel(litres: number): string {
  return `${Math.round(litres).toLocaleString('en-CA')} L`;
}

/** "24 September" — a day inside one season does not need its year. */
function shortDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-CA', { day: 'numeric', month: 'long' });
}

/**
 * IFTA publishes rates as decimal dollars per litre (0.197); every driver and
 * every fuel desk says that as 19.7 cents. Print the way it is spoken.
 */
function centsPerLitre(perLitre: number): string {
  return `${Math.round(perLitre * 1000) / 10}¢/L`;
}

// Driver-facing dashboard: shows the live board and the driver's own status,
// and leaves out the ops tooling (revenue, fuel, IFTA, fleet, drivers) that a
// DRIVER account can't access anyway.
function DriverDashboard() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [open, setOpen] = useState<BoardLoad[]>([]);
  const [trucks, setTrucks] = useState<TruckMini[]>([]);
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [cycle, setCycle] = useState<HosCycle | null>(null);
  const [fuelRows, setFuelRows] = useState<FuelLogRow[]>([]);
  // Published IFTA rates, read-only from GET /api/ifta/rates. Null until they
  // land (or forever, if the endpoint is unreachable) — the fuel warning then
  // quotes the pump price alone rather than inventing a tax figure.
  const [iftaRates, setIftaRates] = useState<JurisdictionRates | null>(null);
  const [docs, setDocs] = useState<MyDocs | null>(null);
  const [renewFor, setRenewFor] = useState<DocItem | null>(null);
  const [docNotice, setDocNotice] = useState<string | null>(null);
  const [fuelNotice, setFuelNotice] = useState<string | null>(null);
  const [daily, setDaily] = useState<HosDailyLogRow | null>(null);
  const [logDay, setLogDay] = useState<HosDayRow | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const user = useMemo(() => getTokenUser(), []);
  // Live duty status from the shared store — flips the instant the quick-action
  // button (or the bottom-nav toggle) is tapped, instead of waiting for refresh.
  const duty = useDuty();
  // Anything taken where there was no signal, which the shell sends for us.
  const renewals = useRenewals();
  const fuelQueue = useFuelQueue();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, o, tr] = await Promise.all([
        api<Tenant>('/api/tenants/me'),
        api<BoardLoad[]>('/api/board/loads').catch(() => []),
        api<TruckMini[]>('/api/trucks').catch(() => []),
      ]);
      setTenant(t);
      setOpen(o);
      setTrucks(tr);
      if (user?.driverId) {
        try {
          const [d, c, f, dl, dc, rt] = await Promise.all([
            api<DriverRow>(`/api/drivers/${user.driverId}`),
            api<HosCycle>(`/api/hos/status/${user.driverId}`).catch(() => null),
            // The card lists the last five; the window is wider because the fuel
            // nudge makes a claim about a *pattern*, and three rows cannot tell a
            // pattern from a coincidence.
            api<FuelLogRow[]>('/api/fuel/me?limit=20').catch(() => [] as FuelLogRow[]),
            api<HosDailyLogRow>(`/api/hos/logs/${user.driverId}`).catch(() => null),
            // A driver is the one who has to produce a medical card at a scale.
            api<MyDocs>('/api/compliance/me').catch(() => null),
            // The published rate table. Read-only reference data, not gated
            // behind the IFTA entitlement, because a DRIVER account has none
            // and still needs to be told what the tax difference is.
            api<JurisdictionRates>('/api/ifta/rates').catch(() => null),
          ]);
          setDriver(d);
          setCycle(c);
          setFuelRows(f);
          setDaily(dl);
          setDocs(dc);
          setIftaRates(rt);
        } catch {
          /* driver profile not linked yet */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    }
  }, [user]);

  // The browser decides the alert button's visibility; track opt-in state too
  // so the button disappears immediately after the user enables alerts.
  const showAlertCta = !alertsOn && pushAlertStatus() === 'default';

  const turnOnAlerts = async () => {
    if (alertsBusy) return;
    setAlertsBusy(true);
    const ok = await enableLoadAlerts();
    setAlertsBusy(false);
    if (ok) setAlertsOn(true);
  };

  useEffect(() => {
    void load();
  }, [load]);

  // The quick-action dock can log fuel from anywhere on the dashboard — when
  // it does, refresh so the fuel card is never stale.
  useEffect(() => {
    const onFuel = () => void load();
    window.addEventListener('loadwave:fuel-logged', onFuel);
    return () => window.removeEventListener('loadwave:fuel-logged', onFuel);
  }, [load]);

  // A renewal that goes out from the cab (or lands at the office) changes the
  // file, and a fill-up changes both the fuel card and the quarter, so both are
  // re-read instead of showing yesterday's numbers.
  useEffect(() => {
    if (renewals.sentTotal > 0 || fuelQueue.sentTotal > 0) void load();
  }, [renewals.sentTotal, fuelQueue.sentTotal, load]);

  // A queue's notice is not attached to a tap, so it clears itself.
  useEffect(() => {
    if (!renewals.notice) return;
    const timer = window.setTimeout(() => dismissRenewalNotice(), 7000);
    return () => window.clearTimeout(timer);
  }, [renewals.notice]);

  useEffect(() => {
    if (!fuelQueue.notice) return;
    const timer = window.setTimeout(() => dismissFuelQueueNotice(), 7000);
    return () => window.clearTimeout(timer);
  }, [fuelQueue.notice]);

  // The same for the line a queued fill-up leaves behind, which is attached to
  // a tap but said in words the driver should not have to dismiss.
  useEffect(() => {
    if (!fuelNotice) return;
    const timer = window.setTimeout(() => setFuelNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [fuelNotice]);

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard" sub="Here is what's happening on your board." />
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const openCount = open.filter((l) => l.marketplaceStatus === 'PUBLIC').length;
  const unitsReady = trucks.filter((t) => t.status === 'ACTIVE').length;
  // Live duty from the shared store, falling back to the driver record.
  const dutyState = duty ?? driver?.status ?? 'OFF_DUTY';
  const hauled = open.filter((l) => l.bookedByTenantId === tenant.id);
  const nowHauling = hauled.find((r) => r.marketplaceStatus === 'BOOKED') ?? hauled[0] ?? null;

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${driver?.name ?? tenant.name}`}
        sub={driver ? 'Here is what is live for you on the board.' : 'Here is what is live for your fleet on the board.'}
        actions={
          <>
            {showAlertCta && (
              <button className="btn-ghost" onClick={() => void turnOnAlerts()} disabled={alertsBusy}>
                {alertsBusy ? (
                  'Enabling…'
                ) : (
                  <>
                    <IconBell size={14} className="inline-ico" />
                    Enable load alerts
                  </>
                )}
              </button>
            )}
            <button className="btn-ghost" onClick={() => void load()}>↻ Refresh</button>
          </>
        }
      />

      <div className="grid">
        <Stat label="Loads open on the board" value={openCount} sub="Live from verified partner carriers" tone="green" />
        <Stat label="Units available" value={unitsReady} sub="Equipment posted by partner carriers" />
        <Stat
          label={driver ? 'Your duty status' : 'Carrier'}
          // The headline used to be the HOS *cycle* under a "duty status" label,
          // which read as if the cycle were the duty state. Show the state, and
          // keep the cycle in the sub-line where it belongs.
          value={
            driver
              ? dutyState === 'ACTIVE'
                ? 'On duty'
                : dutyState === 'SUSPENDED'
                  ? 'Suspended'
                  : 'Off duty'
              : tenant.name
          }
          sub={
            driver
              ? dutyState === 'SUSPENDED'
                ? 'Dispatch has paused your profile'
                : `${dutyState === 'ACTIVE' ? 'Available to dispatch' : 'Not taking loads'} · ${cycleLabel(driver.cycleType)}`
              : 'Hauling under this carrier'
          }
          tone="cyan"
        />
      </div>

      <h2>Right now</h2>
      <div className="grid grid-2">
        <div className="card now-loading" style={cycle ? {} : { gridColumn: '1 / -1' }}>
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
            <div className="now-empty">
              <span className="now-empty-mark" aria-hidden><RouteIcon /></span>
              <div>
                <strong>No active load right now.</strong>
                <p className="muted small">
                  {openCount > 0
                    ? `${openCount} load${openCount === 1 ? '' : 's'} on the board waiting for a carrier.`
                    : 'Nothing on the board yet — check back soon or ask your dispatcher to post loads.'}
                </p>
                {openCount > 0 && (
                  <button className="btn-green" style={{ marginTop: 10 }} onClick={() => navigate('/app/board')}>
                    Find loads
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {cycle && <HosHoursCard cycle={cycle} daily={daily} onOpenDay={setLogDay} />}
      </div>

      {/* The question a driver actually asks dispatch, answered with its
          arithmetic attached. */}
      {user?.driverId && <PayCard />}

      {/* A lapsed medical card is the fastest way to be put out of service, so
          it sits above the fuel and shortcut cards, not buried in settings. */}
      {docNotice && <div className="alert alert-success">{docNotice}</div>}
      {fuelNotice && <div className="alert alert-success">{fuelNotice}</div>}
      {renewals.notice && <div className="alert alert-success">{renewals.notice}</div>}
      {fuelQueue.notice && <div className="alert alert-success">{fuelQueue.notice}</div>}
      {renewals.error && <div className="alert alert-error">{renewals.error}</div>}

      {docs && (docProblems(docs.items).length > 0 || renewals.items.length > 0) && (
        <div className="card">
          <div className="hos-head">
            <div>
              <h3 style={{ marginBottom: 2 }}>Your documents</h3>
              <span className="muted small">
                Your qualification file — renew one here and the office confirms it
              </span>
            </div>
            <Badge tone={docs.status === 'EXPIRED' ? 'red' : 'amber'}>{docs.headline}</Badge>
          </div>
          {docProblems(docs.items)
            .slice(0, 5)
            .map((item) => (
              <Notice
                key={item.kind}
                // Three different situations that used to share one amber
                // paragraph: already with the office, already lapsed, and about
                // to. They are not the same warning and must not read alike.
                tone={item.pendingReview ? 'info' : item.status === 'EXPIRED' ? 'danger' : 'warn'}
                mark={item.pendingReview ? <IconClock size={15} /> : undefined}
                title={item.label}
                detail={
                  item.pendingReview
                    ? `${docLine(item)}. It stops blocking you the moment they confirm it.`
                    : `${docLine(item)} · ${item.reference}`
                }
                // Hidden while an upload is already with the office: sending
                // the same document twice just moves the queue around.
                action={
                  item.pendingReview ? undefined : (
                    <button className="btn-sm" onClick={() => setRenewFor(item)}>
                      Renew
                    </button>
                  )
                }
              />
            ))}
          {/* Taken where there was no signal, still on this phone. Shown here
              rather than only in the sheet that took them: a driver who cannot
              see it waiting has no reason to believe it exists. */}
          {renewals.items.length > 0 && (
            <div className="queued-block">
              {renewals.items.map((item) => (
                <Notice
                  key={item.id}
                  tone={item.blocked ? 'danger' : 'info'}
                  className="notice-queued"
                  mark={item.blocked ? undefined : <IconSend size={15} />}
                  title={item.label}
                  detail={
                    item.blocked
                      ? `Could not send — ${item.lastError ?? 'the office refused it'}`
                      : renewals.busy
                        ? 'Sending to the office…'
                        : 'Saved on your phone · sends itself when you have signal'
                  }
                  action={
                    item.blocked ? (
                      <button className="btn-sm" onClick={() => void discardWaitingRenewal(item.id)}>
                        Discard
                      </button>
                    ) : (
                      <button
                        className="btn-sm"
                        disabled={renewals.busy}
                        onClick={() => void sendWaitingRenewals({ onlyId: item.id, force: true })}
                      >
                        Send now
                      </button>
                    )
                  }
                />
              ))}
            </div>
          )}

          <p className="muted small" style={{ marginBottom: 0 }}>
            A renewal you send stays a request until the office confirms it — that is what keeps your
            own upload from being the thing that says a truck is legal.
          </p>
        </div>
      )}

      <DocumentRenewModal
        doc={renewFor}
        onClose={() => setRenewFor(null)}
        onSent={(message) => {
          setRenewFor(null);
          setDocNotice(message);
          void load();
          window.setTimeout(() => setDocNotice(null), 6000);
        }}
      />

      {user?.driverId && (() => {
        const fuelInsight = fuelJurisdictionInsight(fuelRows, { rates: iftaRates });
        // Split out so a paragraph can render only when the table named a
        // jurisdiction this driver has actually bought fuel in for less tax.
        const fuelTax = fuelInsight?.tax ?? null;
        const taxLower = fuelTax?.lower ?? null;
        return (
        <div className="grid grid-2">
          <div className="card">
            <div className="hos-head">
              <div>
                <h3 style={{ marginBottom: 2 }}>Fuel stops</h3>
                <span className="muted small">Logged from the cab · flows into your IFTA automatically</span>
              </div>
              <FuelLogButton onLogged={() => load()} onQueued={setFuelNotice} />
            </div>
            {/* The old nudge said "your last 3 fills were all in Quebec —
                fuelling in a lower-IFTA jurisdiction could cut your quarterly
                tax bill". "3" was the length of the window it looked at rather
                than anything about the driver, no number was attached to the
                claim, and the advice was not true as stated: under IFTA the tax
                follows the miles that were run, not only where the tank was
                filled. This says what was actually bought, over what period,
                at what price, and what would move the line. */}
            {fuelInsight && (
              <Notice
                tone={fuelInsight.cheaper ? 'warn' : 'info'}
                mark={<IconFuel size={15} />}
                title={`Every one of your last ${fuelInsight.fills} fills was in ${regionLabel(
                  fuelInsight.jurisdiction,
                )}`}
              >
                <p className="notice-detail">
                  <strong>{litresLabel(fuelInsight.litres)}</strong>
                  {shortDay(fuelInsight.since) ? ` since ${shortDay(fuelInsight.since)}` : ''}
                  {fuelInsight.perLitre !== null && fuelInsight.currency ? (
                    <>
                      , averaging{' '}
                      <strong>{money(fuelInsight.perLitre, fuelInsight.currency)}/L</strong>.
                    </>
                  ) : (
                    '.'
                  )}
                </p>
                {fuelInsight.cheaper ? (
                  <p className="notice-detail">
                    Diesel you bought in {regionLabel(fuelInsight.cheaper.jurisdiction)} averaged{' '}
                    <strong>
                      {money(fuelInsight.cheaper.perLitre, fuelInsight.cheaper.currency)}/L
                    </strong>{' '}
                    against {money(fuelInsight.perLitre ?? 0, fuelInsight.cheaper.currency)} here — about{' '}
                    <strong>{money(fuelInsight.cheaper.save, fuelInsight.cheaper.currency)}</strong> less
                    for the same {litresLabel(fuelInsight.litres)} at the pump. That is the price, not the
                    tax: IFTA settles the tax afterwards, so the saving holds where you also run those
                    miles.
                  </p>
                ) : (
                  <p className="notice-detail">
                    Fuel tax is credited where you bought the fuel and charged where the miles were run,
                    so a fill outside {regionLabel(fuelInsight.jurisdiction)} is what moves this line —
                    and it only helps if you are also driving where that jurisdiction's rate is lower.
                    Log every fill, including the ones you pay cash for, so the credit matches the miles.
                  </p>
                )}
                {/* The pump price and the tax are two different numbers: the
                    price is what the station charged, the rate is what the
                    quarter is settled at, and IFTA settles it on where the
                    miles were run. Drawn only from jurisdictions already in
                    this driver's own history, so the comparison is about their
                    route rather than a table of forty jurisdictions. */}
                {fuelTax && taxLower && (
                  <p className="notice-detail">
                    The tax is a separate, published number:{' '}
                    {regionLabel(fuelTax.jurisdiction)} is{' '}
                    <strong>{centsPerLitre(fuelTax.perLitre)}</strong> against{' '}
                    <strong>{centsPerLitre(taxLower.perLitre)}</strong> in{' '}
                    {regionLabel(taxLower.jurisdiction)}, where you also bought fuel —{' '}
                    {centsPerLitre(taxLower.difference)}, about{' '}
                    <strong>{money(taxLower.save, fuelTax.currency)}</strong> on the same{' '}
                    {litresLabel(fuelInsight.litres)}. IFTA assesses it on where the miles were
                    run, so the rate — not the receipt — is what the quarter turns on.
                  </p>
                )}
              </Notice>
            )}
            {/* Fill-ups the pump could not send: the same row the documents
                card uses, because a driver who cannot see it waiting has no
                reason to believe it was recorded at all. */}
            {fuelQueue.items.length > 0 && (
              <div className="queued-block">
                {fuelQueue.items.map((stop) => (
                  <Notice
                    key={stop.id}
                    tone={stop.blocked ? 'danger' : 'info'}
                    className="notice-queued"
                    mark={stop.blocked ? undefined : <IconSend size={15} />}
                    title={`${regionLabel(stop.jurisdictionCode)} · ${money(
                      stop.amountTransaction,
                      stop.transactionCurrency,
                    )}`}
                    detail={`${Number(stop.volume).toLocaleString('en-CA', {
                      maximumFractionDigits: 1,
                    })} ${stop.unit === 'L' ? 'L' : 'gal'} · ${timeAgo(stop.occurredAt)} · ${
                      stop.blocked
                        ? `could not send — ${stop.lastError ?? 'the office refused it'}`
                        : fuelQueue.busy
                          ? 'sending to the office…'
                          : 'saved on your phone, sends itself when you have signal'
                    }`}
                    action={
                      stop.blocked ? (
                        <button className="btn-sm" onClick={() => void discardWaitingFuelStop(stop.id)}>
                          Discard
                        </button>
                      ) : (
                        <button
                          className="btn-sm"
                          disabled={fuelQueue.busy}
                          onClick={() => void sendWaitingFuelStops({ onlyId: stop.id, force: true })}
                        >
                          Send now
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            )}

            <FuelStopsList rows={fuelRows.slice(0, 5)} />
          </div>

          <div className="card">
            <h3>Jump in</h3>
            <div className="quick-actions">
              <button className="quick-action" onClick={() => navigate('/app/board')}>
                <span className="quick-action-ico" aria-hidden><SearchIcon /></span>
                <strong>Find loads</strong><span>Search the board · book in one tap</span>
              </button>
              <button className="quick-action" onClick={() => navigate('/app/trucks')}>
                <span className="quick-action-ico" aria-hidden><TruckIcon /></span>
                <strong>Browse trucks</strong><span>See available equipment</span>
              </button>
              <button className="quick-action" onClick={() => navigate('/app/tools')}>
                <span className="quick-action-ico" aria-hidden><GaugeIcon /></span>
                <strong>Rate check</strong><span>Lane benchmarks and market tools</span>
              </button>
            </div>
          </div>
        </div>
        )})()
      }

      <div className="grid grid-2">
        <div className="card">
          <h3>Driver profile</h3>
          {driver ? (
            <dl className="detail-list">
              <div className="detail-row"><dt>Name</dt><dd>{driver.name}</dd></div>
              <div className="detail-row"><dt>HOS cycle</dt><dd>{cycleLabel(driver.cycleType)}</dd></div>
              <div className="detail-row"><dt>Home timezone</dt><dd>{tzLabel(driver.homeTerminalTz)}</dd></div>
              <div className="detail-row"><dt>License</dt><dd>{driver.licenseNumber ?? '—'}</dd></div>
              <div className="detail-row"><dt>Status</dt><dd><Badge tone={driver.status === 'ACTIVE' ? 'green' : 'gray'}>{driver.status}</Badge></dd></div>
            </dl>
          ) : (
            <p className="muted small">
              No driver profile linked to this account yet — your dispatcher connects it on the
              Drivers page.
            </p>
          )}
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
          </dl>
          <p className="muted small">
            Fuel, IFTA, fleet and driver management are handled by your dispatcher — you won't
            see those tools in this view.
          </p>
        </div>
      </div>

      <DriverQuickAction />

      <DutyLogModal day={logDay} timezone={daily?.timezone ?? ''} onClose={() => setLogDay(null)} />
    </div>
  );
}

function cycleLabel(cycle: string): string {
  return cycle === 'CYCLE_2' ? 'Cycle 2 · 120h / 14 days' : 'Cycle 1 · 70h / 7 days';
}

function fmtHours(hours: number | null | undefined): string {
  const h = Number(hours ?? 0);
  if (!Number.isFinite(h) || h <= 0) return '0h';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins >= 60 ? `${whole + 1}h` : mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
}

// Used hours as a share of the window limit → tone for the progress bars.
function hosTone(used: number, limit: number): 'hos-over' | 'hos-warn' | 'hos-ok' {
  if (limit <= 0) return 'hos-ok';
  const ratio = used / limit;
  if (ratio >= 1) return 'hos-over';
  if (ratio >= 0.8) return 'hos-warn';
  return 'hos-ok';
}

function HosBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, Math.max(0, (used / Math.max(limit, 1)) * 100));
  const tone = hosTone(used, limit);
  const left = Math.max(0, limit - used);
  return (
    <div className="hos-row">
      <div className="hos-meta">
        <span>{label}</span>
        <strong className="mono-num">{fmtHours(left)} left</strong>
      </div>
      <div className={`hos-bar ${tone}`}>
        <div className="hos-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="muted small">
        {fmtHours(used)} used of {limit}h
      </div>
    </div>
  );
}

function HosHoursCard({
  cycle,
  daily,
  onOpenDay,
}: {
  cycle: HosCycle;
  daily: HosDailyLogRow | null;
  onOpenDay: (day: HosDayRow) => void;
}) {
  const limit7 = cycle.limit7 ?? 70;
  const over = cycle.violations.length > 0;
  // FMCSA: a 30-minute break is required after 8 cumulative hours of DRIVING
  // time. Nudge drivers as the window approaches — it's the #1 roadside
  // violation. Falls back to total on-duty once the 13h duty limit nears
  // (the violation alert above then takes over).
  const todayRow = daily?.days.length ? daily.days[daily.days.length - 1] : null;
  const onDutyToday = todayRow?.onDutyMinutes ?? 0;
  const drivingMins = Math.round(
    (todayRow?.segments ?? [])
      .filter((s) => s.dutyStatus === 'DRIVING')
      .reduce((sum, s) => {
        const start = new Date(s.startTime).getTime();
        const end = s.endTime ? new Date(s.endTime).getTime() : Date.now();
        return sum + Math.max(0, (end - start) / 60000);
      }, 0),
  );
  const breakDue = drivingMins >= 480 && onDutyToday < 780;
  return (
    <div className="card hos-card">
      <div className="hos-head">
        <div>
          <h3 style={{ marginBottom: 2 }}>Hours this cycle</h3>
          <span className="muted small">Based on your ELD duty logs · updated now</span>
        </div>
        <Badge tone={over ? 'red' : 'cyan'}>{cycleLabel(cycle.cycleType)}</Badge>
      </div>

      <HosBar used={cycle.onDutyHours7} limit={limit7} label="Rolling 7-day on-duty" />
      {cycle.limit14 != null && (
        <HosBar used={cycle.onDutyHours14} limit={cycle.limit14} label="Rolling 14-day on-duty" />
      )}

      {(cycle.violations.length > 0 || cycle.warnings.length > 0) && (
        <Notice
          tone={over ? 'danger' : 'warn'}
          className="notice-spaced"
          title={over ? 'You have hit your limit — pull over and reset' : 'Getting close to your limit'}
        >
          <ul className="notice-list">
            {[...cycle.violations, ...cycle.warnings].slice(0, 3).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      {breakDue && (
        <Notice
          tone="warn"
          className="notice-spaced"
          mark={<IconTimer size={15} />}
          title={`Break due — ${Math.floor(drivingMins / 60)}h ${drivingMins % 60}m driven today`}
          detail="Eight hours of driving needs a 30-minute interruption, and it has to come before the limit rather than after it. Any single stop of 30 minutes or more counts."
        />
      )}

      {daily && daily.days.length > 0 && <HosDailyStrip days={daily.days} onOpenDay={onOpenDay} />}

      <p className="muted small" style={{ marginBottom: 0 }}>
        {cycle.has24hOffIn14
          ? '✓ 24h consecutive off-duty recorded in the last 14 days'
          : `Reset needs ${cycle.resetRequiresHours}h of consecutive off-duty — none recorded in the last 14 days.`}
      </p>
    </div>
  );
}

function weekdayShort(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

// Seven-day duty strip: each day is a green on-duty bar over the off-duty
// track, with the on-duty hours underneath. The first cell is today.
// Tapping a day opens the ELD-style detail view.
function HosDailyStrip({ days, onOpenDay }: { days: HosDayRow[]; onOpenDay: (day: HosDayRow) => void }) {
  return (
    <div className="hos-daily">
      <div className="hos-daily-head">
        <strong>Daily duty log</strong>
        <span className="muted small">On duty per day · {days[0]?.date?.slice(0, 4)}</span>
      </div>
      <div className="hos-daily-grid">
        {days.map((d, i) => {
          const total = d.onDutyMinutes + d.offDutyMinutes;
          const onPct = total > 0 ? Math.round((d.onDutyMinutes / total) * 100) : 0;
          const detail = d.segments.length > 0
            ? d.segments.map((s) => {
                const hrs = s.endTime ? (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000 : null;
                return `${s.dutyStatus.replace(/_/g, ' ').toLowerCase()} ${hrs !== null ? fmtHours(hrs) : 'in progress'}`;
              }).join(' · ')
            : 'No duty recorded';
          return (
            <button
              type="button"
              className={`hos-day${i === 0 ? ' today' : ''}`}
              key={d.date}
              title={`${d.date}: ${detail} — tap for the full log`}
              aria-label={`${d.date} duty log: ${detail}. Tap for the full day.`}
              onClick={() => onOpenDay(d)}
            >
              <span className="hos-day-name">{i === 0 ? 'Today' : weekdayShort(d.date)}</span>
              <span className="hos-day-bar" aria-hidden>
                <span className="hos-day-on" style={{ width: `${onPct}%` }} />
              </span>
              <span className="hos-day-hours">{d.onDutyMinutes > 0 ? fmtHours(d.onDutyMinutes / 60) : '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Small inline icons for the dashboard quick actions / empty states.
function QIcon({ d, extra }: { d: string; extra?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra ? <path d={extra} /> : null}
    </svg>
  );
}

function SearchIcon() {
  return <QIcon d="M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />;
}
function TruckIcon() {
  return <QIcon d="M1 5h13v11H1zM14 9h4l3 3.5V16h-7M5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />;
}
function GaugeIcon() {
  return <QIcon d="M12 15l4.5-4.5M4 19a9 9 0 1 1 16 0" />;
}
function RouteIcon() {
  return <QIcon d="M4 21V4M4 5h16l-3 3.5L20 12H4" />;
}

function tzLabel(tz: string): string {
  return tz.replace('America/', '').replace('_', ' ');
}