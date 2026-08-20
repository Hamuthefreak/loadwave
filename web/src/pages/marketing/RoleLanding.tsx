import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

type Role = 'carrier' | 'broker' | 'shipper';

const CONTENT: Record<
  Role,
  {
    eyebrow: string;
    title: string;
    sub: string;
    features: Array<{ t: string; d: string }>;
    cta: string;
  }
> = {
  carrier: {
    eyebrow: 'For carriers & owner-operators',
    title: 'Never deadhead again if you don’t want to.',
    sub: 'Search live loads by lane, book in a tap, and see your revenue per mile on every card. Then let IFTA and invoicing run themselves.',
    features: [
      { t: 'Live load board', d: 'Real loads from your network — filter by origin, destination, equipment and minimum rate.' },
      { t: 'One-tap booking', d: 'Rate, distance and $/mile on every card. Book it now, no phone games.' },
      { t: 'Post your truck', d: 'Tell the market where your equipment is and let carriers and brokers book it.' },
      { t: 'Revenue that adds up', d: 'Auto-invoices with GST/HST/QST. Track monthly revenue, miles and true $/mile.' },
      { t: 'IFTA on autopilot', d: 'Fuel logs at the pump; quarterly summaries compute themselves.' },
    ],
    cta: 'Start finding freight',
  },
  broker: {
    eyebrow: 'For brokers & freight agents',
    title: 'Post a load to your network and watch it move.',
    sub: 'Manage a trusted carrier list, compare rates, and keep your books GST/HST/QST clean without spreadsheets.',
    features: [
      { t: 'Post loads in minutes', d: 'Set lane, equipment, dates and rate. Approved carriers can book instantly.' },
      { t: 'Verified carrier network', d: 'MC/USDOT verified profiles — know who you’re dispatching before you book.' },
      { t: 'Rate comparisons', d: 'See the rate range on your lanes so every quote is defensible.' },
      { t: 'Invoices & taxes', d: 'Generate customer invoices with Canadian sales tax handled automatically.' },
    ],
    cta: 'Start posting loads',
  },
  shipper: {
    eyebrow: 'For shippers & 3PLs',
    title: 'Ship with a carrier you can actually trust.',
    sub: 'Verified capacity, live pricing and clean documentation — from tender to invoice.',
    features: [
      { t: 'Verified carriers', d: 'Every capacity posting shows MC/USDOT verification before you commit.' },
      { t: 'Live tracking data', d: 'ELD/GPS telemetry keeps your shipment status current without phone calls.' },
      { t: 'Clean invoicing', d: 'Accurate customer-facing invoices with tax computed for CA/US lanes.' },
      { t: 'Market rates', d: 'Rate insights on your lanes keep your freight spend honest.' },
    ],
    cta: 'Start shipping',
  },
};

export default function RoleLanding({ role }: { role: Role }) {
  const c = CONTENT[role];
  return (
    <MarketingLayout>
      <section className="ld-hero ld-hero-compact">
        <div className="ld-wrap ld-hero-inner">
          <span className="ld-kicker center-kicker">{c.eyebrow}</span>
          <h1 className="ld-h1">{c.title}</h1>
          <p className="ld-hero-sub center">{c.sub}</p>
          <div className="ld-hero-cta">
            <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
              {c.cta}
            </Link>
            <Link to="/pricing" className="ld-pill ld-pill-ghost">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <section className="ld-section">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Everything in one board</span>
          <h2 className="ld-h2 center">
            Everything {role === 'carrier' ? 'you need' : 'in one feed'} <span className="accent">before 7 AM</span>
          </h2>
          <div className="ld-feature-grid">
            {c.features.map((f) => (
              <div className="ld-feature-card" key={f.t}>
                <span className="ld-feature-icon" aria-hidden>
                  <CheckIcon />
                </span>
                <b>{f.t}</b>
                <p>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section ld-cta ld-cta-flat">
        <div className="ld-wrap ld-callout">
          <div>
            <span className="ld-kicker ld-kicker-light">Get started</span>
            <h2 className="ld-h2 ld-h2-light">Ready when your wheels are.</h2>
            <p className="ld-muted ld-muted-light">
              Works in the truck and at the desk — same account, same live data.
            </p>
          </div>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Create my account <ArrowIcon />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12 5 5L20 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}