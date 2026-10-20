import { axe, toHaveNoViolations } from 'jest-axe';
import ForgotPassword from '../src/pages/ForgotPassword';
import ResetPassword from '../src/pages/ResetPassword';
import SignIn from '../src/pages/SignIn';
import { renderRoute, setupDom, view } from './harness';

/**
 * Accessibility checks on the real auth screens.
 *
 * axe cannot evaluate colour contrast under jsdom — there is no layout or
 * canvas to sample — so `color-contrast` is switched off here and the
 * palette is checked arithmetically in `auth-contrast.test.ts` instead.
 * Everything else that axe can decide from the DOM (names, roles, ARIA,
 * duplicate ids, form labels) runs at WCAG 2.1 A/AA.
 */

expect.extend(toHaveNoViolations);

jest.mock('../src/api', () => ({
  api: jest.fn(),
  purgeOfflineCache: jest.fn(),
  setTokens: jest.fn(),
}));

jest.mock('../src/pending-store', () => ({
  clearPendingQueues: jest.fn(() => Promise.resolve()),
}));

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(() => Promise.resolve('')) },
}));

setupDom();

const AXE_OPTIONS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

async function expectClean(): Promise<void> {
  const results = await axe(view(), AXE_OPTIONS);
  expect(results).toHaveNoViolations();
}

describe('auth screens', () => {
  it('sign-in has no WCAG violations', async () => {
    renderRoute(<SignIn />, '/signin');
    await expectClean();
  });

  it('the create-account tab has no WCAG violations', async () => {
    renderRoute(<SignIn />, '/signin?mode=signup');
    await expectClean();
  });

  it('forgot-password has no WCAG violations', async () => {
    renderRoute(<ForgotPassword />, '/forgot-password');
    await expectClean();
  });

  it('reset-password has no WCAG violations', async () => {
    renderRoute(<ResetPassword />, '/reset-password?token=test-token');
    await expectClean();
  });
});

describe('keyboard order', () => {
  /** Document-order focusables; jsdom does not implement Tab itself. */
  const focusables = () =>
    Array.from(
      view().querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ).filter((element) => element.getAttribute('tabindex') !== '-1' && !element.hasAttribute('disabled'));

  it('reaches the password toggle right after the field, with no negative tabindex', () => {
    renderRoute(<SignIn />, '/signin');

    const password = view().querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;
    const order = focusables();
    const passwordIndex = order.indexOf(password);
    const toggle = view().querySelector<HTMLButtonElement>('.pw-toggle')!;

    expect(passwordIndex).toBeGreaterThanOrEqual(0);
    expect(order[passwordIndex + 1]).toBe(toggle);
    expect(toggle.getAttribute('tabindex')).not.toBe('-1');
  });

  it('keeps every auth control reachable without a mouse', () => {
    renderRoute(<ResetPassword />, '/reset-password?token=test-token');

    const unreachable = focusables().filter((element) => element.tabIndex < 0);
    expect(unreachable).toEqual([]);
    // Both password fields have their own toggle in the tab order.
    expect(view().querySelectorAll('.pw-toggle')).toHaveLength(2);
  });
});
