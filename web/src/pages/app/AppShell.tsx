import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Modal } from '../../components/ui';
import ThemeToggle from '../../components/ThemeToggle';
import { timeAgo } from '../../utils/format';

interface Tenant {
  id: string;
  name: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  verified: boolean;
}

interface NotifRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const GROUPS: Array<{ label: string; items: Array<{ to: string; label: string; mark: JSX.Element }> }> = [
  {
    label: 'Overview',
    items: [{ to: '/app/dashboard', label: 'Dashboard', mark: <IconHome /> }],
  },
  {
    label: 'Marketplace',
    items: [
      { to: '/app/board', label: 'Search Loads', mark: <IconSearch /> },
      { to: '/app/trucks', label: 'Search Trucks', mark: <IconTruck /> },
      { to: '/app/myloads', label: 'My Loads', mark: <IconList /> },
    ],
  },
  {
    label: 'Network & Tools',
    items: [
      { to: '/app/network', label: 'Private Network', mark: <IconNetwork /> },
      { to: '/app/tools', label: 'Tools & Rates', mark: <IconGauge /> },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { to: '/app/ifta', label: 'Fuel & IFTA', mark: <IconFuel /> },
      { to: '/app/fleet', label: 'Fleet', mark: <IconFleet /> },
      { to: '/app/drivers', label: 'Drivers', mark: <IconId /> },
    ],
  },
];

export default function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const navigate = useNavigate();

  const loadNotifs = useCallback(async () => {
    try {
      const data = await api<{ items: NotifRow[]; unread: number }>('/api/notifications?limit=20');
      setNotifs(data.items);
      setUnread(data.unread);
    } catch {
      /* no backend / unauthenticated — ignore */
    }
  }, []);

  useEffect(() => {
    void loadNotifs();
    const t = setInterval(() => void loadNotifs(), 30_000);
    return () => clearInterval(t);
  }, [loadNotifs]);

  useEffect(() => {
    api<Tenant>('/api/tenants/me')
      .then(setTenant)
      .catch(() => {
        onSignOut();
        navigate('/signin');
      });
  }, [navigate, onSignOut]);

  const markAllRead = async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST', body: {} });
      setUnread(0);
      setNotifs((n) => n.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  };

  const signOut = () => {
    setConfirmSignOut(false);
    onSignOut();
    navigate('/', { replace: true });
  };

  // First-login onboarding: show once per tenant account.
  useEffect(() => {
    if (!tenant) return;
    const key = onboardKey(tenant.id);
    if (!localStorage.getItem(key)) setShowOnboard(true);
  }, [tenant]);

  const dismissOnboard = () => {
    if (tenant) localStorage.setItem(onboardKey(tenant.id), '1');
    setShowOnboard(false);
  };

  const onboardStep = (to: string) => {
    dismissOnboard();
    navigate(to);
  };

  const allItems = GROUPS.flatMap((g) => g.items);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={() => navigate('/app/dashboard')}>
          <span className="sidebar-brand-text">
            Loadwave
            <small>Owner-Operator TMS</small>
          </span>
        </div>

        <div className="sidebar-live">
          <LiveBanner />
        </div>

        <div className="sidebar-bell">
          <button className="bell-btn" onClick={() => setNotifOpen(true)}>
            <span className="bell-ico">
              <BellIcon />
              {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
            </span>
            <span className="bell-label">Notifications</span>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {GROUPS.map((group) => (
            <div className="side-group" key={group.label}>
              <span className="side-group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}
                >
                  <span className="side-mark">{item.mark}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="side-theme">
            <ThemeToggle className="side-theme-toggle" />
            <span>Theme</span>
          </div>
          <div className="side-company">
            <strong>{tenant?.name ?? '…'}</strong>
            {tenant?.verified ? (
              <span className="badge badge-green badge-dot">Verified carrier</span>
            ) : (
              <span className="badge badge-gray">Unverified</span>
            )}
            {tenant?.mcNumber && <small className="muted">MC {tenant.mcNumber}</small>}
          </div>
          <button className="nav-link logout" onClick={() => setConfirmSignOut(true)}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-mobilebar">
          <span className="shell-mobilebar-word" onClick={() => navigate('/app/dashboard')}>
            Loadwave
          </span>
          <ThemeToggle className="theme-toggle" />
          <button className="nav-link logout bell-mobile" onClick={() => setNotifOpen(true)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
            <BellIcon />
            {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <button className="nav-link logout" onClick={() => setConfirmSignOut(true)}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
        <nav className="mobile-bottom-nav" aria-label="Primary">
          {allItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.mark}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Modal
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out?"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmSignOut(false)}>Cancel</button>
            <button className="btn-danger" onClick={signOut}>Sign out</button>
          </>
        }
      >
        <p className="muted" style={{ margin: 0 }}>
          You'll be signed out of <strong>{tenant?.name ?? 'Loadwave'}</strong> on this device.
          Your loads, fuel records and IFTA data stay safe — sign back in anytime to pick up
          where you left off.
        </p>
      </Modal>

      <Modal
        open={showOnboard}
        onClose={dismissOnboard}
        title={`Welcome to Loadwave${tenant ? `, ${tenant.name}` : ''}`}
        footer={
          <button className="btn-green" onClick={dismissOnboard}>
            Start using Loadwave
          </button>
        }
      >
        <p className="muted small" style={{ margin: 0 }}>
          You're in. Here are four quick wins to get your first week moving — each takes under a
          minute.
        </p>
        <div className="onboarding-steps" style={{ marginTop: 0 }}>
          <button className="onboarding-step" onClick={() => onboardStep('/app/myloads')}>
            <span className="onboarding-check" aria-hidden>1</span>
            <span className="onboarding-step-label">Post your first load</span>
          </button>
          <button className="onboarding-step" onClick={() => onboardStep('/app/board')}>
            <span className="onboarding-check" aria-hidden>2</span>
            <span className="onboarding-step-label">Find and book a load</span>
          </button>
          <button className="onboarding-step" onClick={() => onboardStep('/app/ifta')}>
            <span className="onboarding-check" aria-hidden>3</span>
            <span className="onboarding-step-label">Log your first fuel purchase</span>
          </button>
          <button className="onboarding-step" onClick={() => onboardStep('/app/fleet')}>
            <span className="onboarding-check" aria-hidden>4</span>
            <span className="onboarding-step-label">Add your tractor to the fleet</span>
          </button>
        </div>
      </Modal>

      <Modal
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title="Notifications"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setNotifOpen(false)}>Close</button>
            <button className="btn-green" onClick={() => void markAllRead()} disabled={unread === 0}>Mark all read</button>
          </>
        }
      >
        {notifs.length === 0 ? (
          <div className="bell-empty">No notifications yet.</div>
        ) : (
          <div className="bell-panel">
            {notifs.map((n) => (
              <div key={n.id} className={`bell-item ${n.readAt ? '' : 'unread'}`}>
                <span className="bell-item-mark" />
                <div>
                  <div className="bell-item-title">{n.title}</div>
                  {n.body && <div className="bell-item-body">{n.body}</div>}
                  <time>{timeAgo(n.createdAt)}</time>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Icon({ d, extra }: { d: string; extra?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra ? <path d={extra} /> : null}
    </svg>
  );
}

function IconHome() {
  return <Icon d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />;
}
function IconSearch() {
  return <Icon d="M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />;
}
function IconTruck() {
  return <Icon d="M1 5h13v11H1zM14 9h4l3 3.5V16h-7M5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />;
}
function IconList() {
  return <Icon d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />;
}
function IconNetwork() {
  return <Icon d="M12 3v6m0 6v6M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0" />;
}
function IconGauge() {
  return <Icon d="M12 15l4.5-4.5M4 19a9 9 0 1 1 16 0" />;
}
function IconFuel() {
  return <Icon d="M5 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17M3 21h12M13 8h3a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-2.5-2.5M6.5 7h5" />;
}
function IconFleet() {
  return <Icon d="M3 16V8l4-4h5l3 4h3l3 3v5M8 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />;
}
function IconId() {
  return <Icon d="M3 5h18v14H3zM7.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4.5 17c.6-1.8 1.7-2.5 3-2.5s2.4.7 3 2.5M14 9h4M14 13h4" />;
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function onboardKey(tenantId: string): string {
  return `loadwave.onboarded.${tenantId}`;
}

function LiveBanner() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="live-banner">
      <span className="live-dot" aria-hidden />
      <span>
        Audit logging enabled · data continuously synced
      </span>
      <small>
        Last sync {now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
      </small>
    </div>
  );
}