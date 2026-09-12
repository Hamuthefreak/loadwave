import { useEffect, useState } from 'react';
import { api } from '../api';
import { lockScroll } from './ui';

const STARS = [1, 2, 3, 4, 5];

/**
 * Post-delivery carrier rating. The backend enforces that only the two
 * marketplace participants can rate each other, once, after DELIVERED —
 * this modal just needs to collect stars + an optional note.
 */
export function RateCarrierModal({
  loadId,
  laneLabel,
  onClose,
  onRated,
}: {
  loadId: string | null;
  laneLabel: string;
  onClose: () => void;
  onRated?: () => void;
}) {
  const open = loadId !== null;
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) lockScroll(true);
    else lockScroll(false);
    return () => lockScroll(false);
  }, [open]);

  useEffect(() => {
    if (open) {
      setStars(0);
      setHover(0);
      setComment('');
      setErr(null);
      setDone(false);
    }
  }, [open, loadId]);

  const submit = async () => {
    if (!loadId || busy || stars === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/ratings', {
        method: 'POST',
        body: { loadId, stars, comment: comment.trim() || undefined },
      });
      setDone(true);
      onRated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit rating');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ display: open ? undefined : 'none' }}>
      <div className="modal rate-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rate carrier">
        {done ? (
          <div className="rate-done">
            <div className="rate-done-stars" aria-hidden>★★★★★</div>
            <h3>Thanks for the rating</h3>
            <p className="muted small">It shows on your loads and builds trust on the board.</p>
            <button className="btn-green btn-block" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="drawer-head" style={{ padding: '10px 16px' }}>
              <h3>Rate your partner</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <p className="muted small" style={{ margin: '0 16px 10px' }}>{laneLabel} — how did it go?</p>
            <div className="rate-stars" role="radiogroup" aria-label="Stars">
              {STARS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={stars === s}
                  className={`rate-star ${s <= (hover || stars) ? 'lit' : ''}`}
                  onMouseEnter={() => setHover(s)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setStars(s)}
                  aria-label={`${s} star${s === 1 ? '' : 's'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className="rate-comment"
              placeholder="Optional — anything partners should know?"
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {err && <p className="app-crash-msg">{err}</p>}
            <button className="btn-green btn-block" disabled={stars === 0 || busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit rating'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
