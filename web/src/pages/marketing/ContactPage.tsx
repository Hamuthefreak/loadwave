import { useState } from 'react';
import { MarketingLayout } from '../../components/Marketing';

const CHANNELS = [
  {
    title: 'Support',
    desc: 'Account issues, bookings, billing — anything about using Loadwave.',
    email: 'support@loadwave.app',
    hours: 'Mon–Fri, 7am–7pm CT',
  },
  {
    title: 'Carrier network',
    desc: 'Get your fleet verified, post trucks, or ask about carrier requirements.',
    email: 'carriers@loadwave.app',
    hours: 'Mon–Sat, 7am–7pm CT',
  },
  {
    title: 'Brokers & shippers',
    desc: 'Post loads at volume, API access, or enterprise pricing.',
    email: 'sales@loadwave.app',
    hours: 'Mon–Fri, 8am–6pm CT',
  },
  {
    title: 'Privacy & legal',
    desc: 'Data requests, DMCA, terms questions.',
    email: 'privacy@loadwave.app',
    hours: 'Replies within 30 days',
  },
];

const TOPICS = ['Support', 'Carrier network', 'Brokers & shippers', 'Privacy & legal'];

export function ContactPage() {
  const [sent, setSent] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]);

  return (
    <MarketingLayout>
      <div className="ld-doc">
        <div className="ld-doc-head">
          <div className="ld-kicker">Contact</div>
          <h1>Talk to a human.</h1>
          <p className="ld-doc-meta">
            No ticket mazes. Real people who know freight answer these inboxes.
          </p>
        </div>

        <div className="ld-contact-grid">
          <div className="ld-contact-cards">
            {CHANNELS.map((c) => (
              <div className="ld-contact-card" key={c.title}>
                <b>{c.title}</b>
                <p>{c.desc}</p>
                <a className="ld-contact-addr" href={`mailto:${c.email}`}>
                  {c.email}
                </a>
                <span className="ld-contact-hours">{c.hours}</span>
              </div>
            ))}
          </div>

          <div className="ld-contact-form">
            <h3>Send a message</h3>
            {sent ? (
              <div className="ld-contact-done">
                <div className="ld-contact-done-mark">✓</div>
                <h4>Message received.</h4>
                <p>
                  We route by topic, so your note lands with the right team. Expect a reply
                  within one business day — usually faster.
                </p>
                <button
                  type="button"
                  className="ld-pill ld-pill-orange"
                  onClick={() => setSent(false)}
                >
                  Send another
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSent(true);
                }}
              >
                <label>
                  Topic
                  <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                    {TOPICS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Name
                  <input type="text" required placeholder="Jane Doe" />
                </label>
                <label>
                  Company & MC/USDOT (optional)
                  <input type="text" placeholder="Doe Logistics · MC123456" />
                </label>
                <label>
                  Email
                  <input type="email" required placeholder="you@company.com" />
                </label>
                <label>
                  Message
                  <textarea required rows={5} placeholder="How can we help?" />
                </label>
                <button type="submit" className="ld-pill ld-pill-orange">
                  Send message
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="ld-prose" style={{ marginTop: 40 }}>
          <div className="ld-prose-note">
            <strong>Emergency on a live load?</strong> If a booking is active and something is
            wrong right now, use the in-app support thread on the load itself — it pages the
            on-call dispatcher, not the general inbox.
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}

export default ContactPage;
