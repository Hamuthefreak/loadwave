import AuthLayout from '../src/components/AuthLayout';
import PasswordField from '../src/components/PasswordField';
import { click, render, renderRoute, setupDom, view } from './harness';

/**
 * DOM tests for the auth components.
 *
 * The repo's unit tests are node-only and mostly read source text, which can
 * prove that a screen imports the shared component but not that the component
 * does its job. These run in jsdom against real rendered markup, so a field
 * that stops revealing its value, or two fields that start sharing one
 * `visible` flag again, fail here.
 */

setupDom();

const inputs = () => Array.from(view().querySelectorAll('input'));

describe('PasswordField', () => {
  it('reveals and re-hides the value from its toggle', () => {
    render(<PasswordField label="Password" defaultValue="correct-horse" />);

    const input = inputs()[0];
    const toggle = view().querySelector('.pw-toggle')!;

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
    click(view().querySelectorAll('.pw-toggle')[0]);

    expect(first.type).toBe('text');
    expect(second.type).toBe('password');
  });

  it('labels the input with the label text only, and describes it with the hint', () => {
    // The field used to be wrapped in <label>, so the hint and the Show
    // button's text were folded into the input's accessible name.
    render(
      <PasswordField
        label="Password"
        hint="At least 8 characters."
        required
        minLength={8}
        autoComplete="new-password"
      />,
    );

    const input = inputs()[0];
    const label = view().querySelector(`label[for="${input.id}"]`)!;
    const hint = view().querySelector('.pw-field .small')!;

    expect(label.textContent).toBe('Password');
    expect(view().querySelector('.pw-field label .pw-toggle')).toBeNull();
    expect(hint.textContent).toBe('At least 8 characters.');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(input.required).toBe(true);
    expect(input.minLength).toBe(8);
    expect(input.getAttribute('autocomplete')).toBe('new-password');
  });

  it('keeps a caller-supplied description alongside the hint', () => {
    render(
      <PasswordField
        label="Password"
        hint="At least 8 characters."
        aria-describedby="strength-meter"
      />,
    );

    const input = inputs()[0];
    expect(input.getAttribute('aria-describedby')).toBe(
      `strength-meter ${view().querySelector('.pw-field .small')!.id}`,
    );
  });
});

describe('AuthLayout', () => {
  const shell = () => view().querySelector('.ld-auth-shell')!;

  it('is a narrow single-column shell for screens without a hero', () => {
    renderRoute(
      <AuthLayout>
        <h1 className="ld-auth-title">Forgot your password?</h1>
      </AuthLayout>,
    );

    expect(shell().getAttribute('data-layout')).toBe('solo');
    expect(view().querySelector('.ld-auth-hero')).toBeNull();
    expect(view().querySelector('.ld-auth-card .ld-auth-title')).not.toBeNull();
    expect(view().querySelector('.ld-auth-back a')?.getAttribute('href')).toBe('/');
  });

  it('puts the hero beside the same form column when one is supplied', () => {
    renderRoute(
      <AuthLayout hero={<h1>Run your truck like a business.</h1>}>
        <h1 className="ld-auth-title">Sign in</h1>
      </AuthLayout>,
    );

    expect(shell().getAttribute('data-layout')).toBe('split');
    expect(view().querySelector('.ld-auth-hero h1')?.textContent).toBe(
      'Run your truck like a business.',
    );
    // The form column is one component, so the brand and footer are not
    // something a screen has to remember to render.
    expect(view().querySelectorAll('.ld-auth-card')).toHaveLength(1);
    expect(view().querySelector('.ld-auth-brand .ld-wordmark')?.textContent).toContain('Loadwave');
    expect(view().querySelector('.ld-auth-back a')?.getAttribute('href')).toBe('/');
  });
});
