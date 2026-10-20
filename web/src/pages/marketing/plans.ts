/**
 * The plan catalogue, in one place.
 *
 * It lives here rather than in `PricingPage.tsx` because the front page quotes
 * the same three prices. Two copies of a price is two prices waiting to
 * disagree, and the one a visitor reads first is the one on the front page.
 *
 * `full` is the per-feature matrix behind the comparison table. A `true` is a
 * tool the plan includes; everything else is `false`, so adding a feature
 * means adding a row and deciding it per plan rather than forgetting one.
 */

export interface Plan {
  name: string;
  tagline: string;
  price: string;
  period: string;
  highlight?: boolean;
  topFeatures: string[];
  full: Record<string, boolean>;
}

export const FEATURE_ROWS: Array<{ label: string; key: string }> = [
  { label: 'Live load board', key: 'board' },
  { label: 'One-tap load booking', key: 'book' },
  { label: 'Post capacity / trucks', key: 'trucks' },
  { label: 'Private network loads', key: 'network' },
  { label: 'Rate insights & market maps', key: 'rates' },
  { label: 'Load comparison tool', key: 'compare' },
  { label: 'Route & trip planning', key: 'route' },
  { label: 'Invoicing with GST/HST/QST', key: 'invoicing' },
  { label: 'Fuel logging', key: 'fuel' },
  { label: 'IFTA quarterly summaries', key: 'ifta' },
  { label: 'Mobile app (phone + tablet)', key: 'mobile' },
];

export const PLANS: Plan[] = [
  {
    name: 'Solo',
    tagline: 'For one owner-operator.',
    price: '$0',
    period: 'while in early access',
    topFeatures: ['Live load board', 'Post your truck', 'Fuel & IFTA', 'Phone + tablet'],
    full: {
      board: true, book: true, trucks: true, network: false, rates: false, compare: false,
      route: false, invoicing: false, fuel: true, ifta: true, mobile: true,
    },
  },
  {
    name: 'Pro',
    tagline: 'For owner-ops & small fleets.',
    price: '$49',
    period: '/mo after trial',
    highlight: true,
    topFeatures: ['Everything in Solo', 'Invoicing & taxes', 'Load comparison', 'Rate insights'],
    full: {
      board: true, book: true, trucks: true, network: true, rates: true, compare: true,
      route: true, invoicing: true, fuel: true, ifta: true, mobile: true,
    },
  },
  {
    name: 'Fleet',
    tagline: 'For dispatchers running 3+ trucks.',
    price: '$149',
    period: '/mo after trial',
    topFeatures: ['Everything in Pro', 'Multi-driver HOS', 'Route & trip planning', 'Priority support'],
    full: {
      board: true, book: true, trucks: true, network: true, rates: true, compare: true,
      route: true, invoicing: true, fuel: true, ifta: true, mobile: true,
    },
  },
];
