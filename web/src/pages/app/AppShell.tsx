import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, canManageRoles, getTokenUser, roleLabels } from '../../api';
import { Modal } from '../../components/ui';
import ThemeToggle from '../../components/ThemeToggle';
import { FuelLogModal } from '../../components/FuelLogger';
import { setDuty, useDuty } from '../../duty-store';
import { syncPushSubscription } from '../../push';
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

const GROUPS: Array<{ label: string; items: Array<{ to: string; label: string; mark: JSX.Element; opsOnly?: boolean; adminOnly?: boolean; driverOnly?: boolean }> }> = [
  {
    label: 'Overview',
    items: [{ to: '/app/dashboard', label: 'Dashboard', mark: <IconHome /> }],
  },
  {
    label: 'Marketplace',
    items: [
      { to: '/app/board', label: 'Search Loads', mark: <IconSearch /> },
      { to: '/app/trucks', label: 'Search Trucks', mark: <IconTruck /> },
      { to: '/app/trips', label: 'My Trips', mark: <IconRoute />, driverOnly: true },
      { to: '/app/myloads', label: 'My Loads', mark: <IconList />, opsOnly: true },
    ],
  },
  {
    label: 'Network & Tools',
    items: [
      { to: '/app/network', label: 'Private Network', mark: <IconNetwork />, opsOnly: true },
      { to: '/app/tools', label: 'Tools & Rates', mark: <IconGauge /> },
    ],
  },
  {
    label: 'Finance',
    items: [{ to: '/app/billing', label: 'Billing & AR', mark: <IconMoney />, opsOnly: true }],
  },
  {
    label: 'Compliance',
    items: [
      { to: '/app/ifta', label: 'Fuel & IFTA', mark: <IconFuel />, opsOnly: true },
      { to: '/app/fleet', label: 'Fleet', mark: <IconFleet />, opsOnly: true },
      { to: '/app/drivers', label: 'Drivers', mark: <IconId />, opsOnly: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/app/settings', label: 'Settings & security', mark: <IconLock /> },
      { to: '/app/team', label: 'Team & invites', mark: <IconTeam />, adminOnly: true },
    ],
  },
];

// These routes exist, but are blocked by the backend for the roles shown — the
// UI never lets those users in, so no broken pages with "requires ADMIN role".
const RESTRICTED_PATHS = GROUPS.flatMap((g) => g.items)
  .filter((i) => i.opsOnly || i.adminOnly || i.driverOnly)
  .map((i) => i.to);

export default function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const duty = useDuty();
  const [dutyBusy, setDutyBusy] = useState(false);
  const [confirmDuty, setConfirmDuty] = useState<'ACTIVE' | 'OFF_DUTY' | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const user = useMemo(() => getTokenUser(), []);
  const roles = user?.roles ?? [];
  const canManage = canManageRoles(roles);
  const isAdmin = roles.includes('ADMIN');
  const roleBadges = roleLabels(roles);

  const setDutyStatus = async (next: 'ACTIVE' | 'OFF_DUTY') => {
    if (dutyBusy || !user?.driverId) return;
    setDutyBusy(true);
    try {
      await api('/api/drivers/me/status', { method: 'PATCH', body: { status: next } });
      setDuty(next);
    } catch {
      /* keep last known state */
    } finally {
      setDutyBusy(false);
    }
  };

  // Load the linked driver's duty status so the driver shell can show a toggle.
  useEffect(() => {
    if (!user?.driverId || canManage) return;
    let alive = true;
    api<{ status: string }>(`/api/drivers/${user.driverId}`)
      .then((d) => {
        if (!alive) return;
        if (d.status === 'ACTIVE' || d.status === 'OFF_DUTY' || d.status === 'SUSPENDED') setDuty(d.status);
      })
      .catch(() => {
        /* profile not linked yet */
      });
    return () => {
      alive = false;
    };
  }, [user, canManage]);

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

  // Clicking a notification marks it read and jumps to what it's about.
  const openNotif = async (n: NotifRow) => {
    setNotifOpen(false);
    if (!n.readAt) {
      setNotifs((cur) => cur.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void api(`/api/notifications/${n.id}/read`, { method: 'POST', body: {} }).catch(() => {
        /* read state is best-effort */
      });
    }
    if (n.link) navigate(n.link);
  };

  // Drivers who already allowed notifications get their push subscription
  // re-wired silently (never prompts); the dashboard offers the opt-in.
  useEffect(() => {
    if (user?.driverId && !canManage) syncPushSubscription();
  }, [user, canManage]);

  // Keep the browser tab label in sync with the page the user is on.
  useEffect(() => {
    const TITLES: Array<[string, string]> = [
      ['/app/dashboard', 'Dashboard'],
      ['/app/board', 'Search Loads'],
      ['/app/trucks', 'Search Trucks'],
      ['/app/trips', 'My Trips'],
      ['/app/myloads', 'My Loads'],
      ['/app/network', 'Private Network'],
      ['/app/tools', 'Tools & Rates'],
      ['/app/ifta', 'Fuel & IFTA'],
      ['/app/fleet', 'Fleet'],
      ['/app/drivers', 'Drivers'],
      ['/app/billing', 'Billing & AR'],
      ['/app/team', 'Team & Invites'],
      ['/app/settings', 'Settings & Security'],
    ];
    const match = TITLES.find(([p]) => location.pathname === p || location.pathname.startsWith(`${p}/`));
    document.title = match ? `${match[1]} · Loadwave` : 'Loadwave';
  }, [location.pathname]);

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

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            (i.opsOnly ? canManage : true) &&
            (i.adminOnly ? isAdmin : true) &&
            (i.driverOnly ? !canManage : true),
        ),
      })).filter((g) => g.items.length > 0),
    [canManage, isAdmin],
  );
  const allItems = groups.flatMap((g) => g.items);

  // Mobile bottom nav: 3 role-aware primary tabs + the quick-actions button +
  // "More" (every other destination). Everything lives in `allItems` so the
  // sheets never offer a page the user can't open.
  const primaryPaths = canManage
    ? ['/app/dashboard', '/app/myloads', '/app/board']
    : user?.driverId
      ? ['/app/dashboard', '/app/board', '/app/trips']
      : ['/app/dashboard', '/app/board', '/app/trucks'];
  const primary = primaryPaths
    .map((p) => allItems.find((i) => i.to === p))
    .filter((i): i is (typeof allItems)[number] => Boolean(i));
  if (primary.length < 3) {
    for (const item of allItems) {
      if (primary.length >= 3) break;
      if (!primary.some((p) => p.to === item.to)) primary.push(item);
    }
  }

  const closeSheets = () => {
    setQuickOpen(false);
    setMoreOpen(false);
  };

  // Sheets should close on Escape and lock background scrolling while open.
  const sheetOpen = quickOpen || moreOpen;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheets();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  const navTo = (to: string) => {
    closeSheets();
    navigate(to);
  };

  // Mobile pull-to-refresh: a downward drag starting at the very top of the
  // page remounts the current route (key={refreshCount}) so every card and
  // table on it refetches. Disabled while a sheet/modal is open, inside
  // horizontally-scrolling tables, and on desktop.
  const ptrState = useRef({ startY: 0, engaged: false, done: false }).current;
  const pullYRef = useRef(0);
  pullYRef.current = pullY;
  useEffect(() => {
    const canPull = () =>
      window.matchMedia('(max-width: 860px)').matches &&
      !document.querySelector('.nav-sheet-root, .modal-backdrop') &&
      (document.scrollingElement?.scrollTop ?? 0) <= 0;

    const inScroller = (t: EventTarget | null) =>
      !!(t instanceof Element && t.closest('.table-scroll, .nav-sheet-scroll, input, textarea, select'));

    const onStart = (e: TouchEvent) => {
      ptrState.done = false;
      if (!canPull() || e.touches.length !== 1 || inScroller(e.target)) return;
      ptrState.startY = e.touches[0].clientY;
      ptrState.engaged = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!ptrState.engaged || ptrState.done) return;
      const dy = e.touches[0].clientY - ptrState.startY;
      if ((document.scrollingElement?.scrollTop ?? 0) > 0 || dy <= 0) {
        if (pullYRef.current > 0) setPullY(0);
        return;
      }
      e.preventDefault();
      setPullY(Math.min(90, dy * 0.55));
    };

    const onEnd = () => {
      if (!ptrState.engaged || ptrState.done) return;
      ptrState.done = true;
      ptrState.engaged = false;
      if (pullYRef.current >= 52) {
        setRefreshing(true);
        setRefreshCount((c) => c + 1);
        window.setTimeout(() => setRefreshing(false), 900);
      }
      setPullY(0);
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [ptrState]);

  const blockedPath = RESTRICTED_PATHS.some((p) => {
    if (location.pathname !== p && !location.pathname.startsWith(`${p}/`)) return false;
    const item = GROUPS.flatMap((g) => g.items).find((i) => i.to === p);
    if (!item) return false;
    if (item.opsOnly && !canManage) return true;
    if (item.adminOnly && !isAdmin) return true;
    if (item.driverOnly && canManage) return true;
    return false;
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={() => navigate('/app/dashboard')}>
          <span className="sidebar-brand-text">
            Loadwave
            <small>{canManage ? 'Owner-Operator TMS' : 'Driver app'}</small>
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

        {user?.driverId && !canManage && (
          <div className="side-duty">
            <span className="side-duty-label">Duty status</span>
            {duty === 'SUSPENDED' ? (
              <span className="badge badge-red">Suspended by dispatch</span>
            ) : (
              <div className="duty-seg" role="group" aria-label="Duty status">
                <button
                  type="button"
                  className={`duty-btn ${duty === 'ACTIVE' ? 'duty-on' : ''}`}
                  disabled={dutyBusy || !duty}
                  onClick={() => setConfirmDuty('ACTIVE')}
                >
                  <span className="duty-dot" aria-hidden />
                  On duty
                </button>
                <button
                  type="button"
                  className={`duty-btn ${duty === 'OFF_DUTY' ? 'duty-off' : ''}`}
                  disabled={dutyBusy || !duty}
                  onClick={() => setConfirmDuty('OFF_DUTY')}
                >
                  <span className="duty-dot" aria-hidden />
                  Off duty
                </button>
              </div>
            )}
          </div>
        )}

        <nav className="sidebar-nav" aria-label="Primary">
          {groups.map((group) => (
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
            <span className="side-company-badges">
              {roleBadges.map((r) => (
                <span className="badge badge-gray" key={r}>{r}</span>
              ))}
              {tenant?.verified ? (
                <span className="badge badge-green badge-dot">Verified carrier</span>
              ) : (
                <span className="badge badge-gray">Unverified</span>
              )}
            </span>
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
        </header>
        <main className="content" key={refreshCount}>
          {blockedPath ? <Navigate to="/app/dashboard" replace /> : <Outlet />}
        </main>
        {/* Mobile pull-to-refresh: drag down at the top of any page to remount
            the route and refetch everything on it. */}
        <div className="ptr-indicator" data-state={refreshing ? 'busy' : pullY > 18 ? 'armed' : 'idle'} style={pullY > 0 ? { transform: `translateY(${Math.min(30, pullY * 0.4)}px)` } : undefined} aria-hidden="true">
          <span className="ptr-spin" />
        </div>
        <nav className="mobile-bottom-nav" aria-label="Primary">
          {primary[0] && (
            <NavLink
              to={primary[0].to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {primary[0].mark}
              <span>{shortLabel(primary[0].label)}</span>
            </NavLink>
          )}
          {primary[1] && (
            <NavLink
              to={primary[1].to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {primary[1].mark}
              <span>{shortLabel(primary[1].label)}</span>
            </NavLink>
          )}
          <button
            type="button"
            className="mobile-quick-btn"
            onClick={() => setQuickOpen(true)}
            aria-label="Quick actions"
          >
            <IconBolt />
          </button>
          {primary[2] && (
            <NavLink
              to={primary[2].to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {primary[2].mark}
              <span>{shortLabel(primary[2].label)}</span>
            </NavLink>
          )}
          <button
            type="button"
            className="mobile-more-btn"
            onClick={() => setMoreOpen(true)}
            aria-label="All pages and account"
          >
            <IconDots />
            <span>More</span>
          </button>
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
          {canManage
            ? "You're in. Here are four quick wins to get your first week moving — each takes under a minute."
            : "You're in. Here's how to find your next load and keep your week moving."}
        </p>
        <div className="onboarding-steps" style={{ marginTop: 0 }}>
          {canManage ? (
            <>
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
            </>            ) : (
            <>
              <button className="onboarding-step" onClick={() => onboardStep('/app/board')}>
                <span className="onboarding-check" aria-hidden>1</span>
                <span className="onboarding-step-label">Find and book a load</span>
              </button>
              <button className="onboarding-step" onClick={() => onboardStep('/app/trucks')}>
                <span className="onboarding-check" aria-hidden>2</span>
                <span className="onboarding-step-label">Browse available equipment</span>
              </button>
              <button className="onboarding-step" onClick={() => onboardStep('/app/tools')}>
                <span className="onboarding-check" aria-hidden>3</span>
                <span className="onboarding-step-label">Check rates with the market tools</span>
              </button>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmDuty !== null}
        onClose={() => setConfirmDuty(null)}
        title={confirmDuty === 'ACTIVE' ? 'Go on duty?' : 'Go off duty?'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmDuty(null)}>Cancel</button>
            <button
              className={confirmDuty === 'ACTIVE' ? 'btn-green' : 'btn-primary'}
              disabled={dutyBusy}
              onClick={() => {
                const next = confirmDuty;
                setConfirmDuty(null);
                if (next) void setDutyStatus(next);
              }}
            >
              {dutyBusy ? 'Updating…' : confirmDuty === 'ACTIVE' ? 'Go on duty' : 'Go off duty'}
            </button>
          </>
        }
      >
        <p className="muted" style={{ margin: 0 }}>
          {confirmDuty === 'ACTIVE' ? (
            <>
              You'll show as <strong>available</strong> to dispatch — assigned loads can come your
              way, and time on duty counts against your HOS cycle.
            </>
          ) : (
            <>
              You'll stop showing as available and your on-duty clock pauses until you flip
              back. Your trips, fuel and records stay safe.
            </>
          )}
        </p>
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
              <button
                key={n.id}
                type="button"
                className={`bell-item ${n.readAt ? '' : 'unread'}`}
                onClick={() => void openNotif(n)}
              >
                <span className="bell-item-mark" aria-hidden />
                <span>
                  <span className="bell-item-title">{n.title}</span>
                  {n.body && <span className="bell-item-body">{n.body}</span>}
                  <time>{timeAgo(n.createdAt)}</time>
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Mobile-only sheets: quick actions + the full menu behind "More".
          Both are swipe-down dismissible — drag the handle, or the sheet
          itself when its scroll sits at the top. */}
      <NavSheet open={quickOpen} onClose={() => setQuickOpen(false)}>
            <h2 className="nav-sheet-title">Quick actions</h2>
              <div className="nav-sheet-grid">
                {user?.driverId && !canManage && (
                  <>
                    <button
                      type="button"
                      className={`nav-tile ${duty === 'ACTIVE' ? 'nav-tile-duty' : ''}`}
                      disabled={dutyBusy || !duty || duty === 'SUSPENDED'}
                      onClick={() => {
                        closeSheets();
                        setConfirmDuty(duty === 'ACTIVE' ? 'OFF_DUTY' : 'ACTIVE');
                      }}
                    >
                      <span className="nav-tile-ico">
                        <span className="duty-dot" aria-hidden />
                      </span>
                      <span>{duty === 'ACTIVE' ? 'Go off duty' : 'Go on duty'}</span>
                    </button>
                    <button
                      type="button"
                      className="nav-tile"
                      onClick={() => {
                        closeSheets();
                        setFuelOpen(true);
                      }}
                    >
                      <span className="nav-tile-ico"><IconFuel /></span>
                      <span>Log fuel stop</span>
                    </button>
                  </>
                )}
                {canManage && (
                  <>
                    <button type="button" className="nav-tile" onClick={() => navTo('/app/myloads')}>
                      <span className="nav-tile-ico"><IconList /></span>
                      <span>Post a load</span>
                    </button>
                    <button type="button" className="nav-tile" onClick={() => navTo('/app/ifta')}>
                      <span className="nav-tile-ico"><IconFuel /></span>
                      <span>Log fuel purchase</span>
                    </button>
                  </>
                )}
                <button type="button" className="nav-tile" onClick={() => navTo('/app/board')}>
                  <span className="nav-tile-ico"><IconSearch /></span>
                  <span>Find loads</span>
                </button>
                <button type="button" className="nav-tile" onClick={() => navTo('/app/trucks')}>
                  <span className="nav-tile-ico"><IconTruck /></span>
                  <span>Find trucks</span>
                </button>
                {user?.driverId && !canManage && (
                  <button type="button" className="nav-tile" onClick={() => navTo('/app/trips')}>
                    <span className="nav-tile-ico"><IconRoute /></span>
                    <span>My trips</span>
                  </button>
                )}
              </div>
      </NavSheet>
      <NavSheet open={moreOpen} onClose={() => setMoreOpen(false)} tall>
            <div className="nav-sheet-head">
                <h2 className="nav-sheet-title">{tenant?.name ?? 'Menu'}</h2>
                <span className="side-company-badges nav-sheet-badges">
                  {roleBadges.map((r) => (
                    <span className="badge badge-gray" key={r}>{r}</span>
                  ))}
                </span>
              </div>
              <div className="nav-sheet-scroll">
                {groups.map((group) => (
                  <div className="nav-sheet-group" key={group.label}>
                    <span className="nav-sheet-group-label">{group.label}</span>
                    <div className="nav-sheet-grid nav-sheet-grid-3">
                      {group.items.map((item) => (
                        <button
                          key={item.to}
                          type="button"
                          className={`nav-tile ${location.pathname === item.to ? 'nav-tile-active' : ''}`}
                          onClick={() => navTo(item.to)}
                        >
                          <span className="nav-tile-ico">{item.mark}</span>
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="nav-sheet-row nav-sheet-row-account">
                  <button
                    type="button"
                    className="nav-row-btn"
                    onClick={() => {
                      closeSheets();
                      setNotifOpen(true);
                    }}
                  >
                    <BellIcon />
                    <span>Notifications</span>
                    {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
                  </button>
                  <div className="nav-row-btn nav-row-static">
                    <span className="nav-row-theme-label">Theme</span>
                    <ThemeToggle className="theme-toggle" />
                  </div>
                  <button
                    type="button"
                    className="nav-row-btn nav-row-danger"
                    onClick={() => {
                      closeSheets();
                      setConfirmSignOut(true);
                    }}
                  >
                    <IconLock />
                    <span>Sign out</span>
                  </button>
                  {tenant?.mcNumber && (
                    <small className="muted nav-sheet-mc">MC {tenant.mcNumber}{tenant?.usdotNumber ? ` · USDOT ${tenant.usdotNumber}` : ''}</small>
                  )}
                </div>
              </div>
      </NavSheet>

      <FuelLogModal
        open={fuelOpen}
        onClose={() => setFuelOpen(false)}
        onLogged={() => {
          setFuelOpen(false);
          window.dispatchEvent(new Event('loadwave:fuel-logged'));
        }}
      />
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
function IconRoute() {
  return <Icon d="M4 21V4M4 5h16l-3 3.5L20 12H4" />;
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

function IconTeam() {
  return <Icon d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20c.8-3.2 3.1-5 5.5-5s4.7 1.8 5.5 5M17.5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM15 20c.6-2.2 2.1-3.5 4-3.5s3.4 1.3 4 3.5" />;
}
function IconLock() {
  return <Icon d="M6 11V8a6 6 0 0 1 12 0v3M4 11h16v10H4zM12 15v2" />;
}
function IconMoney() {
  return <Icon d="M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9h.01M18 9h.01M6 15h.01M18 15h.01" />;
}

function IconBolt() {
  return <Icon d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />;
}

function IconDots() {
  return <Icon d="M5 12h.01M12 12h.01M19 12h.01" />;
}

// Bottom-nav labels must fit a fifth of a phone width — trim the long ones.
function shortLabel(label: string): string {
  const map: Record<string, string> = {
    Dashboard: 'Home',
    'My Loads': 'Loads',
    'Search Loads': 'Board',
    'Search Trucks': 'Trucks',
    'My Trips': 'Trips',
  };
  return map[label] ?? label;
}

/**
 * Mobile bottom sheet with native-app swipe-to-dismiss: drag the handle (or
 * the sheet itself when its scroll sits at the top) and flick it away, or tap
 * the backdrop. Uses non-passive touch listeners so the drag can claim the
 * gesture before the browser starts scrolling the page underneath.
 */
function NavSheet({
  open,
  onClose,
  tall,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tall?: boolean;
  children: ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragYRef = useRef(0);
  const maxDyRef = useRef(0);
  const gesture = useRef({
    startY: 0,
    lastY: 0,
    lastT: 0,
    vel: 0,
    engaged: false,
    done: false,
  }).current;

  dragYRef.current = dragY;

  useEffect(() => {
    if (open) {
      setDragY(0);
      setDragging(false);
    }
  }, [open]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !open) return;

    const scrollEl = () => el.querySelector<HTMLElement>('.nav-sheet-scroll');
    const threshold = () => Math.max(90, window.innerHeight * 0.14);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      const onGrip = !!target.closest('.nav-sheet-handle, .nav-sheet-title, .nav-sheet-head');
      const sc = scrollEl();
      const atTop = !sc || sc.scrollTop <= 0;
      gesture.startY = e.touches[0].clientY;
      gesture.lastY = gesture.startY;
      gesture.lastT = performance.now();
      gesture.vel = 0;
      gesture.done = false;
      maxDyRef.current = 0;
      gesture.engaged = onGrip || atTop;
    };

    const onMove = (e: TouchEvent) => {
      if (!gesture.engaged || gesture.done) return;
      const y = e.touches[0].clientY;
      const dy = y - gesture.startY;
      const now = performance.now();
      const dt = Math.max(1, now - gesture.lastT);
      gesture.vel = (y - gesture.lastY) / dt;
      gesture.lastY = y;
      gesture.lastT = now;
      maxDyRef.current = Math.max(maxDyRef.current, dy);

      const sc = scrollEl();
      if (sc && sc.scrollTop > 0) {
        // The user scrolled the content instead — hand the gesture back.
        gesture.done = true;
        setDragging(false);
        setDragY(0);
        return;
      }
      if (dy <= 0) return; // moving up: let the browser scroll naturally
      e.preventDefault(); // we own this gesture — no page scroll while dragging
      setDragging(true);
      setDragY(dy * 0.92); // slight resistance, like a physical sheet
    };

    const onEnd = () => {
      if (!gesture.engaged || gesture.done) return;
      gesture.engaged = false;
      setDragging(false);
      const y = dragYRef.current;
      if (y > threshold() || (gesture.vel > 0.55 && y > 36)) {
        gesture.done = true;
        onClose();
      }
      setDragY(0);
    };

    // A drag that moves further than a tap must not end up tapping a tile
    // underneath the finger on release.
    const swallowClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const maybeSwallow = () => {
      if (maxDyRef.current > 12) {
        el.addEventListener('click', swallowClick, { capture: true, once: true });
        window.setTimeout(() => el.removeEventListener('click', swallowClick, true), 400);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    el.addEventListener('touchend', maybeSwallow, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('touchend', maybeSwallow);
    };
  }, [open, onClose, gesture]);

  if (!open) return null;

  const dim = dragY > 0 ? Math.max(0, 1 - dragY / 320) : 1;
  return (
    <div className="nav-sheet-root" role="dialog" aria-modal="true">
      <div
        className="nav-sheet-backdrop"
        style={{ opacity: dim, transition: dragging ? 'none' : undefined }}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={tall ? 'nav-sheet nav-sheet-tall' : 'nav-sheet'}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
          transition: dragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1)',
        }}
      >
        <span className="nav-sheet-handle" aria-hidden />
        {children}
      </div>
    </div>
  );
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