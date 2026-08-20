import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Is Loadboard a load board like DAT?',
    a: 'It is a load board the way a driver thinks about one: live loads from your network, lane search, $/mile on every card and one-tap booking — plus the pay, fuel and IFTA paperwork that DAT leaves to other apps.',
  },
  {
    q: 'How do I track a shipment?',
    a: 'Enter your location and service on the homepage tracking card, or log in and open your shipments — every load updates live with event-level status from pickup to delivery.',
  },
  {
    q: 'How does booking a load work?',
    a: 'Posts from verified carriers appear on the board. Tap Book load, confirm the rate and distance, and the load is marked taken for everyone instantly — no double booking.',
  },
  {
    q: 'How does IFTA get calculated?',
    a: 'Log fuel at the pump with jurisdiction and litres. Your quarterly summaries compute per-jurisdiction net litres and net tax due automatically using current rates.',
  },
  {
    q: 'How does container leasing work?',
    a: 'Browse depot locations on the world map, pick a container size and term, and we handle the lease paperwork — buy, sell or lease from 40+ locations.',
  },
  {
    q: 'Can I use it on my phone in the cab?',
    a: 'Yes. The app is fully responsive with a thumb-friendly bottom nav — board, fuel and dashboard work at the wheel-side with the same account as your desktop.',
  },
  {
    q: 'Is my carrier data private?',
    a: 'Yes. Everything is multi-tenant. Loads you keep private are only visible to you; only loads you post become visible to partner carriers.',
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <MarketingLayout>
      <section className="ld-hero ld-hero-compact">
        <div className="ld-wrap ld-hero-inner">
          <span className="ld-kicker center-kicker">Questions</span>
          <h1 className="ld-h1">
            Frequently asked <span className="accent">questions</span>
          </h1>
          <p className="ld-hero-sub center">Straight answers from the cab, not a sales deck.</p>
        </div>
      </section>

      <section className="ld-section">
        <div className="ld-wrap ld-faq-list">
          {FAQS.map((f, i) => (
            <div key={f.q} className={open === i ? 'ld-faq-item ld-faq-item-open' : 'ld-faq-item'}>
              <button onClick={() => setOpen(open === i ? null : i)}>
                <span>{f.q}</span>
                <span className="ld-faq-chev" aria-hidden>
                  {open === i ? '−' : '+'}
                </span>
              </button>
              {open === i && <p>{f.a}</p>}
            </div>
          ))}
        </div>
        <div className="ld-wrap center" style={{ marginTop: 40 }}>
          <p className="ld-muted">Still have questions?</p>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Start free and ask us in-app
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}