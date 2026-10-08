import type { ComponentType, ReactNode } from 'react';
import { IconAlert, IconBlock, IconCheck, IconInfo } from './icons';

/**
 * Everything the app has to tell somebody, in one shape.
 *
 * Warnings in this product used to be a paragraph with a coloured background
 * and an emoji at the front — the fuel nudge, the duty-clock nudge, the expiring
 * document, the fill-up still on the phone. Four of them, four hand-written
 * layouts, and no way to tell a *pending* thing from a *broken* thing except by
 * reading the sentence. This is that idea given one geometry: a mark, the words,
 * and an action if there is one, with the tone carried by an icon and an accent
 * so the shape and the severity survive being skimmed on a phone in daylight.
 *
 * The tones mean something specific, and they are the whole point of having
 * four:
 *
 *   info     worth knowing; nothing is wrong and nothing is waiting on you
 *   warn     it will cost you — money, hours, a violation — if it is ignored
 *   danger   already broken, or blocked until somebody acts
 *   success  done: sent, confirmed, cleared
 *
 * `role` follows the tone rather than being a per-call decision — a `danger`
 * interrupts, everything else is announced quietly — because an interruption
 * the caller forgets to opt into is a missed one and an interruption nobody
 * asked for is noise.
 */
export type NoticeTone = 'info' | 'warn' | 'danger' | 'success';

const TONE_MARK: Record<NoticeTone, ComponentType<{ size?: number }>> = {
  info: IconInfo,
  warn: IconAlert,
  danger: IconBlock,
  success: IconCheck,
};

export function Notice({
  tone = 'info',
  title,
  detail,
  children,
  /** A control the driver can act on — a button, a link. Sits after the text. */
  action,
  /** Override the tone's mark, for a notice that is about one particular thing. */
  mark,
  /** An extra class for layout variants (e.g. a write still waiting on the phone). */
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  mark?: ReactNode;
  className?: string;
}) {
  const Mark = TONE_MARK[tone];
  return (
    <div
      className={`notice notice-${tone}${className ? ` ${className}` : ''}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="notice-mark">{mark ?? <Mark size={15} />}</span>
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {detail && <p className="notice-detail">{detail}</p>}
        {children}
      </div>
      {action && <div className="notice-side">{action}</div>}
    </div>
  );
}
