import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

const IMGS = {
  sea: '/assets/images/2.webp',
  air: '/assets/images/3.webp',
  train: '/assets/images/4.webp',
  split: '/assets/images/5.webp',
  number1: '/assets/images/6.webp',
  mapThumb: '/assets/images/7.webp',
};

const RATES = [
  { lane: 'Montréal → Toronto', mode: 'Dry van · 350 mi', value: '$2,150' },
  { lane: 'Chicago → Dallas', mode: 'Reefer · 950 mi', value: '$1,850' },
  { lane: 'Vancouver → Calgary', mode: 'Flatbed · 620 mi', value: '$1,275' },
];

export default function HomePage() {
  const [mode, setMode] = useState<'track' | 'calc'>('track');
  const [tracked, setTracked] = useState<string | null>(null);

  const onTrack = (e: React.FormEvent) => {
    e.preventDefault();
    setTracked('12 loads · MTL → TOR');
  };

  return (
    <MarketingLayout>
      {/* -------- Hero — search-driven load board -------- */}
      <section id="board" className="ld-hero">
        <div className="ld-wrap ld-hero-inner">
          <span className="ld-hero-badge">Live freight marketplace</span>
          <h1 className="ld-h1">
            Loads that <span className="accent">pay</span>. Trucks that move.
          </h1>
          <p className="ld-hero-sub">
            Live loads from verified carriers across the US and Canada. Filter by lane,
            equipment and rate — then book in one tap, with $/mile on every card.
          </p>

          <form className="ld-searchbar" onSubmit={(e) => e.preventDefault()}>
            <span className="ld-search-field">
              <PinIcon />
              <input type="text" placeholder="Enter pickup city or zip" aria-label="Pickup location" />
            </span>
            <span className="ld-search-divider" aria-hidden />
            <span className="ld-search-field">
              <PinIcon />
              <input type="text" placeholder="Enter destination city or zip" aria-label="Destination location" />
            </span>
            <Link to="/signin?mode=signup" className="ld-search-go" aria-label="Search loads">
              <SearchIcon />
            </Link>
          </form>
          <p className="ld-hero-note">
            <CheckIcon /> <b>No credit card</b> · trusted by 12,000+ carriers · live loads below
          </p>

          <div className="ld-hero-visual">
            <span className="ld-container-glow" aria-hidden />
            <img
              src="/assets/images/container.webp"
              alt="Loadwave freight — every load at a glance"
              className="ld-container-img"
              fetchPriority="high"
              decoding="async"
            />
            <span className="ld-anno ld-anno-360">Live</span>
            <span className="ld-anno ld-anno-gps">GPS ✓</span>
            <span className="ld-anno ld-anno-cloud">$/mi</span>
            <span className="ld-connector ld-connector-a" aria-hidden />
            <span className="ld-connector ld-connector-b" aria-hidden />
            <span className="ld-connector ld-connector-c" aria-hidden />
          </div>
        </div>

        <div className="ld-rate-strip">
          <div className="ld-wrap ld-rate-strip-inner">
            <div className="ld-rate-track">
              <div className="ld-rate-inner">
                {[...RATES, ...RATES].map((r, i) => (
                  <div className="ld-rate-card" key={i} aria-hidden={i >= RATES.length}>
                    <span className="ld-rate-mode">{r.mode}</span>
                    <b>{r.lane}</b>
                    <span className="ld-rate-value">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <Link to="/signin?mode=signup" className="ld-rate-more">
              All live loads <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      {/* -------- Marketplace services — category cards -------- */}
      <section id="services" className="ld-section ld-cats">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">The Marketplace</span>
          <h2 className="ld-h2 center">
            Everything a carrier needs, <span className="accent">on one board</span>
          </h2>
          <p className="ld-sub center">
            Loads, trucks, rates and fuel — the tools that actually make money, in one place.
          </p>
          <div className="ld-cat-grid">
            <CategoryCard img={IMGS.sea} label="Search Loads" caption="Van, reefer and flatbed freight across the US & Canada" tag="From $1.20/mi" />
            <CategoryCard img={IMGS.air} label="Post Your Truck" caption="Tell the market where your equipment is" tag="Free to post" />
            <CategoryCard img={IMGS.train} label="Fuel & IFTA" caption="Pump logging and quarterly summaries that compute themselves" tag="Included free" />
          </div>
          <div className="ld-cats-foot center">
            <Link to="/pricing" className="ld-pill ld-pill-ghost">
              See plans & pricing <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      {/* -------- How it works -------- */}
      <section className="ld-section ld-steps">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">How it works</span>
          <h2 className="ld-h2 center">
            Make money in <span className="accent">three steps</span>
          </h2>
          <div className="ld-step-grid">
            <Step n="01" title="Search the board" text="Filter live loads by lane, equipment and rate — $/mile on every card." />
            <Step n="02" title="Book in one tap" text="Lock the load instantly. No phone games, no double booking." />
            <Step n="03" title="Run the paperwork" text="Invoices, fuel and IFTA summaries build themselves as you go." />
          </div>
        </div>
      </section>

      {/* -------- Why Loadwave split -------- */}
      <section className="ld-section ld-split">
        <div className="ld-wrap ld-split-grid">
          <div className="ld-split-copy" data-reveal>
            <span className="ld-kicker">Why Loadwave</span>
            <h2 className="ld-h2">
              Powering carriers across <span className="accent">North America</span>
            </h2>
            <p className="ld-muted">
              One workspace for loads, trucks and books — used by owner-operators and small
              fleets on both sides of the border.
            </p>
            <ul className="ld-feature-list">
              <FeatureBullet title="Verified carrier network">
                MC/USDOT numbers and star ratings on every card — know who you're hauling for
                before you book.
              </FeatureBullet>
              <FeatureBullet title="One app for the back office">
                Loads, trucks, rates, invoices and IFTA summaries in one live workspace — no
                more bouncing between apps.
              </FeatureBullet>
              <FeatureBullet title="Saved searches & rate alerts">
                Set a lane once; we ping you the moment a matching load posts, day or night.
              </FeatureBullet>
            </ul>
            <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange ld-split-cta">
              Start hauling free <ArrowIcon />
            </Link>
          </div>
          <div className="ld-photo-wrap" data-reveal style={{ '--reveal-delay': '120ms' } as React.CSSProperties}>
            <span className="ld-photo-glow" aria-hidden />
            <img src={IMGS.split} alt="Freight trucks on the road" className="ld-photo ld-photo-dark" loading="lazy" decoding="async" />
            <span className="ld-photo-chip">
              <span className="ld-photo-chip-tag">Live</span> 14,208 loads posted
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
              <img src={IMGS.number1} alt="Carrier network across the country" className="ld-photo" loading="lazy" decoding="async" />
            </div>
            <div className="ld-number-copy">
              <span className="ld-number-badge">
                <b>#1</b> Nationwide
              </span>
              <h2 className="ld-h2 ld-h2-light">
                North America's <span className="accent-grad">Freight Marketplace</span>
              </h2>
              <p className="ld-muted ld-muted-light">
                Built by truckers for truckers: thousands of carriers post and book freight on
                Loadwave every day. Live market data, verified partners and one-tap booking —
                rated best-in-class dispatch software six years running by the North American
                Freight Association.
              </p>
              <div className="ld-metrics">
                <Metric value="2,400+" label="Active carriers" />
                <Metric value="14K" label="Loads posted weekly" />
                <Metric value="92%" label="Booked same day" />
                <Metric value="6×" label="Award winner" />
              </div>
              <Link to="/signin?mode=signup" className="ld-pill ld-pill-light">
                Join the board <ArrowIcon />
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
            Loved by carriers <span className="accent">on both sides</span> of the border
          </h2>
          <div className="ld-review-grid">
            <Review name="Sarah Connors" role="Dispatch Lead · Northline" text="Loadwave cut our quoting time from forty minutes to five. Every lane is live and trackable." />
            <Review name="Miguel Santos" role="Owner-Operator · 3 trucks" text="I posted my truck at 6 AM and had three booking offers before lunch. Booked one in two taps." />
            <Review name="Priya Natarajan" role="Freight Manager · BlueHarbor" text="The saved-search alerts save us daily. When a load matches our lane, everyone knows before the phone rings." />
          </div>
        </div>
      </section>

      {/* -------- Lane map / coverage -------- */}
      <section id="locations" className="ld-section ld-map-section">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Where the freight is</span>
          <h2 className="ld-h2 center">
            Search loads by lane, <span className="accent">anywhere on the map</span>
          </h2>
          <div className="ld-lease-chips" data-reveal>
            <Link to="/signin?mode=signup">Find loads</Link>
            <Link to="/signin?mode=signup">Post your truck</Link>
            <Link to="/signin?mode=signup">Market rates</Link>
          </div>
          <div className="ld-world" data-reveal style={{ '--reveal-delay': '120ms' } as React.CSSProperties}>
            <WorldMap />
            <MapCard img={IMGS.mapThumb} name="California, USA" sub="LA · Oakland · San Diego" active />
            <MapPin x={21} y={32} />
            <MapPin x={38} y={26} />
            <MapPin x={54} y={30} />
            <MapPin x={46} y={58} />
            <MapPin x={70} y={40} />
            <MapPin x={86} y={62} />
          </div>
          <p className="ld-map-foot center">
            Live load postings across the US and Canada — filter by lane, equipment and radius
            right on the board.
          </p>
        </div>
      </section>

      {/* -------- Freight tools CTA — dark split -------- */}
      <section id="track" className="ld-cta">
        <div className="ld-wrap ld-cta-grid">
          <div className="ld-cta-copy" data-reveal>
            <span className="ld-kicker ld-kicker-light">Freight tools</span>
            <h2 className="ld-h2 ld-h2-light">Find loads or check lane rates</h2>
            <div className="ld-toggle" role="tablist" aria-label="Board tool">
              <button className={mode === 'track' ? 'active' : ''} role="tab" aria-selected={mode === 'track'} onClick={() => setMode('track')}>Find loads</button>
              <button className={mode === 'calc' ? 'active' : ''} role="tab" aria-selected={mode === 'calc'} onClick={() => setMode('calc')}>Rate check</button>
            </div>
            <p className="ld-muted ld-muted-light ld-cta-hint">
              {mode === 'track'
                ? "Enter your lane below and we'll show the live loads that match."
                : 'Estimate the going rate for any lane in under ten seconds.'}
            </p>
          </div>
          {mode === 'track' ? (
            <div className="ld-track-card">
              <h3 className="ld-track-title">Search the load board</h3>
              <form onSubmit={onTrack}>
                <label>
                  Origin
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="e.g. Montréal, QC" aria-label="Origin" required />
                  </div>
                </label>
                <label>
                  Equipment type
                  <select defaultValue="" aria-label="Equipment type">
                    <option value="" disabled>
                      Select Equipment
                    </option>
                    <option>Dry Van</option>
                    <option>Reefer</option>
                    <option>Flatbed</option>
                    <option>Step Deck</option>
                    <option>Power Only</option>
                  </select>
                </label>
                <button type="submit" className="ld-pill ld-pill-orange ld-pill-block">
                  Find loads <ArrowIcon />
                </button>
              </form>
              {tracked && (
                <div className="ld-track-result">
                  <span className="ld-track-result-dot" aria-hidden />
                  <span>
                    <b>{tracked}</b> · $/mi shown on every card · book in one tap
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="ld-track-card">
              <h3 className="ld-track-title">Lane Rate Check</h3>
              <form onSubmit={(e) => e.preventDefault()}>
                <label>
                  Origin
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="Enter origin city" aria-label="Origin" />
                  </div>
                </label>
                <label>
                  Destination
                  <div className="ld-input-wrap">
                    <PinIcon />
                    <input type="text" placeholder="Enter destination city" aria-label="Destination" />
                  </div>
                </label>
                <label>
                  Load <span className="ld-field-note">(est. weight)</span>
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
                  Estimate rate <ArrowIcon />
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* -------- Final CTA banner -------- */}
      <section className="ld-final">
        <div className="ld-wrap ld-final-inner" data-reveal>
          <div>
            <span className="ld-kicker">Get started</span>
            <h2 className="ld-h2">Create your free account today</h2>
            <p className="ld-muted">No credit card. Live loads the moment you sign up.</p>
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
    <Link to="/signin?mode=signup" className="ld-cat-card" data-reveal>
      <span className="ld-cat-glow" aria-hidden />
      <img src={img} alt={label} loading="lazy" decoding="async" />
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
    <div className="ld-step" data-reveal>
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
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = value.match(/^([\d,.]+)(.*)$/);
    if (!m) return;
    const target = parseFloat(m[1].replace(/,/g, ''));
    const suffix = m[2];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const dur = 1100;
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          const n = target * eased;
          setDisplay((n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') + suffix);
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <div className="ld-metric" data-reveal ref={ref}>
      <b>{display}</b>
      <span>{label}</span>
    </div>
  );
}

function Review({ name, role, text }: { name: string; role: string; text: string }) {
  return (
    <figure className="ld-review" data-reveal>
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
      <img src={img} alt={name} loading="lazy" decoding="async" />
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