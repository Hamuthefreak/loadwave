import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Modal, lockScroll } from './ui';
import { money, timeAgo } from '../utils/format';

interface Msg {
  id: string;
  mine: boolean;
  authorLabel: string;
  kind: 'MESSAGE' | 'RATE_PROPOSAL';
  body: string | null;
  proposedAmount: string | null;
  currency: string | null;
  createdAt: string;
}

interface Conversation {
  counterpartyTenantId: string;
  counterpartyName: string;
  unread: number;
  lastAt: string;
  lastPreview: string;
  isBooker: boolean;
}

interface ThreadView {
  load: {
    id: string;
    label: string;
    posterTenantId: string;
    posterName: string;
    bookedByTenantId: string | null;
    marketplaceStatus: string;
    rate: string | null;
    currency: string;
  };
  viewer: {
    role: 'poster' | 'carrier';
    counterpartyTenantId: string | null;
    counterpartyName: string | null;
  };
  conversations: Conversation[];
  thread: Msg[];
}

/**
 * Rate negotiation thread for one load. Used by the posting carrier
 * (My Loads → Messages) and by an interested carrier (board drawer).
 *
 * Threads are private per carrier: a poster talking to three carriers sees
 * three separate conversations, and no carrier can read another's.
 */
export function LoadMessagesModal({
  loadId,
  onClose,
  onSeen,
}: {
  loadId: string | null;
  onClose: () => void;
  /** Fired after the thread loads — lets the parent clear its unread badge. */
  onSeen?: (loadId: string) => void;
}) {
  const [data, setData] = useState<ThreadView | null>(null);
  const [withTenant, setWithTenant] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = loadId !== null;

  useEffect(() => {
    if (open) lockScroll(true);
    else lockScroll(false);
    return () => lockScroll(false);
  }, [open]);

  const refresh = useCallback(
    async (id: string, withId: string | null) => {
      try {
        const qs = withId ? `?with=${encodeURIComponent(withId)}` : '';
        const res = await api<ThreadView>(`/api/board/loads/${id}/messages${qs}`);
        setData(res);
        setWithTenant(res.viewer.counterpartyTenantId);
        if (res.viewer.counterpartyTenantId) onSeen?.(id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not load the conversation');
      }
    },
    // onSeen is intentionally excluded: it changes identity every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    setErr(null);
    setData(null);
    setWithTenant(null);
    setDraft('');
    setAmount('');
    if (loadId) void refresh(loadId, null);
  }, [loadId, refresh]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!loadId || busy) return;
    const body = draft.trim();
    const amt = amount.trim() ? Number(amount.trim()) : undefined;
    if (!body && amt == null) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/board/loads/${loadId}/messages`, {
        method: 'POST',
        body: {
          body: body || undefined,
          proposedAmount: amt,
          // The poster must address one carrier; carriers are auto-routed.
          toTenantId: data?.viewer.role === 'poster' ? (withTenant ?? undefined) : undefined,
        },
      });
      setDraft('');
      setAmount('');
      await refresh(loadId, withTenant);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  const rate = data?.load.rate != null ? Number(data.load.rate) : null;
  const needsPick = !!data && data.viewer.role === 'poster' && !withTenant;
  const title = data
    ? needsPick
      ? 'Negotiations — pick a carrier'
      : `Negotiation — ${data.load.label}`
    : 'Negotiation';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {data && (
        <p className="muted small" style={{ marginTop: -4 }}>
          {data.viewer.role === 'poster'
            ? withTenant
              ? `Talking with ${data.viewer.counterpartyName ?? 'carrier'}`
              : `${data.conversations.length} carrier${data.conversations.length === 1 ? '' : 's'} on ${data.load.label}`
            : `${data.load.posterName}${rate != null ? ` · asking ${money(rate, data.load.currency)}` : ''}`}
          {data.load.marketplaceStatus === 'BOOKED' ? ' · booked' : ''}
        </p>
      )}

      {needsPick && data && data.conversations.length > 1 && (
        <ul className="neg-convo-list">
          {data.conversations.map((c) => (
            <li key={c.counterpartyTenantId}>
              <button
                type="button"
                className="neg-convo"
                onClick={() => {
                  setWithTenant(c.counterpartyTenantId);
                  if (loadId) void refresh(loadId, c.counterpartyTenantId);
                }}
              >
                <span className="neg-convo-top">
                  <strong>{c.counterpartyName}</strong>
                  {c.isBooker && <span className="badge badge-green">Booked</span>}
                  {c.unread > 0 && <span className="msg-count">{c.unread}</span>}
                </span>
                <span className="neg-convo-preview muted small">
                  {c.lastPreview} · {timeAgo(c.lastAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(!needsPick || (data?.conversations.length ?? 0) <= 1) && (
        <>
          <div className="negotiation-thread neg-thread-modal">
            {data && data.thread.length === 0 && (
              <p className="muted small" style={{ margin: '4px 0 8px' }}>
                {data.viewer.role === 'poster'
                  ? 'No messages yet — a carrier reached out, reply here to negotiate.'
                  : `Ask about the lane or offer your rate — ${data.load.posterName} gets a notification.`}
              </p>
            )}
            {(data?.thread ?? []).map((m) => (
              <div key={m.id} className={`msg ${m.mine ? 'mine' : 'theirs'}`}>
                {m.kind === 'RATE_PROPOSAL' && m.proposedAmount != null && (
                  <div className={`msg-offer ${rate != null && Number(m.proposedAmount) > rate ? 'over' : 'under'}`}>
                    {money(m.proposedAmount, m.currency ?? data?.load.currency)}
                    {rate != null && Number(m.proposedAmount) !== rate && (
                      <span className="muted small">
                        {' '}
                        {Number(m.proposedAmount) > rate ? 'above' : 'below'} asking
                      </span>
                    )}
                  </div>
                )}
                {m.body && <div className="msg-body">{m.body}</div>}
                <div className="msg-meta muted small">
                  {m.authorLabel} · {timeAgo(m.createdAt)}
                </div>
              </div>
            ))}
            {data && data.thread.length > 0 && <div className="neg-typing-pad" />}
          </div>
          {err && <p className="app-crash-msg">{err}</p>}
          <form className="negotiation-compose neg-compose-modal" onSubmit={(e) => void send(e)}>
            <input
              className="neg-amount"
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              placeholder={data ? `Offer (${data.load.currency})` : 'Offer'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Proposed amount"
            />
            <input
              className="neg-text"
              type="text"
              inputMode="text"
              placeholder="Reply…"
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Message"
            />
            <button type="submit" className="btn-green" disabled={busy || (!draft.trim() && !amount.trim())}>
              Send
            </button>
          </form>
        </>
      )}

      {!needsPick && err && !data && <p className="app-crash-msg">{err}</p>}
    </Modal>
  );
}
