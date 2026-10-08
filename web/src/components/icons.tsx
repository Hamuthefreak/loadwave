import type { ReactNode } from 'react';

/**
 * The app's icons.
 *
 * These replace the emoji that used to stand in for them — a fuel pump, a bell,
 * a warning triangle, an upload arrow. Emoji were the wrong tool three times
 * over: they render as a different picture on every platform, they carry a
 * colour and a mood the design cannot control, and they sit in the text as
 * characters, so a screen reader announces the picture's *name* in the middle of
 * a sentence. An icon here is markup: it inherits `currentColor`, so tone comes
 * from the component that owns it, and it is `aria-hidden`, so the words beside
 * it are the only thing announced. `tests/unit/no-emoji.test.ts` keeps it that
 * way.
 *
 * One geometry for all of them — a 24 box, 1.7 stroke, round caps, no fills
 * except the star — because a set that is drawn to one grid is the difference
 * between an interface and a collection of pictures.
 */

function Glyph({
  size = 16,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export interface IconProps {
  size?: number;
  className?: string;
}

/** Warning: something needs attention before it becomes a problem. */
export function IconAlert({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M13.1 3.4 22 19.6a1.3 1.3 0 0 1-1.1 1.9H3.1A1.3 1.3 0 0 1 2 19.6L10.9 3.4a1.3 1.3 0 0 1 2.2 0Z" />
      <path d="M12 9.4v4.4" />
      <path d="M12 17.1h.01" />
    </Glyph>
  );
}

/** Blocked: the app will not let this through. */
export function IconBlock({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M6.1 6.1l11.8 11.8" />
    </Glyph>
  );
}

/** Information: worth knowing, nothing to fix. */
export function IconInfo({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 11.1v5.3" />
      <path d="M12 7.9h.01" />
    </Glyph>
  );
}

/** Done, sent, confirmed. */
export function IconCheck({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M5 12.7l4.3 4.3L19 7.3" />
    </Glyph>
  );
}

/** Waiting: with the office, or on this phone until there is signal. */
export function IconClock({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 7.3V12l3.3 2" />
    </Glyph>
  );
}

/** Diesel, and the fuel card. */
export function IconFuel({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M5.6 20.6V5.3a2 2 0 0 1 2-2h4.3a2 2 0 0 1 2 2v15.3" />
      <path d="M3.7 20.6h11.9" />
      <path d="M7.7 7.6h4.1" />
      <path d="M13.9 9.1h2.3a2 2 0 0 1 2 2v5.6a1.7 1.7 0 1 0 3.3 0V9.6l-2.3-2.5" />
    </Glyph>
  );
}

/** A duty clock running: the 30-minute break, the detention timer. */
export function IconTimer({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <circle cx="12" cy="13.5" r="7.2" />
      <path d="M12 9.7v3.8l2.6 1.6" />
      <path d="M9.5 3.5h5" />
      <path d="M12 3.5v2.8" />
    </Glyph>
  );
}

/** Load alerts, notifications. */
export function IconBell({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M6.4 9.7a5.6 5.6 0 0 1 11.2 0c0 3.2.7 4.6 1.5 5.5.4.4.1 1.1-.5 1.1H5.4c-.6 0-.9-.7-.5-1.1.8-.9 1.5-2.3 1.5-5.5Z" />
      <path d="M9.9 19.2a2.1 2.1 0 0 0 4.2 0" />
    </Glyph>
  );
}

/** A write leaving the phone. */
export function IconSend({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M12 15.6V4.4" />
      <path d="M7.8 8.6 12 4.4l4.2 4.2" />
      <path d="M4.6 15.1v3.1a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3.1" />
    </Glyph>
  );
}

/** Photograph something: the camera on a document scan. */
export function IconCamera({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M4.2 8.4h2.5l1.5-2.3h7.6l1.5 2.3h2.5a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7v-7.9a1.7 1.7 0 0 1 1.7-1.7Z" />
      <circle cx="12" cy="13.9" r="3.2" />
    </Glyph>
  );
}

/** A rating. Filled, because an average is a claim, not a control. */
export function IconStar({ size = 14, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path
        d="M12 3.6l2.6 5.4 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z"
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  );
}

/** Reporting a counterparty: a raised flag, not an emoji flag. */
export function IconFlag({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M6.2 20.8V3.6" />
      <path d="M6.2 4.6h11.6l-2 3.6 2 3.6H6.2" />
    </Glyph>
  );
}

/** Negotiation, messages on a load. */
export function IconChat({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M20.5 12.4c0 3.9-3.8 7-8.5 7-1 0-2-.2-2.9-.5l-4.5 1.3 1.2-3.4a6.6 6.6 0 0 1-2.3-4.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />
    </Glyph>
  );
}

/** A locked plan feature, and a locked account. */
export function IconLock({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <rect x="4.6" y="10.4" width="14.8" height="10" rx="2.2" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
    </Glyph>
  );
}

/** A security control: shielding the account. */
export function IconShield({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M12 3.2l7.5 2.6v6.1c0 4.3-3 7.4-7.5 8.7-4.5-1.3-7.5-4.4-7.5-8.7V5.8z" />
    </Glyph>
  );
}

/** An access key: the second factor, the recovery codes. */
export function IconKey({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <circle cx="8.5" cy="15.5" r="3.4" />
      <path d="M10.9 13.1l7.5-7.5" />
      <path d="M16.1 5.2 18.8 7.9" />
      <path d="M14.3 7 17 9.7" />
    </Glyph>
  );
}

/** Freight: the newsletter thank-you, and anywhere a load is the subject. */
export function IconTruck({ size, className }: IconProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="M3.4 16.1V6.6h10.9v9.5" />
      <path d="M14.3 9.9h3.5l2.8 3.1v3.1" />
      <circle cx="7.2" cy="17.6" r="1.8" />
      <circle cx="17" cy="17.6" r="1.8" />
    </Glyph>
  );
}
