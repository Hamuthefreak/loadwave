import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

const IMGS = {
  sea: '/assets/images/2.png',
  air: '/assets/images/3.png',
  train: '/assets/images/4.png',
  split: '/assets/images/5.png',
  number1: '/assets/images/6.png',
  mapThumb: '/assets/images/7.png',
};

const RATES = [
  { lane: 'Shanghai → Los Angeles', mode: 'Sea · 24d', value: 'from $1,940' },
  { lane: 'Frankfurt → New York', mode: 'Air · 2d', value: 'from $3,120' },
  { lane: 'Chicago → Vancouver', mode: 'Train · 5d', value: 'from $1,260' },
];

export default function HomePage() {
  const [mode, setMode] = useState<'track' | 'calc'>('track');
  const [tracked, setTracked] = useState<string | null>(null);

  const onTrack = (e: React.FormEvent) => {
    e.preventDefault();
    setTracked('LS-8842-GBL');
  };

  return (
    <MarketingLayout>
      {/* -------- Hero — Version A: search-driven -------- */}
      <section className="ld-hero">
        <div className="ld-wrap ld-hero-inner">
          <span className="ld-hero-badge">Worldwide Cargo Experts</span>
          <h1 className="ld-h1">
            Delivering Your <span className="accent">Cargo</span> Worldwide
          </h1>
          <p className="ld-hero-sub">
            Sea, air and rail freight for every lane, plus container leasing in 40+ locations.
            Track every shipment from pickup to delivery.
          </p>

          <form className="ld-searchbar" onSubmit={(e) => e.preventDefault()}>
            <span className="ld-search-field">
              <PinIcon />
              <input type="text" placeholder="Enter pickup location" aria-label="Pickup location" />
            </span>
            <span className="ld-search-divider" aria-hidden />
            <span className="ld-search-field">
              <PinIcon />
              <input type="text" placeholder="Enter destination location" aria-label="Destination location" />
            </span>
            <Link to="/signin?mode=signup" className="ld-search-go" aria-label="Search">
              <SearchIcon />
            </Link>
          </form>
          <p className="ld-hero-note">
            <CheckIcon /> <b>No credit card</b> · trusted by 12,000+ shippers · live lane rates below
          </p>

          <div className="ld-hero-visual">
            <span className="ld-container-glow" aria-hidden />
            <img
              src="/assets/images/container.png"
              alt="3D shipping container"
              className="ld-container-img"
            />
            <span className="ld-anno ld-anno-360">360°</span>
            <span className="ld-anno ld-anno-gps">GPS ✓</span>
            <span className="ld-anno ld-anno-cloud">Live</span>
            <span className="ld-connector ld-connector-a" aria-hidden />
            <span className="ld-connector ld-connector-b" aria-hidden />
            <span className="ld-connector ld-connector-c" aria-hidden />
          </div>
        </div>

        <div className="ld-rate-strip">
          <div className="ld-wrap ld-rate-strip-inner">
            {RATES.map((r) => (
              <div className="ld-rate-card" key={r.lane}>
                <span className="ld-rate-mode">{r.mode}</span>
                <b>{r.lane}</b>
                <span className="ld-rate-value">{r.value}</span>
              </div>
            ))}
            <Link to="/signin?mode=signup" className="ld-rate-more">
              All live rates <ArrowIcon />
            </Link>
          </div>
        </div>

        <div className="ld-logo-band">
          <div className="ld-wrap">
            <span>Maersk Line</span>
            <span>MSC Cargo</span>
            <span>Hapag-Lloyd</span>
            <span>COSCO SHIP</span>
            <span>CMA CGM</span>
            <span>Evergreen</span>
          </div>
        </div>
      </section>

      {/* -------- Shipping & Logistics Services — Version B category cards -------- */}
      <section id="services" className="ld-section ld-cats">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Our Services</span>
          <h2 className="ld-h2 center">
            Shipping & <span className="accent">Logistics</span> Services
          </h2>
          <p className="ld-sub center">
            One contract, three modes, endless lanes. Pick the speed your cargo needs.
          </p>
          <div className="ld-cat-grid">
            <CategoryCard img={IMGS.sea} label="Sea Shipping" caption="Ocean freight across 4 continents" tag="Starting $1,940" />
            <CategoryCard img={IMGS.air} label="Air Shipping" caption="Express air freight, door to door" tag="Starting $3,120" />
            <CategoryCard img={IMGS.train} label="Train Shipping" caption="Intermodal rail for heavy cargo" tag="Starting $1,260" />
          </div>
          <div className="ld-cats-foot center">
            <Link to="/pricing" className="ld-pill ld-pill-ghost">
              Compare all services <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      {/* -------- How it works -------- */}
      <section className="ld-section ld-steps">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">How it works</span>
          <h2 className="ld-h2 center">
            Ship in <span className="accent">three steps</span>
          </h2>
          <div className="ld-step-grid">
            <Step n="01" title="Book a service" text="Pick sea, air or train — or lease a container — and lock your lane in seconds." />
            <Step n="02" title="We move the cargo" text="Verified carriers handle pickup, customs and the haul while you watch live." />
            <Step n="03" title="Track to the door" text="Event-level tracking with instant alerts, right up to final delivery." />
          </div>
        </div>
      </section>

      {/* -------- Powering logistics across business -------- */}
      <section className="ld-section ld-split">
        <div className="ld-wrap ld-split-grid">
          <div className="ld-split-copy">
            <span className="ld-kicker">Why Loadboard</span>
            <h2 className="ld-h2">
              Powering logistics across <span className="accent">business</span>
            </h2>
            <p className="ld-muted">
              One platform for freight, containers and cargo — trusted by shippers, brokers and
              carriers on both sides of the border.
            </p>
            <ul className="ld-feature-list">
              <FeatureBullet title="Nationwide carrier network">
                Verified carriers with MC/USDOT numbers on every card — know who moves your freight
                before you book.
              </FeatureBullet>
              <FeatureBullet title="Fully-featured logistics software">
                Loads, trucks, rates, invoices and IFTA summaries in one live workspace.
              </FeatureBullet>
              <FeatureBullet title="Exception tracing & live support">
                Event-level tracking with alerts, plus real support when a shipment deviates.
              </FeatureBullet>
            </ul>
            <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange ld-split-cta">
              Start shipping free <ArrowIcon />
            </Link>
          </div>
          <div className="ld-photo-wrap">
            <span className="ld-photo-glow" aria-hidden />
            <img src={IMGS.split} alt="Orange shipping containers at a port" className="ld-photo ld-photo-dark" />
            <span className="ld-photo-chip">
              <span className="ld-photo-chip-tag">Live</span> 14,208 containers tracked
            </span>
          </div>
        </div>
      </section>

      {/* -------- #1 Nationwide dark section -------- */}
      <section className="ld-dark ld-dark-overlap">
        <div className="ld-wrap">
          <div className="ld-logo-row" aria-hidden>
            <span>NORTHLINE</span>
            <span>PACEDGE</span>
            <span>TRANSGLOBAL</span>
            <span>BLUEHARBOR</span>
            <span>LOGRATE</span>
          </div>
          <div className="ld-number-grid">
            <div className="ld-number-photo">
              <span className="ld-photo-glow ld-photo-glow-dark" aria-hidden />
              <img src={IMGS.number1} alt="Logistics warehouse with containers" className="ld-photo" />
            </div>
            <div className="ld-number-copy">
              <span className="ld-number-badge">
                <b>#1</b> Nationwide
              </span>
              <h2 className="ld-h2 ld-h2-light">
                Nationwide Delivery <span className="accent-grad">Logistics Solution</span>
              </h2>
              <p className="ld-muted ld-muted-light">
                Founded in 1998 with 3 trucks and a phone line, Loadboard has grown into a 2,400-vehicle
                fleet with 92 vessels and 64 owned container depots. Awarded best-in-class dispatch
                software six years running by the North American Freight Association.
              </p>
              <div className="ld-metrics">
                <Metric value="2,400+" label="Vehicles" />
                <Metric value="92" label="Vessels" />
                <Metric value="64" label="Depots" />
                <Metric value="6×" label="Award winner" />
              </div>
              <Link to="/signin?mode=signup" className="ld-pill ld-pill-light">
                Work with us <ArrowIcon />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* -------- Reviews -------- */}
      <section id="reviews" className="ld-section ld-reviews">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Reviews</span>
          <h2 className="ld-h2 center">
            Loved by shippers <span className="accent">on both sides</span> of the border
          </h2>
          <div className="ld-review-grid">
            <Review name="Sarah Connors" role="Dispatch Lead · Northline" text="Loadboard cut our quoting time from forty minutes to five. Every lane is live and trackable." />
            <Review name="Miguel Santos" role="Owner-Operator · 3 trucks" text="I booked a container lease from California and tracked it to Montréal in the same app. Unreal." />
            <Review name="Priya Natarajan" role="Freight Manager · BlueHarbor" text="The exception alerts save us daily. When a vessel moves, everyone knows before the phone rings." />
          </div>
        </div>
      </section>

      {/* -------- World map / locations -------- */}
      <section id="locations" className="ld-section ld-map-section">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Global Footprint</span>
          <h2 className="ld-h2 center">
            Find Locations To Buy, Sell Or <span className="accent">Lease Containers</span>
          </h2>
          <div className="ld-lease-chips">
            <Link to="/signin?mode=signup">Buy containers</Link>
            <Link to="/signin?mode=signup">Sell containers</Link>
            <Link to="/signin?mode=signup">Lease containers</Link>
          </div>
          <div className="ld-world">
            <WorldMap />
            <MapCard img={IMGS.mapThumb} name="California, USA" sub="Los Angeles · Long Beach · Oakland" active />
            <MapPin x={21} y={32} />
            <MapPin x={38} y={26} />
            <MapPin x={54} y={30} />
            <MapPin x={46} y={58} />
            <MapPin x={70} y={40} />
            <MapPin x={86} y={62} />
          </div>
          <p className="ld-map-foot center">
            40+ depots and 1,200+ drop-off points across North America, Europe and Asia — filter by
            container type and lease term in-app.
          </p>
        </div>
      </section>

      {/* -------- Tracking CTA — dark split -------- */}
      <section id="track" className="ld-cta">
        <div className="ld-wrap ld-cta-grid">
          <div className="ld-cta-copy">
            <span className="ld-kicker ld-kicker-light">Shipment Tracking</span>
            <h2 className="ld-h2 ld-h2-light">Track or Calculate your shipments</h2>
            <div className="ld-toggle" role="tablist" aria-label="Tracking mode">
              <button className={mode === 'track' ? 'active' : ''} role="tab" aria-selected={mode === 'track'} onClick={() => setMode('track')}>Shipment Tracking</button>
              <button className={mode === 'calc' ? 'active' : ''} role="tab" aria-selected={mode === 'calc'} onClick={() => setMode('calc')}>Calculator</button>
            </div>
            <p className="ld-muted ld-muted-light ld-cta-hint">
              {mode === 'track'
                ? 'Enter your tracking reference below and we’ll show every event in real time.'
                : 'Estimate sea, air and rail rates for any lane in under ten seconds.'}
            </p>
          </div>
          {mode === 'track' ? (
            <div className="ld-track-card">
              <h3 className="ld-track-title">Quickly Track your Shipments</h3>
              <form onSubmit={onTrack}>
                <label>
                  Tracking reference
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="e.g. LS-8842" aria-label="Tracking reference" required />
                  </div>
                </label>
                <label>
                  Service
                  <select defaultValue="" aria-label="Service">
                    <option value="" disabled>
                      Select Your Service
                    </option>
                    <option>Sea Shipping</option>
                    <option>Air Shipping</option>
                    <option>Train Shipping</option>
                    <option>Container Leasing</option>
                  </select>
                </label>
                <button type="submit" className="ld-pill ld-pill-orange ld-pill-block">
                  Track <ArrowIcon />
                </button>
              </form>
              {tracked && (
                <div className="ld-track-result">
                  <span className="ld-track-result-dot" aria-hidden />
                  <span>
                    <b>{tracked}</b> · In transit from Shanghai → Los Angeles · expected in 6 days
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="ld-track-card">
              <h3 className="ld-track-title">Rate Calculator</h3>
              <form onSubmit={(e) => e.preventDefault()}>
                <label>
                  Origin
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="Enter origin location" aria-label="Origin" />
                  </div>
                </label>
                <label>
                  Destination
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="Enter destination location" aria-label="Destination" />
                  </div>
                </label>
                <label>
                  Weight <span className="ld-field-note">(est. container tonnage)</span>
                  <select defaultValue="" aria-label="Weight">
                    <option value="" disabled>
                      Select Your Weight
                    </option>
                    <option>&lt; 5 tons</option>
                    <option>5 – 15 tons</option>
                    <option>15 – 30 tons</option>
                    <option>&gt; 30 tons</option>
                  </select>
                </label>
                <button type="submit" className="ld-pill ld-pill-orange ld-pill-block">
                  Calculate <ArrowIcon />
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* -------- Final CTA banner -------- */}
      <section className="ld-final">
        <div className="ld-wrap ld-final-inner">
          <div>
            <span className="ld-kicker">Get started</span>
            <h2 className="ld-h2">Create your free account today</h2>
            <p className="ld-muted">No credit card. Live rates the moment you sign up.</p>
          </div>
          <div className="ld-final-actions">
            <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
              Create my account
            </Link>
            <Link to="/pricing" className="ld-pill ld-pill-ghost">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

function CategoryCard({ img, label, caption, tag }: { img: string; label: string; caption: string; tag?: string }) {
  return (
    <Link to="/signin?mode=signup" className="ld-cat-card">
      <span className="ld-cat-glow" aria-hidden />
      <img src={img} alt={label} />
      {tag && <span className="ld-cat-tag">{tag}</span>}
      <span className="ld-cat-label">
        <span>
          <b>{label}</b>
          <small>{caption}</small>
        </span>
        <span className="ld-cat-arrow" aria-hidden>
          <ArrowIcon />
        </span>
      </span>
    </Link>
  );
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="ld-step">
      <span className="ld-step-num">{n}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function FeatureBullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="ld-feature">
      <span className="ld-feature-icon" aria-hidden>
        <CheckIcon />
      </span>
      <span>
        <b>{title}</b>
        <span className="ld-muted">{children}</span>
      </span>
    </li>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="ld-metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Review({ name, role, text }: { name: string; role: string; text: string }) {
  return (
    <figure className="ld-review">
      <span className="ld-review-stars" aria-label="5 out of 5 stars">
        <StarIcon /><StarIcon /><StarIcon /><StarIcon /><StarIcon />
      </span>
      <blockquote>“{text}”</blockquote>
      <figcaption>
        <span className="ld-review-avatar" aria-hidden>
          {name.split(' ').map((w) => w[0]).join('')}
        </span>
        <span>
          <b>{name}</b>
          <small>{role}</small>
        </span>
      </figcaption>
    </figure>
  );
}

function MapPin({ x, y }: { x: number; y: number }) {
  return (
    <span className="ld-map-pin" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden>
      <PinSolidIcon />
    </span>
  );
}

function MapCard({ img, name, sub, active }: { img: string; name: string; sub: string; active?: boolean }) {
  return (
    <Link
      to="/signin?mode=signup"
      className={active ? 'ld-map-card ld-map-card-active' : 'ld-map-card'}
    >
      <img src={img} alt={name} />
      <span className="ld-map-card-meta">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      <span className="ld-map-card-play" aria-hidden>
        <PlayIcon />
      </span>
    </Link>
  );
}

function WorldMap() {
  return (
    <svg viewBox="0 0 1200 460" className="ld-world-svg" role="img" aria-label="Dotted world map of container locations">
      <defs>
        <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2.2" cy="2.2" r="1.35" fill="#cfd6de" />
        </pattern>
      </defs>
      <g fill="url(#dots)">
        {/* North America */}
        <path d="M140 120 c40 -40 120 -44 150 -10 c34 38 -8 90 -70 118 c-30 13 -62 16 -88 50 c-32 42 -8 100 -30 138 c-38 66 -70 40 -66 6 c4 -44 -22 -70 4 -96 c14 -14 30 -32 28 -38 c-2 -8 18 -28 42 -50 c22 -20 18 -66 12 -76 c-6 -10 10 -30 18 -42 z" />
        {/* South America */}
        <path d="M288 308 c10 22 -8 52 -14 80 c-8 40 -30 52 -32 96 c-2 40 -2 96 -40 44 c-26 -36 -40 -6 -20 -54 c14 -32 38 -54 50 -92 c12 -40 34 -78 44 -98 c6 -12 10 -6 12 24 z" />
        {/* Europe + Africa */}
        <path d="M496 52 c30 -26 84 -30 118 -4 c24 18 20 52 8 70 c-8 12 14 46 10 72 c-2 20 -20 34 -26 58 c-4 18 -42 16 -52 34 c-12 20 -60 18 -66 42 c-4 18 -36 30 -34 104 c-10 38 -42 44 -60 116 c-16 64 -44 96 -62 70 c-24 -34 14 -118 30 -168 c14 -44 38 -72 54 -112 c14 -36 48 -78 42 -118 c-4 -34 -18 -108 -14 -112 z" />
        {/* Asia */}
        <path d="M760 44 c60 -30 140 -16 178 22 c22 22 48 10 62 34 c8 14 4 52 -6 76 c-10 26 18 70 16 104 c0 30 -40 52 -42 84 c0 24 28 30 30 58 c0 24 -36 34 -58 48 c-30 18 -60 8 -88 22 c-24 14 -54 30 -74 22 c-16 -8 -34 -40 -24 -64 c8 -20 -6 -56 6 -80 c18 -34 44 -26 44 -58 c0 -30 -42 -26 -40 -62 c2 -48 44 -42 66 -72 c10 -14 -2 -40 -4 -58 c-2 -20 -34 -34 -38 -40 c-14 -22 -28 -34 -22 -46 c6 -12 30 -20 42 -28 z" />
        {/* Australia */}
        <path d="M842 330 c34 -24 96 -30 128 -2 c24 20 70 4 92 26 c16 16 18 50 0 66 c-20 18 -64 14 -94 30 c-40 20 -92 26 -116 6 c-24 -20 -28 -58 -20 -74 c6 -12 0 -24 10 -26 c6 -2 0 -14 0 -26 z" />
      </g>
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function PinSolidIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12 2a7 7 0 0 0-7 7c0 5.2 6.3 12.2 6.6 12.6l.4.4.4-.4C12.7 21.2 19 14.2 19 9a7 7 0 0 0-7-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12 5 5L20 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9.4l6.6-.9 2.9-6Z" />
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

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.9l11-6.5a1 1 0 0 0 0-1.8l-11-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}