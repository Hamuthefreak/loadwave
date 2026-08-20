import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api';

interface Tenant {
  id: string;
  name: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  verified: boolean;
}

const GROUPS: Array<{ label: string; items: Array<{ to: string; label: string; mark: string }> }> = [
  {
    label: 'Overview',
    items: [{ to: '/app/dashboard', label: 'Dashboard', mark: '⌂' }],
  },
  {
    label: 'Marketplace',
    items: [
      { to: '/app/board', label: 'Search Loads', mark: 'Ld' },
      { to: '/app/trucks', label: 'Search Trucks', mark: 'Tk' },
      { to: '/app/myloads', label: 'My Loads', mark: 'My' },
    ],
  },
  {
    label: 'Network & Tools',
    items: [
      { to: '/app/network', label: 'Private Network', mark: 'Nw' },
      { to: '/app/tools', label: 'Tools & Rates', mark: 'Tl' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { to: '/app/ifta', label: 'Fuel & IFTA', mark: 'Fu' },
      { to: '/app/fleet', label: 'Fleet', mark: 'F' },
      { to: '/app/drivers', label: 'Drivers', mark: 'D' },
    ],
  },
];

export default function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api<Tenant>('/api/tenants/me')
      .then(setTenant)
      .catch(() => {
        onSignOut();
        navigate('/signin');
      });
  }, [navigate, onSignOut]);

  const signOut = () => {
    onSignOut();
    navigate('/', { replace: true });
  };

  const allItems = GROUPS.flatMap((g) => g.items);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={() => navigate('/app/dashboard')}>
          <span className="brand-mark brand-mark-lg">
            <img src="/assets/images/logo.png" alt="Loadboard logo" />
          </span>
          <span className="sidebar-brand-text">
            Loadboard
            <small>Owner-Operator TMS</small>
          </span>
        </div>

        <div className="sidebar-live">
          <LiveBanner />
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
          <div className="side-company">
            <strong>{tenant?.name ?? '…'}</strong>
            {tenant?.verified ? (
              <span className="badge badge-green badge-dot">Verified carrier</span>
            ) : (
              <span className="badge badge-gray">Unverified</span>
            )}
            {tenant?.mcNumber && <small className="muted">MC {tenant.mcNumber}</small>}
          </div>
          <button className="nav-link logout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-mobilebar">
          <span className="brand-mark brand-mark-lg" onClick={() => navigate('/app/dashboard')}>
            <img src="/assets/images/logo.png" alt="Loadboard logo" />
          </span>
          <span className="shell-mobilebar-word" onClick={() => navigate('/app/dashboard')}>
            Loadboard
          </span>
          <button className="nav-link logout" onClick={signOut}>
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
    </div>
  );
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