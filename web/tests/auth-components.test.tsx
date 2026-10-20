import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import AuthLayout from '../src/components/AuthLayout';
import PasswordField from '../src/components/PasswordField';

/**
 * DOM tests for the auth components.
 *
 * The repo's unit tests are node-only and mostly read source text, which can
 * prove that a screen imports the shared component but not that the component
 * does its job. These run in jsdom against real rendered markup, so a field
 * that stops revealing its value, or two fields that start sharing one
 * `visible` flag again, fail here.
 */

// React 18 asks tests to say the environment understands act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (ui: ReactNode) => act(() => root.render(ui));

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

const inputs = () => Array.from(container.querySelectorAll('input'));

describe('PasswordField', () => {
  it('reveals and re-hides the value from its toggle', () => {
    render(<PasswordField label="Password" defaultValue="correct-horse" />);

    const input = inputs()[0];
    const toggle = container.querySelector('.pw-toggle')!;

    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');

    click(toggle);
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');

    click(toggle);
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');
  });

  it('gives each field on a form its own visibility', () => {
    // Reset-password renders two of these. They shared one page-level flag
    // before; revealing the new password also revealed its confirmation.
    render(
      <>
        <PasswordField label="New password" defaultValue="a" />
        <PasswordField label="Confirm new password" defaultValue="a" />
      </>,
    );

    const [first, second] = inputs();
    click(container.querySelectorAll('.pw-toggle')[0]);

    expect(first.type).toBe('text');
    expect(second.type).toBe('password');
  });

  it('leaves native validation and autocomplete attributes on the input', () => {
    render(
      <PasswordField
        label="Password"
        required
        minLength={8}
        autoComplete="new-password"
        hint="At least 8 characters."
      />,
    );

    const input = inputs()[0];
    expect(input.required).toBe(true);
    expect(input.minLength).toBe(8);
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(container.textContent).toContain('At least 8 characters.');
  });
});

describe('AuthLayout', () => {
  const renderLayout = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
  const shell = () => container.querySelector('.ld-auth-shell')!;

  it('is a narrow single-column shell for screens without a hero', () => {
    renderLayout(
      <AuthLayout>
        <h1 className="ld-auth-title">Forgot your password?</h1>
      </AuthLayout>,
    );

    expect(shell().getAttribute('data-layout')).toBe('solo');
    expect(container.querySelector('.ld-auth-hero')).toBeNull();
    expect(container.querySelector('.ld-auth-card .ld-auth-title')).not.toBeNull();
    expect(container.querySelector('.ld-auth-back a')?.getAttribute('href')).toBe('/');
  });

  it('puts the hero beside the same form column when one is supplied', () => {
    renderLayout(
      <AuthLayout hero={<h1>Run your truck like a business.</h1>}>
        <h1 className="ld-auth-title">Sign in</h1>
      </AuthLayout>,
    );

    expect(shell().getAttribute('data-layout')).toBe('split');
    expect(container.querySelector('.ld-auth-hero h1')?.textContent).toBe(
      'Run your truck like a business.',
    );
    // The form column is one component, so the brand and footer are not
    // something a screen has to remember to render.
    expect(container.querySelectorAll('.ld-auth-card')).toHaveLength(1);
    expect(container.querySelector('.ld-auth-brand .ld-wordmark')?.textContent).toContain(
      'Loadwave',
    );
    expect(container.querySelector('.ld-auth-back a')?.getAttribute('href')).toBe('/');
  });
});
