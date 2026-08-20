import { useEffect, type ReactNode } from 'react';
import { regionLabel } from '../utils/format';

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'cyan' | 'purple';

const TONE_CLASS: Record<Tone, string> = {
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  blue: 'badge-blue',
  gray: 'badge-gray',
  cyan: 'badge-cyan',
  purple: 'badge-purple',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'cyan';
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" aria-hidden />
      {label && <span className="muted small">{label}</span>}
    </div>
  );
}

export function Empty({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden />
      <strong>{title}</strong>
      {sub && <p className="muted small">{sub}</p>}
      {action}
    </div>
  );
}

export function Lane({
  originRegion,
  destinationRegion,
  big,
}: {
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  big?: boolean;
}) {
  return (
    <div className={big ? 'lane lane-big' : 'lane'}>
      <span className="lane-city">{regionLabel(originRegion)}</span>
      <span className="lane-arrow" aria-hidden>
        →
      </span>
      <span className="lane-city">{regionLabel(destinationRegion)}</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
