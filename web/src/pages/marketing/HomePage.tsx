import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';
import { IconArrowRight, IconCheck, IconClock, IconPin, IconReceipt } from '../../components/icons';
import { PLANS } from './plans';

/**
 * The front page.
 *
 * It used to be built out of the things a landing page is supposed to contain
 * rather than the things this product does: five invented carrier logos, three
 * five-star reviews from invented people, a "#1 Nationwide" badge, counters
 * that animated up to numbers we had made up, an endless ticker of rates
 * nobody could book, a dotted world map with six pins that meant nothing, and
 * a "Find loads" form that answered with a hardcoded string. All of it is
 * gone. What is left is the product itself, shown as an artifact with an
 * "Example" label rather than as a claim, and copy that only says what the
 * code already does.
 *
 * The examples below are deliberately narrow: one load card and one tracking
 * link, the two screens a carrier and a broker actually share. Their numbers
 * are illustrative and their captions say so.
 */

const CAPABILITIES = [
  {
    title: 'Find freight',
    text: 'Filter the board by lane, equipment and rate. Each load card carries the rate per mile, the stop count and the carrier record before anybody books.',
  },
  {
    title: 'Track it without phone calls',
    text: 'Send the broker a link. Positions come from the truck\u2019s own ELD, and arrivals, departures and dwell are worked out from those positions.',
  },
  {
    title: 'Close the books',
    text: 'Invoice with GST, HST or QST, log fuel at the pump, and let the quarter\u2019s IFTA totals add up by jurisdiction.',
  },
];

const BACK_OFFICE = [
  {
    icon: IconReceipt,
    title: 'Invoicing',
    text: 'An invoice built from the load you ran: the stops, the accessorials and the right tax for the province it was delivered in.',
  },
  {
    icon: IconPin,
    title: 'Fuel',
    text: 'A fill logged at the pump keeps its litres, its price and its jurisdiction against the truck that burned it.',
  },
  {
    icon: IconClock,
    title: 'IFTA',
    text: 'Quarterly miles and fuel split by jurisdiction, with the summary ready to hand to the accountant.',
  },
];

export default function HomePage() {
  return (
    <MarketingLayout>
      {/* Hero: the claim, then the thing the claim is about. */}
      <section id="board" className="ld-home-hero">
        <div className="ld-wrap ld-home-hero-grid">
          <div className="ld-home-hero-copy">
            <p className="ld-kicker">Freight software for small carriers</p>
            <h1 className="ld-h1">Book the load. Share the link. Close the books.</h1>
            <p className="ld-hero-sub">
              Loadwave is the board you find freight on, the tracking link your broker can open
              without an account, and the paperwork that would otherwise wait until Saturday.
            </p>
            <div className="ld-home-actions">
              <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
                Create a free account <IconArrowRight />
              </Link>
              <Link to="/pricing" className="ld-pill ld-pill-ghost">
                See the plans
              </Link>
            </div>
            <p className="ld-home-note">
              30 days of the full product, no card. After that the board, booking and fuel log stay
              free.
            </p>
          </div>
          <ExampleLoad />
        </div>
      </section>

      {/* What the product replaces, in the carrier's own words. */}
      <section className="ld-home-band">
        <div className="ld-wrap ld-home-cols">
          <header className="ld-home-head">
            <h2 className="ld-h2">Three tools a small carrier pays for, on one login.</h2>
            <p className="ld-muted">
              The board, the tracker and the books share the same load, so a stop recorded at the
              dock is already the stop on the invoice.
            </p>
          </header>
          <ol className="ld-home-rows">
            {CAPABILITIES.map((item, index) => (
              <li key={item.title} className="ld-home-row">
                <span className="ld-home-row-num">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The tracking link: the one screen the broker sees, so show it. */}
      <section className="ld-home-dark">
        <div className="ld-wrap ld-home-cols">
          <div className="ld-home-head">
            <p className="ld-kicker ld-kicker-light">Tracking</p>
            <h2 className="ld-h2 ld-h2-light">The broker gets a link, not a phone call.</h2>
            <p className="ld-muted ld-muted-light">
              Every load can be shared as a read-only page. It opens in a browser, carries no
              prices and no customer details, and stops working the moment the link is revoked.
            </p>
            <ul className="ld-home-points">
              <li>
                <b>No account for the reader.</b> A dispatcher, a receiver or a shipper can all open
                the same link.
              </li>
              <li>
                <b>Times come from positions.</b> A stop with no fix nearby stays blank instead of
                being guessed.
              </li>
              <li>
                <b>The link is the whole permission.</b> Revoking it ends access; nothing else has to
                be cleaned up.
              </li>
            </ul>
          </div>
          <ExampleTracking />
        </div>
      </section>

      {/* The back office, described as work rather than as a feature list. */}
      <section className="ld-home-band">
        <div className="ld-wrap ld-home-cols">
          <header className="ld-home-head">
            <h2 className="ld-h2">The part that used to be a Saturday job.</h2>
            <p className="ld-muted">
              Fuel, tax and invoices are recorded as the load happens, not re-typed from a shoebox
              of receipts at the end of the quarter.
            </p>
          </header>
          <ul className="ld-home-stack">
            {BACK_OFFICE.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="ld-home-icon" aria-hidden>
                  <Icon size={18} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Prices, quoted from the same catalogue the pricing page uses. */}
      <section className="ld-home-plans">
        <div className="ld-wrap">
          <div className="ld-home-plans-head">
            <div>
              <h2 className="ld-h2">Start free. Pay when the tools earn it.</h2>
            </div>
            <Link to="/pricing" className="ld-pill ld-pill-ghost">
              Compare every feature
            </Link>
          </div>
          <dl className="ld-home-plan-grid">
            {PLANS.map((plan) => (
              <div key={plan.name} className="ld-home-plan">
                <dt>
                  {plan.name}
                  {plan.highlight ? <span className="ld-home-plan-tag">Most popular</span> : null}
                </dt>
                <dd>
                  <span className="ld-home-plan-price">{plan.price}</span>
                  <span className="ld-home-plan-period">{plan.period}</span>
                  <p>{plan.tagline}</p>
                </dd>
              </div>
            ))}
          </dl>
          <p className="ld-home-fine">
            Prices in USD. Card payment is not live yet: a paid plan is switched on once billing is
            arranged, and the 30-day trial needs nothing from you.
          </p>
        </div>
      </section>

      <section className="ld-home-close">
        <div className="ld-wrap ld-home-close-inner">
          <div>
            <h2 className="ld-h2">Put the next load through it.</h2>
            <p className="ld-muted">
              Sign up, book a load, and send the tracking link to whoever is waiting on it.
            </p>
          </div>
          <Link to="/signin?mode=signup" className="ld-pill ld-pill-orange">
            Create a free account <IconArrowRight />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

/** One load card, the way the board draws it. */
function ExampleLoad() {
  return (
    <figure className="ld-fig" aria-labelledby="example-load">
      <div className="ld-fig-head">
        <span>Load board</span>
        <span className="ld-fig-tag">Example</span>
      </div>
      <div className="ld-fig-body">
        <p className="ld-fig-lane">
          <span>Chicago, IL</span>
          <IconArrowRight size={18} />
          <span>Dallas, TX</span>
        </p>
        <p className="ld-fig-meta">Dry van &middot; 925 mi &middot; 2 stops</p>
        <p className="ld-fig-money">
          <b>$2,150</b>
          <span>$2.32/mi</span>
        </p>
        <dl className="ld-fig-rows">
          <div>
            <dt>Pickup</dt>
            <dd>Oct 6, 8:00 a.m.</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>Oct 8, 4:00 p.m.</dd>
          </div>
          <div>
            <dt>Carrier</dt>
            <dd className="ld-fig-good">
              <IconCheck size={14} /> Authority active &middot; MC 1234567
            </dd>
          </div>
        </dl>
      </div>
      <figcaption id="example-load">An example card. Rates and times are illustrative.</figcaption>
    </figure>
  );
}

/** The public tracking page, reduced to the part that answers "where is it?". */
function ExampleTracking() {
  return (
    <figure className="ld-fig ld-fig-dark" aria-labelledby="example-tracking">
      <div className="ld-fig-head">
        <span>Shared tracking link</span>
        <span className="ld-fig-tag">Example</span>
      </div>
      <div className="ld-fig-body">
        <p className="ld-fig-lane">
          <span>Chicago, IL</span>
          <IconArrowRight size={18} />
          <span>Dallas, TX</span>
        </p>
        <p className="ld-fig-meta">In transit &middot; stop 1 of 2 complete</p>
        <ol className="ld-timeline">
          <li className="is-done">
            <span className="ld-timeline-mark" aria-hidden>
              <IconCheck size={11} />
            </span>
            <div>
              <b>Pickup &middot; Chicago, IL</b>
              <span>Arrived 8:04 a.m. &middot; departed 8:56 a.m. &middot; 52 min on site</span>
            </div>
          </li>
          <li className="is-now">
            <span className="ld-timeline-mark" aria-hidden />
            <div>
              <b>In transit</b>
              <span>Last position 2:10 p.m. &middot; 38 km from Dallas, TX</span>
            </div>
          </li>
          <li>
            <span className="ld-timeline-mark" aria-hidden />
            <div>
              <b>Delivery &middot; Dallas, TX</b>
              <span>Booked for Oct 8, 4:00 p.m.</span>
            </div>
          </li>
        </ol>
      </div>
      <figcaption id="example-tracking">
        An example link. Arrival, departure and dwell are derived from ELD positions, never typed in.
      </figcaption>
    </figure>
  );
}
