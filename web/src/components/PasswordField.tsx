import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * One password field for every auth screen.
 *
 * Sign-in and the reset screen each had their own copy of this markup: a
 * label, a `pw-wrap` span, the input and an absolutely positioned Show
 * button. They had also grown two sets of CSS, because the standalone card
 * drew its border on the wrapper and the sign-in card drew it on the input.
 * The copies had already drifted: the sign-in input kept the browser's
 * default width so the toggle floated in a gap beside it, and the reset
 * screen's toggle was the only one with `tabIndex={-1}`, which took it out of
 * the keyboard order entirely.
 *
 * So the state lives here rather than in the page. Two fields on one screen
 * (a new password and its confirmation) now reveal independently, and a
 * component that unmounts when the tab changes cannot leave its plaintext
 * showing when the next form appears.
 *
 * The input is labelled with `htmlFor` rather than by wrapping it, because a
 * label that contains the hint and the toggle feeds their text into the
 * input's accessible name — "Password At least 8 characters. Show" — and an
 * interactive button inside a label is not valid HTML. The hint is wired up
 * as the description instead.
 *
 * Everything else is the native input, spread through, so `required`,
 * `minLength`, `autoComplete`, validation handlers and autofocus behave the
 * way they did at each call site.
 */

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** Small copy between the label and the field (a strength hint, say). */
  hint?: ReactNode;
}

export default function PasswordField({
  label,
  hint,
  id,
  'aria-describedby': describedBy,
  ...input
}: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const [visible, setVisible] = useState(false);

  const description = [describedBy, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="pw-field">
      <label htmlFor={inputId}>{label}</label>
      {hint ? (
        <span className="small" id={hintId}>
          {hint}
        </span>
      ) : null}
      <span className="pw-wrap">
        <input
          {...input}
          id={inputId}
          type={visible ? 'text' : 'password'}
          aria-describedby={description}
        />
        <button
          type="button"
          className="pw-toggle"
          // Keep the caret in the field when the button is clicked, so the
          // next keystroke still lands in the password being checked.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </div>
  );
}
