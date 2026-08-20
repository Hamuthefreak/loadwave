import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function LogoMark({ size = 46 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <img src="/assets/images/logo.png" alt="Loadboard logo" />
    </span>
  );
}

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className={scrolled ? 'ld-nav ld-nav-scrolled' : 'ld-nav'}>
      <div className="ld-wrap ld-nav-inner">
        <Link to="/" className="ld-brand" onClick={close}>
          <LogoMark />
          <span className="ld-wordmark">
            Loadboard<span className="ld-wordmark-dot">.</span>
          </span>
        </Link>
        <nav className="ld-nav-links" aria-label="Primary">
          <Link to="/#track">Track Package</Link>
          <Link to="/#services">Services</Link>
          <Link to="/#locations">Locations</Link>
          <Link to="/#reviews">Reviews</Link>
        </nav>
        <div className="ld-nav-cta">
          <Link to="/signin" className="ld-nav-signin">
            Sign in
          </Link>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Contact us
          </Link>
          <button
            className="ld-burger"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      {open && (
        <nav className="ld-menu" aria-label="Mobile">
          <Link to="/#track" onClick={close}>Track Package</Link>
          <Link to="/#services" onClick={close}>Services</Link>
          <Link to="/#locations" onClick={close}>Locations</Link>
          <Link to="/#reviews" onClick={close}>Reviews</Link>
          <span className="ld-menu-rule" />
          <Link to="/signin" onClick={close}>Sign in</Link>
          <Link to="/signin?mode=signup" onClick={close} className="ld-pill ld-pill-orange">
            Contact us
          </Link>
        </nav>
      )}
    </header>
  );
}

export function MarketingFooter() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  const onSubscribe = (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setDone(true);
  };

  return (
    <footer className="ld-footer">
      <div className="ld-wrap">
        <div className="ld-newsletter">
          <div>
            <span className="ld-kicker ld-kicker-light">Market rates weekly</span>
            <h3 className="ld-newsletter-title">Get freight rates in your inbox</h3>
          </div>
          {done ? (
            <p className="ld-newsletter-done">Thanks — you’re on the list. 🚚</p>
          ) : (
            <form className="ld-newsletter-form" onSubmit={onSubscribe}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="Email address"
              />
              <button type="submit" className="ld-pill ld-pill-orange">
                Subscribe
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="ld-wrap ld-footer-grid">
        <div className="ld-footer-brand">
          <div className="ld-brand ld-brand-light">
            <LogoMark />
            <span className="ld-wordmark">Loadboard.</span>
          </div>
          <p>
            Worldwide cargo, container leasing and end-to-end logistics — one board for every
            shipment.
          </p>
          <div className="ld-cert-row" aria-label="Certifications">
            <span>ISO 9001</span>
            <span>FMCSA</span>
            <span>C-TPAT</span>
          </div>
        </div>
        <div className="ld-footer-col">
          <strong>Services</strong>
          <Link to="/#services">Sea Shipping</Link>
          <Link to="/#services">Air Shipping</Link>
          <Link to="/#services">Train Shipping</Link>
          <Link to="/pricing">Container Leasing</Link>
        </div>
        <div className="ld-footer-col">
          <strong>Company</strong>
          <Link to="/carrier">For Carriers</Link>
          <Link to="/broker">For Brokers</Link>
          <Link to="/shipper">For Shippers</Link>
          <Link to="/faq">FAQ</Link>
        </div>
        <div className="ld-footer-col">
          <strong>Contact</strong>
          <Link to="/signin">Sign in</Link>
          <Link to="/signin?mode=signup">Create account</Link>
          <Link to="/#track">Track a shipment</Link>
          <Link to="/#locations">Locations</Link>
        </div>
      </div>
      <div className="ld-wrap ld-legal">
        © {new Date().getFullYear()} Loadboard. Demo build — not affiliated with real carriers.
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ld-mkt">
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}