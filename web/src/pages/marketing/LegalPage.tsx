import { Link } from 'react-router-dom';
import { MarketingLayout } from '../../components/Marketing';

interface Section {
  num: string;
  heading: string;
  body: React.ReactNode;
}

function Prose({ sections }: { sections: Section[] }) {
  return (
    <div className="ld-prose">
      {sections.map((s) => (
        <section key={s.num}>
          <h2>
            <span className="ld-prose-num">{s.num}</span>
            {s.heading}
          </h2>
          {s.body}
        </section>
      ))}
    </div>
  );
}

const PRIVACY_SECTIONS: Section[] = [
  {
    num: '01',
    heading: 'Who we are',
    body: (
      <p>
        <strong>Loadwave</strong> is a freight marketplace and owner-operator TMS ("the
        Service"). We connect carriers, brokers and shippers on a live load board, and we
        run the paperwork around it — loads, trucks, fuel logs, invoices and IFTA summaries.
        This policy explains what data we collect, why, and the choices you have.
      </p>
    ),
  },
  {
    num: '02',
    heading: 'What we collect',
    body: (
      <>
        <p>We collect the minimum needed to run a load board and your back office:</p>
        <ul>
          <li><strong>Account details</strong> — company name, email, base currency, home jurisdiction, and your MC / USDOT numbers if you add them.</li>
          <li><strong>Business records</strong> — the loads and trucks you post, bookings you make, fuel transactions you log, invoices you generate, and the rates you see.</li>
          <li><strong>Technical data</strong> — device type, browser, approximate IP location, and usage events so we can keep the Service fast and debug issues.</li>
          <li><strong>Saved preferences</strong> — saved searches, rate alerts, theme choice, and notification settings.</li>
        </ul>
        <p>We do <strong>not</strong> collect payment card numbers. Billing is handled by a PCI-compliant processor and we only store a token to identify your account.</p>
      </>
    ),
  },
  {
    num: '03',
    heading: 'How we use it',
    body: (
      <ul>
        <li>To run the marketplace — show you loads and trucks, let you book, and keep both sides honest.</li>
        <li>To build the back-office records — invoices, fuel and IFTA summaries that compute themselves from the data you enter.</li>
        <li>To send the alerts you asked for (saved-search and rate alerts) and essential account notices.</li>
        <li>To improve the product — aggregate, de-identified usage helps us decide what to build next.</li>
      </ul>
    ),
  },
  {
    num: '04',
    heading: 'What is private vs. public',
    body: (
      <p>
        Loads you keep <strong>private</strong> are visible only to you and your company. Only
        loads and trucks you choose to <strong>post</strong> become visible to partner carriers
        and brokers on the board. If you add an MC or USDOT number, we show a{' '}
        <strong>Verified carrier</strong> badge on your posts so the other side knows who
        they're dealing with — that identifier is public by design.
      </p>
    ),
  },
  {
    num: '05',
    heading: 'Who we share it with',
    body: (
      <>
        <p>We never sell your data. We share it only:</p>
        <ul>
          <li><strong>With the other side of a transaction</strong> — when you post a load, carriers see it; when you book, the posting company sees your company name and verification.</li>
          <li><strong>With processors</strong> — payments, email delivery (SMTP), and hosting providers, each bound by their own security obligations.</li>
          <li><strong>When required by law</strong> — to comply with a legal request or protect the rights and safety of our users.</li>
        </ul>
      </>
    ),
  },
  {
    num: '06',
    heading: 'How long we keep it',
    body: (
      <p>
        We keep your account and business records while your account is active. When you close
        your account we delete or anonymize your data within 30 days, except where we're
        legally required to retain financial or tax records. IFTA and invoice data may be kept
        as long as your local tax rules require.
      </p>
    ),
  },
  {
    num: '07',
    heading: 'Security',
    body: (
      <p>
        Data is encrypted in transit (TLS) and at rest. Access is scoped per company
        (multi-tenant), so one carrier can never see another's private data. We run the
        Service on least-privilege principals and rotate credentials. No system is perfect, but
        we work to keep yours safe.
      </p>
    ),
  },
  {
    num: '08',
    heading: 'Your rights',
    body: (
      <p>
        Depending on where you operate, you may have the right to access, correct, export, or
        delete your personal data, and to object to or restrict certain processing. Contact us
        and we'll honour any such request within 30 days. You can also ask us to stop sending
        non-essential alerts at any time.
      </p>
    ),
  },
  {
    num: '09',
    heading: 'Cookies & local storage',
    body: (
      <p>
        We use a small amount of browser storage to keep you signed in and remember your
        preferences (theme, saved searches). We don't use third-party ad trackers. You can clear
        this in your browser settings; you may just need to sign in again.
      </p>
    ),
  },
  {
    num: '10',
    heading: 'Changes & contact',
    body: (
      <>
        <p>
          If we make material changes to this policy we'll notify you in-app or by email. The
          "last updated" date below always reflects the current version.
        </p>
        <div className="ld-prose-note">
          Questions about privacy? Email{' '}
          <a href="mailto:privacy@loadwave.app">privacy@loadwave.app</a> — we read every one.
        </div>
      </>
    ),
  },
];

const TERMS_SECTIONS: Section[] = [
  {
    num: '01',
    heading: 'The agreement',
    body: (
      <p>
        These Terms govern your use of Loadwave. By creating an account or using the Service you
        agree to them. If you're using it for a company, you confirm you're authorized to bind
        that company, and "you" means the company.
      </p>
    ),
  },
  {
    num: '02',
    heading: 'Accounts & eligibility',
    body: (
      <p>
        You must provide accurate company information and be legally able to enter a contract.
        You're responsible for keeping your login credentials secure and for everything done
        under your account. We may refuse or close accounts that misrepresent a carrier, broker,
        or shipper identity.
      </p>
    ),
  },
  {
    num: '03',
    heading: 'The marketplace',
    body: (
      <p>
        Loadwave is a venue that connects parties; it is not a carrier, broker, or party to the
        freight contract between you and the other side. Rates, equipment descriptions and
        pickup/delivery windows are posted by users and may change. You're responsible for
        verifying the details before you book or dispatch.
      </p>
    ),
  },
  {
    num: '04',
    heading: 'Booking & postings',
    body: (
      <>
        <p>
          When you post a load or truck, you represent that you have the authority to offer it.
          When you book a load, the booking is final and instant. You agree to:
        </p>
        <ul>
          <li>Keep posted details accurate and update them promptly.</li>
          <li>Not double-book or post phantom capacity.</li>
          <li>Honour bookings you accept on the platform.</li>
        </ul>
      </>
    ),
  },
  {
    num: '05',
    heading: 'Fees & billing',
    body: (
      <p>
        Subscription fees are set on the pricing page and billed in advance. We may offer a free
        tier and trials. If we change fees we'll give you notice; continuing to use the Service
        after a change means you accept the new fees. Late or unpaid accounts may be suspended.
      </p>
    ),
  },
  {
    num: '06',
    heading: 'Your content',
    body: (
      <p>
        You keep the rights to the content you post on Loadwave — your load descriptions, company profile, and documents. You grant us a limited licence to host and display it within the Service. Don't post anything you don't have the rights to, and don't scrape or resell content from the board.
      </p>
    ),
  },
  {
    num: '07',
    heading: 'Acceptable use',
    body: (
      <ul>
        <li>No fake loads, fake trucks, or fake companies.</li>
        <li>No rate manipulation, spam postings, or scraping the board for other platforms.</li>
        <li>No harassment of other users — dispatchers and drivers are people.</li>
        <li>No attempts to break authentication, access another company's data, or overload the Service.</li>
      </ul>
    ),
  },
  {
    num: '08',
    heading: 'Disclaimers',
    body: (
      <p>
        The Service is provided "as is". We work hard to keep the board live and the numbers
        right, but we don't warrant that every load is still available, that rates are current,
        or that the Service will be uninterrupted. IFTA and fuel summaries are tools, not tax
        advice — confirm filings with your accountant.
      </p>
    ),
  },
  {
    num: '09',
    heading: 'Limitation of liability',
    body: (
      <p>
        To the maximum extent permitted by law, Loadwave is not liable for indirect or
        consequential damages — lost profits, lost loads, missed delivery windows, or detention
        claims. Our total liability for any claim is limited to the fees you paid us in the 12
        months before the claim. Nothing here limits liability that can't be limited by law.
      </p>
    ),
  },
  {
    num: '10',
    heading: 'Termination & changes',
    body: (
      <>
        <p>
          You can close your account at any time. We may suspend or terminate accounts that
          violate these terms — with notice where practical. We may update these terms as the
          product evolves; material changes get in-app notice, and the date below always
          reflects the current version.
        </p>
        <div className="ld-prose-note">
          Questions about these terms? Email{' '}
          <a href="mailto:legal@loadwave.app">legal@loadwave.app</a>.
        </div>
      </>
    ),
  },
];

function LegalShell({ kicker, title, updated, children }: {
  kicker: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <MarketingLayout>
      <div className="ld-doc">
        <div className="ld-legal-hero">
          <div className="ld-kicker">{kicker}</div>
          <h1>{title}</h1>
          <p className="ld-legal-updated">Last updated {updated}</p>
        </div>
        {children}
        <div className="ld-prose-footer">
        <p>
            See also our <Link to="/privacy">Privacy Policy</Link> and{' '}
            <Link to="/terms">Terms of Service</Link>.
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell kicker="Legal" title="Privacy Policy" updated="September 2026">
      <Prose sections={PRIVACY_SECTIONS} />
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell kicker="Legal" title="Terms of Service" updated="September 2026">
      <Prose sections={TERMS_SECTIONS} />
    </LegalShell>
  );
}
