import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

type Role = 'carrier' | 'broker' | 'shipper';

interface RoleContent {
  eyebrow: string;
  title: string;
  sub: string;
  cta: string;
  painKicker: string;
  pains: Array<{ t: string; d: string }>;
  stepsKicker: string;
  stepsTitle: React.ReactNode;
  steps: Array<{ t: string; d: string }>;
  features: Array<{ t: string; d: string }>;
  compareTitle: string;
  compare: Array<[string, string, string]>;
  faq: Array<{ q: string; a: string }>;
  others: Array<{ role: Role; label: string; note: string }>;
}

const CONTENT: Record<Role, RoleContent> = {
  carrier: {
    eyebrow: 'For carriers & owner-operators',
    title: 'Never deadhead again if you don\u2019t want to.',
    sub: 'Search live loads by lane, book in a tap, and see your revenue per mile on every card. Then let IFTA and invoicing run themselves.',
    cta: 'Start finding freight',
    painKicker: 'The problem',
    pains: [
      { t: 'Deadhead miles eat the margin', d: 'Every empty mile is fuel, tires and time you pay for out of your own rate. Loads picked on a phone call at 6 AM with no lane visibility is how trucks go home empty.' },
      { t: 'Broker phone tag burns the day', d: 'Calling five brokers to check one lane, getting voicemail, waiting on a rate con \u2014 that\u2019s hours of your day spent not driving.' },
      { t: 'Back office piles up fast', d: 'Invoices, fuel receipts, IFTA quarters. For a one-truck operation, paperwork is the second job you never signed up for.' },
    ],
    stepsKicker: 'How it works',
    stepsTitle: (
      <>
        From <span className="accent">empty truck</span> to paid invoice
      </>
    ),
    steps: [
      { t: 'Set your lanes', d: 'Filter the live board by origin, destination, equipment and minimum $/mile. Save the search and get alerts when something fits.' },
      { t: 'Book in a tap', d: 'Rate, distance and revenue per mile are on every card. Book it instantly \u2014 no calls, no waiting on a rate confirmation.' },
      { t: 'Haul it', d: 'The paperwork builds itself as you go \u2014 the load record, mileage and rate are already in your books.' },
      { t: 'Get paid, stay filed', d: 'Auto-invoices with GST/HST/QST handled, monthly revenue and true $/mile tracked, and quarterly IFTA that computes from your fuel logs.' },
    ],
    features: [
      { t: 'Live load board', d: 'Real loads from your network \u2014 filter by origin, destination, equipment and minimum rate.' },
      { t: 'One-tap booking', d: 'Rate, distance and $/mile on every card. Book it now, no phone games.' },
      { t: 'Post your truck', d: 'Tell the market where your equipment is and let brokers book you directly.' },
      { t: 'Verified badge', d: 'Your MC/USDOT verified once \u2014 brokers see it and book you with confidence.' },
      { t: 'Revenue that adds up', d: 'Auto-invoices with GST/HST/QST. Track monthly revenue, miles and true $/mile.' },
      { t: 'IFTA on autopilot', d: 'Log fuel at the pump; quarterly summaries compute themselves.' },
    ],
    compareTitle: 'The old way vs. Loadwave',
    compare: [
      ['Finding a load', 'Call brokers, check 3 boards, hope', 'One live board, filtered to your lanes'],
      ['Checking the rate', 'Trust whoever answers the phone', 'Rate and $/mile printed on every card'],
      ['Booking', 'Voicemail, wait for rate con', 'One tap, instant booking'],
      ['Invoicing', 'Spreadsheet + PDF template', 'Generated from the load, taxes included'],
      ['IFTA', 'Shoebox of receipts in December', 'Fuel logged at the pump, quarter computed'],
      ['Deadhead', 'Whatever happens, happens', 'Post your truck, let loads find you'],
    ],
    faq: [
      { q: 'Do I still need a dispatcher?', a: 'That\u2019s your call. Many owner-operators use Loadwave instead of paying 5\u201310% \u2014 the board shows rates upfront so you can book your own freight. Others run both: dispatcher finds, Loadwave keeps the books straight.' },
      { q: 'What does verification actually do?', a: 'We check your MC/USDOT against FMCSA records and put a Verified badge on everything you post. Brokers and shippers book verified carriers faster, which means you get the load before the unverified guy.' },
      { q: 'How fast do I get paid?', a: 'Invoices generate the moment a load completes. Payment terms are between you and the party that booked you \u2014 the platform keeps the record straight so nobody can claim confusion.' },
      { q: 'I run one truck. Is this overkill?', a: 'It\u2019s built for you, actually. One-truck operations lose the most time to paperwork \u2014 Loadwave turns a Saturday of invoicing and IFTA into a few taps at the pump.' },
      { q: 'Can I post my truck when I\u2019m empty?', a: 'Yes \u2014 post your equipment, current position and where you\u2019re headed. Brokers searching that lane see you first. It\u2019s the difference between deadheading home and deadheading to a load.' },
    ],
    others: [
      { role: 'broker', label: 'For brokers', note: 'Post loads to verified carriers' },
      { role: 'shipper', label: 'For shippers', note: 'Tender freight with tracking' },
    ],
  },

  broker: {
    eyebrow: 'For brokers & freight agents',
    title: 'Post a load to your network and watch it move.',
    sub: 'Manage a trusted carrier list, compare rates, and keep your books GST/HST/QST clean without spreadsheets.',
    cta: 'Start posting loads',
    painKicker: 'The problem',
    pains: [
      { t: 'Covering lanes is a phone sport', d: 'You post to one board, call ten carriers, and pray one is empty and nearby. Meanwhile the clock runs on pickup windows and your customer asks for updates.' },
      { t: 'Carrier trust is a coin flip', d: 'A MC number on a sheet doesn\u2019t tell you if the truck is real, insured, or has ever moved a load on time. Every unknown carrier is a risk you take on your own authority.' },
      { t: 'Margins live or die on rate data', d: 'Quote too high and the shipper shops you; too low and the carrier cancels or you eat the difference. Without lane history, every quote is a guess you defend later.' },
    ],
    stepsKicker: 'How it works',
    stepsTitle: (
      <>
        From <span className="accent">tendered load</span> to covered lane
      </>
    ),
    steps: [
      { t: 'Post the load', d: 'Lane, equipment, dates, rate. It hits the live board instantly and saved-search alerts push it to carriers who run that lane.' },
      { t: 'Booked by verified trucks', d: 'Carriers with FMCSA-verified MC/USDOT profiles book instantly \u2014 you see their verification before you accept, not after.' },
      { t: 'Track it without calling', d: 'The load\u2019s status updates as the carrier works it. No check calls, no \u201cwhere\u2019s my truck\u201d threads.' },
      { t: 'Invoice clean', d: 'Customer invoices generate from the load record with GST/HST/QST computed \u2014 your margin, your rate con, your books, all consistent.' },
    ],
    features: [
      { t: 'Post loads in minutes', d: 'Set lane, equipment, dates and rate. Approved carriers can book instantly.' },
      { t: 'Verified carrier network', d: 'MC/USDOT verified profiles \u2014 know who you\u2019re dispatching before you book.' },
      { t: 'Rate comparisons', d: 'See the rate range on your lanes so every quote is defensible.' },
      { t: 'Carrier relationships', d: 'Your network is yours \u2014 build a list of carriers who show up, and route loads to them first.' },
      { t: 'Invoices & taxes', d: 'Generate customer invoices with Canadian sales tax handled automatically.' },
      { t: 'Fewer check calls', d: 'Load status lives on the platform, so updates don\u2019t cost a phone call.' },
    ],
    compareTitle: 'The old way vs. Loadwave',
    compare: [
      ['Covering a load', 'Call 10 carriers, take the first yes', 'Post once, verified carriers book in'],
      ['Vetting a carrier', 'Google the MC, hope', 'FMCSA-verified badge on every profile'],
      ['Quoting a lane', 'Gut feel plus last week\u2019s memory', 'Lane rate ranges on the board'],
      ['Check calls', 'Every 2 hours, every load', 'Status updates on the platform'],
      ['Back office', 'Broker sheets, spreadsheets, invoices', 'Invoices generated from the load record'],
      ['Carrier network', 'A CRM nobody updates', 'A live list of who actually hauls'],
    ],
    faq: [
      { q: 'Do carriers see my customer\u2019s rates?', a: 'Carriers see the rate you post for the load \u2014 that\u2019s the deal. Your customer relationships and rate history stay on your side of the ledger.' },
      { q: 'What stops a carrier from double-booking?', a: 'Bookings are instant and final on the platform \u2014 a load that\u2019s booked comes off the board. Repeated no-shows hurt a carrier\u2019s record, and you can see that history before you hand over freight.' },
      { q: 'Can I keep my core carriers?', a: 'Yes. Your network is yours \u2014 build a preferred list and post loads to them first, with the open board as overflow when your regulars are full.' },
      { q: 'How does verification work?', a: 'MC/USDOT numbers are checked against FMCSA records when a carrier signs up. The Verified badge means the number is real, active, and belongs to the company you\u2019re about to book.' },
      { q: 'What about factoring and payment?', a: 'Invoices generate from the load record the moment it completes \u2014 clean paperwork that factors fast. Payment terms stay between you and the carrier.' },
    ],
    others: [
      { role: 'carrier', label: 'For carriers', note: 'Find freight, book in a tap' },
      { role: 'shipper', label: 'For shippers', note: 'Tender freight with tracking' },
    ],
  },
  shipper: {
    eyebrow: 'For shippers & 3PLs',
    title: 'Ship with a carrier you can actually trust.',
    sub: 'Verified capacity, live pricing and clean documentation \u2014 from tender to invoice.',
    cta: 'Start shipping',
    painKicker: 'The problem',
    pains: [
      { t: 'You can\u2019t see the truck until it\u2019s late', d: 'Tender to a broker, wait, and hope. When a pickup window slips, you find out from an angry customer \u2014 not from anyone in the chain.' },
      { t: 'Rate opacity costs real money', d: 'If you don\u2019t know the lane\u2019s market rate, you\u2019re accepting whatever number shows up \u2014 and paying for someone else\u2019s margin on top.' },
      { t: 'Paperwork is a mess at the dock', d: 'Missing rate cons, wrong tax codes on invoices, BOLs that don\u2019t match. Every discrepancy costs an hour you don\u2019t have.' },
    ],
    stepsKicker: 'How it works',
    stepsTitle: (
      <>
        From <span className="accent">tender</span> to delivered
      </>
    ),
    steps: [
      { t: 'Post your freight', d: 'Lane, equipment, window, rate. Verified carriers see it on the live board immediately.' },
      { t: 'Get booked by a real carrier', d: 'Every booking shows the carrier\u2019s FMCSA-verified identity \u2014 company, MC/USDOT \u2014 before the truck is yours.' },
      { t: 'Watch it move', d: 'Status updates live as the load is worked. Your team sees the same data the carrier does.' },
      { t: 'One clean invoice', d: 'Documentation generates from the load record \u2014 no mismatches, no tax surprises, no reconciliation emails.' },
    ],
    features: [
      { t: 'Verified carriers', d: 'Every capacity posting shows MC/USDOT verification before you commit.' },
      { t: 'Live tracking data', d: 'Load status keeps your shipment current without phone calls.' },
      { t: 'Market rates', d: 'Rate insights on your lanes keep your freight spend honest.' },
      { t: 'Clean invoicing', d: 'Accurate customer-facing invoices with tax computed for CA/US lanes.' },
      { t: 'Instant booking', d: 'No tender-and-wait \u2014 carriers book your load the moment it fits their truck.' },
      { t: 'One record of truth', d: 'Load, carrier, rate and status in one place \u2014 the same data for everyone.' },
    ],
    compareTitle: 'The old way vs. Loadwave',
    compare: [
      ['Finding capacity', 'Tender to a broker, wait', 'Post to the board, verified carriers book in'],
      ['Knowing the price', 'Whatever the quote says', 'Lane rate ranges on the board'],
      ['Vetting the truck', 'Trust the broker\u2019s word', 'FMCSA-verified carrier on every booking'],
      ['Status updates', 'Phone tag at 2 PM', 'Live status on the platform'],
      ['Paperwork', 'Email chains and PDFs', 'Generated from the load record'],
      ['Audit trail', 'Inboxes and memory', 'One record: load, carrier, rate, status'],
    ],
    faq: [
      { q: 'Do I need a contract to start?', a: 'No. Post your first load today \u2014 verification and booking are immediate. Volume agreements and API access are available when you\u2019re ready.' },
      { q: 'What if a carrier cancels?', a: 'Bookings are firm on both sides, and a carrier\u2019s history is visible before you book. If something goes wrong, the record is on the platform \u2014 not lost in a text thread.' },
      { q: 'Can my team all use it?', a: 'Yes \u2014 your company account supports your whole logistics team. Everyone sees the same loads, statuses and documents.' },
      { q: 'Is my freight data private?', a: 'Your loads are visible only to carriers on the board \u2014 and only the details you post. Rate history and volumes stay yours. See the Privacy Policy for the details.' },
      { q: 'How are rates set?', a: 'You set the rate when you post. Lane rate insights show you the market range, so the number you pick is informed, not hopeful.' },
    ],
    others: [
      { role: 'carrier', label: 'For carriers', note: 'Find freight, book in a tap' },
      { role: 'broker', label: 'For brokers', note: 'Post loads to verified carriers' },
    ],
  },
};

export default function RoleLanding({ role }: { role: Role }) {
  const c = CONTENT[role];
  const [openFaq, setOpenFaq] = useState<number | null>(0);

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
          <span className="ld-kicker center-kicker">{c.painKicker}</span>
          <h2 className="ld-h2 center">
            Sound <span className="accent">familiar?</span>
          </h2>
          <div className="ld-feature-grid ld-pain-grid">
            {c.pains.map((p) => (
              <div className="ld-feature-card ld-pain-card" key={p.t} data-reveal>
                <span className="ld-pain-x" aria-hidden>×</span>
                <b>{p.t}</b>
                <p>{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section ld-section-alt">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">{c.stepsKicker}</span>
          <h2 className="ld-h2 center">{c.stepsTitle}</h2>
          <div className="ld-step-grid ld-steps-row">
            {c.steps.map((s, i) => (
              <div className="ld-step" key={s.t} data-reveal>
                <span className="ld-step-num" aria-hidden>{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">What you get</span>
          <h2 className="ld-h2 center">
            Everything <span className="accent">in one board</span>
          </h2>
          <div className="ld-feature-grid">
            {c.features.map((f) => (
              <div className="ld-feature-card" key={f.t} data-reveal>
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

      <section className="ld-section ld-section-alt">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Compare</span>
          <h2 className="ld-h2 center">{c.compareTitle}</h2>
          <div className="ld-compare-wrap">
            <table className="ld-compare">
              <thead>
                <tr>
                  <th></th>
                  <th>The old way</th>
                  <th className="ld-compare-us">With Loadwave</th>
                </tr>
              </thead>
              <tbody>
                {c.compare.map((row) => (
                  <tr key={row[0]}>
                    <td className="ld-compare-label">{row[0]}</td>
                    <td>{row[1]}</td>
                    <td className="ld-compare-us">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="ld-section">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">FAQ</span>
          <h2 className="ld-h2 center">
            Fair <span className="accent">questions</span>
          </h2>
          <div className="ld-faq-list">
            {c.faq.map((f, i) => (
              <div className={'ld-faq-item' + (openFaq === i ? ' ld-faq-item-open' : '')} key={f.q}>
                <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}
                  <span className="ld-faq-chev" aria-hidden>{openFaq === i ? '\u2212' : '+'}</span>
                </button>
                <div className="ld-faq-body">
                  <p>{f.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section ld-section-alt">
        <div className="ld-wrap">
          <span className="ld-kicker center-kicker">Also on Loadwave</span>
          <h2 className="ld-h2 center">
            One board, <span className="accent">every side</span> of freight
          </h2>
          <div className="ld-feature-grid">
            {c.others.map((o) => (
              <Link
                to={`/${o.role}`}
                className="ld-feature-card ld-other-card"
                key={o.role}
                data-reveal
              >
                <b>{o.label}</b>
                <p>{o.note}</p>
                <span className="ld-other-link">
                  Learn more <ArrowIcon />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-section ld-cta ld-cta-flat">
        <div className="ld-wrap ld-callout" data-reveal>
          <div>
            <span className="ld-kicker ld-kicker-light">Get started</span>
            <h2 className="ld-h2 ld-h2-light">Ready when your wheels are.</h2>
            <p className="ld-muted ld-muted-light">
              Works in the truck and at the desk \u2014 same account, same live data.
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
