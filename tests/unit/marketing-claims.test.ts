import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The marketing pages make claims on behalf of the product, so they get the
 * same treatment as the rest of the code: a rule with a test behind it.
 *
 * The front page used to carry five invented carrier logos, three five-star
 * reviews from people who do not exist, a "#1 Nationwide" badge and a
 * newsletter form that answered "you're on the list" while posting to nothing.
 * None of that is a styling problem. It is a page saying things the company
 * cannot support, and it is only one enthusiastic redesign away from coming
 * back, so the assertions below name the exact things that must not return.
 *
 * Prices are here for the opposite reason: they are real, and two copies of a
 * real price drift apart. The front page and the pricing page both read the
 * catalogue in `plans.ts`, and this test keeps it that way.
 */

const WEB = join(__dirname, '../../web/src');

/**
 * Comments are not rendered, and this page's own header explains what was
 * removed by naming it. Strip them so the rule is about what a visitor sees,
 * not about what an author is allowed to write down.
 */
const read = (path: string) =>
  readFileSync(join(WEB, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MARKETING_PAGES = [
  'pages/marketing/HomePage.tsx',
  'pages/marketing/PricingPage.tsx',
  'pages/marketing/RoleLanding.tsx',
  'pages/marketing/FaqPage.tsx',
  'pages/marketing/ContactPage.tsx',
  'components/Marketing.tsx',
];

describe('marketing claims', () => {
  it('does not present invented social proof', () => {
    const forbidden: Array<[RegExp, string]> = [
      [/ld-logo-row/, 'a row of company logos implies customers who agreed to be listed'],
      [/ld-review\b/, 'testimonials have to come from real customers'],
      [/5 out of 5 stars/, 'star ratings have to come from real reviews'],
      [/#1 Nationwide/, 'a market-position badge is a claim, not a design element'],
    ];

    for (const page of MARKETING_PAGES) {
      const source = read(page);
      for (const [pattern, why] of forbidden) {
        expect({ page, forbidden: String(pattern), why, found: pattern.test(source) }).toEqual({
          page,
          forbidden: String(pattern),
          why,
          found: false,
        });
      }
    }
  });

  it('has no form that collects an address it cannot use', () => {
    // The only forms left on the marketing site are the contact form (which
    // posts to the contact endpoint) and the auth forms. The footer used to
    // have a third: an email box that faked a subscription.
    expect(read('components/Marketing.tsx')).not.toContain('<form');
  });

  it('quotes plan prices from the one catalogue', () => {
    expect(read('pages/marketing/HomePage.tsx')).toContain("from './plans'");
    expect(read('pages/marketing/PricingPage.tsx')).toContain("from './plans'");

    const catalogue = read('pages/marketing/plans.ts');
    for (const name of ['Solo', 'Pro', 'Fleet']) {
      expect(catalogue).toContain(`name: '${name}'`);
    }
  });
});
