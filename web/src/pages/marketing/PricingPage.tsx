import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

interface Plan {
  name: string;
  tagline: string;
  price: string;
  period: string;
  highlight?: boolean;
  topFeatures: string[];
  full: Record<string, boolean>;
}

const FEATURE_ROWS: Array<{ label: string; key: string }> = [
  { label: 'Live load board', key: 'board' },
  { label: 'One-tap load booking', key: 'book' },
  { label: 'Post capacity / trucks', key: 'trucks' },
  { label: 'Private network loads', key: 'network' },
  { label: 'Rate insights & market maps', key: 'rates' },
  { label: 'Load comparison tool', key: 'compare' },
  { label: 'Route & trip planning', key: 'route' },
  { label: 'Invoicing with GST/HST/QST', key: 'invoicing' },
  { label: 'Fuel logging', key: 'fuel' },
  { label: 'IFTA quarterly summaries', key: 'ifta' },
  { label: 'Company / broker directory', key: 'directory' },
  { label: 'Mobile app (phone + tablet)', key: 'mobile' },
];

const PLANS: Plan[] = [
  {
    name: 'Solo',
    tagline: 'For one owner-operator.',
    price: '$0',
    period: 'while in early access',
    topFeatures: ['Live load board', 'Post your truck', 'Fuel & IFTA', 'Phone + tablet'],
    full: {
      board: true, book: true, trucks: true, network: false, rates: false, compare: false,
      route: false, invoicing: false, fuel: true, ifta: true, directory: false, mobile: true,
    },
  },
  {
    name: 'Pro',
    tagline: 'For owner-ops & small fleets.',
    price: '$49',
    period: '/mo after trial',
    highlight: true,
    topFeatures: ['Everything in Solo', 'Invoicing & taxes', 'Load comparison', 'Rate insights'],
    full: {
      board: true, book: true, trucks: true, network: true, rates: true, compare: true,
      route: true, invoicing: true, fuel: true, ifta: true, directory: true, mobile: true,
    },
  },
  {
    name: 'Fleet',
    tagline: 'For dispatchers running 3+ trucks.',
    price: '$149',
    period: '/mo after trial',
    topFeatures: ['Everything in Pro', 'Multi-driver HOS', 'Route & trip planning', 'Priority support'],
    full: {
      board: true, book: true, trucks: true, network: true, rates: true, compare: true,
      route: true, invoicing: true, fuel: true, ifta: true, directory: true, mobile: true,
    },
  },
];

export default function PricingPage() {
  const [showFull, setShowFull] = useState(false);
  return (
    <MarketingLayout>
      <section className="ld-hero ld-hero-compact">
        <div className="ld-wrap ld-hero-inner">
          <span className="ld-kicker center-kicker">Simple pricing</span>
          <h1 className="ld-h1">
            Pick your plan. Swap <span className="accent">anytime</span>.
          </h1>
          <p className="ld-hero-sub center">
            Every plan includes the live load board and IFTA. Upgrade for invoicing, rate
            insights and the network tools.
          </p>
        </div>
      </section>

      <section className="ld-section ld-plan-section">
        <div className="ld-wrap">
          <div className="ld-plan-grid">
            {PLANS.map((p) => (
              <div key={p.name} className={p.highlight ? 'ld-plan-card ld-plan-card-hot' : 'ld-plan-card'}>
                {p.highlight && <span className="ld-plan-tag">Most popular</span>}
                <h3>{p.name}</h3>
                <p className="ld-muted small">{p.tagline}</p>
                <div className="ld-plan-price">
                  <b>{p.price}</b>
                  <span className="ld-muted small">{p.period}</span>
                </div>
                <ul>
                  {p.topFeatures.map((f) => (
                    <li key={f}>
                      <i>✓</i> {f}
                    </li>
                  ))}
                </ul>
                <Link to="/signin?mode=signup" className={p.highlight ? 'ld-pill ld-pill-orange ld-pill-block' : 'ld-pill ld-pill-ghost ld-pill-block'}>
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section ld-plan-compare">
        <div className="ld-wrap">
          <div className="ld-compare-head">
            <div>
              <span className="ld-kicker">Comparison</span>
              <h2 className="ld-h2">Full feature comparison</h2>
            </div>
            <button className="ld-pill ld-pill-ghost" onClick={() => setShowFull((v) => !v)}>
              {showFull ? 'Show core features' : 'Full feature chart'}
            </button>
          </div>
          <div className="ld-table-card">
            <div className="ld-table-scroll">
              <table className="ld-compare-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    {PLANS.map((p) => (
                      <th key={p.name}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      {PLANS.map((p) => {
                        const v = p.full[row.key];
                        const locked = v === false;
                        return (
                          <td key={p.name}>
                            <span
                              className={locked ? 'ld-cmp-no' : 'ld-cmp-yes'}
                              title={locked ? `Included in ${p.name}` : 'Included'}
                            >
                              {locked ? '—' : '✓'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="ld-muted small center" style={{ marginTop: 22 }}>
            {showFull
              ? 'Locked features grey out on lower tiers — upgrade in one click when you need them.'
              : 'Tiered access is applied live in the app: locked tools stay visible but dormant.'}
          </p>
        </div>
      </section>

      <section className="ld-section ld-cta ld-cta-flat">
        <div className="ld-wrap ld-callout">
          <div>
            <span className="ld-kicker ld-kicker-light">Not sure yet?</span>
            <h2 className="ld-h2 ld-h2-light">30-day free trial on every plan.</h2>
            <p className="ld-muted ld-muted-light">No credit card required.</p>
          </div>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Start free <ArrowIcon />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}