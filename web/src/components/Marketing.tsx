import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

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
          <span className="ld-wordmark">
            Loadwave<span className="ld-wordmark-dot">.</span>
          </span>
        </Link>
        <nav className="ld-nav-links" aria-label="Primary">
          <Link to="/#board">Load Board</Link>
          <Link to="/carrier">Carriers</Link>
          <Link to="/broker">Brokers</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/contact">Contact</Link>
        </nav>
        <div className="ld-nav-cta">
          <ThemeToggle />
          <Link to="/signin" className="ld-nav-signin">
            Sign in
          </Link>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Get started
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
          <Link to="/#board" onClick={close}>Load Board</Link>
          <Link to="/carrier" onClick={close}>For Carriers</Link>
          <Link to="/broker" onClick={close}>For Brokers</Link>
          <Link to="/shipper" onClick={close}>For Shippers</Link>
          <Link to="/pricing" onClick={close}>Pricing</Link>
          <span className="ld-menu-rule" />
          <Link to="/signin" onClick={close}>Sign in</Link>
          <Link to="/signin?mode=signup" onClick={close} className="ld-pill ld-pill-orange">
            Get started
          </Link>
          <div className="ld-menu-theme">
            <ThemeToggle />
            <span>Dark mode</span>
          </div>
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
            <p className="ld-newsletter-done">Thanks — you're on the list. 🚚</p>
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
            <span className="ld-wordmark">Loadwave.</span>
          </div>
          <p>
            Live loads, one-tap booking and the paperwork that runs itself — one board for the
            whole trucking business.
          </p>
          <div className="ld-cert-row" aria-label="Certifications">
            <span>MC/USDOT</span>
            <span>FMCSA</span>
            <span>IFTA ready</span>
          </div>
        </div>
        <div className="ld-footer-col">
          <strong>Marketplace</strong>
          <Link to="/carrier">Search Loads</Link>
          <Link to="/carrier">Post Your Truck</Link>
          <Link to="/pricing">Rate Insights</Link>
          <Link to="/pricing">Fuel & IFTA</Link>
        </div>
        <div className="ld-footer-col">
          <strong>Company</strong>
          <Link to="/carrier">For Carriers</Link>
          <Link to="/broker">For Brokers</Link>
          <Link to="/shipper">For Shippers</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
        <div className="ld-footer-col">
          <strong>Get started</strong>
          <Link to="/signin">Sign in</Link>
          <Link to="/signin?mode=signup">Create account</Link>
          <Link to="/pricing">See pricing</Link>
          <Link to="/#locations">Coverage map</Link>
        </div>
      </div>
      <div className="ld-wrap ld-legal">
        <span>© {new Date().getFullYear()} Loadwave. All rights reserved.</span>
        <Link to="/diagnostics" className="ld-legal-link">System diagnostics</Link>
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('ld-revealed'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('ld-revealed');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="ld-mkt">
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
