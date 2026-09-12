import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Modal, lockScroll } from './ui';
import { money, timeAgo } from '../utils/format';

interface Msg {
  id: string;
  mine: boolean;
  authorLabel: string;
  kind: 'MESSAGE' | 'RATE_PROPOSAL' | 'SYSTEM';
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
  lastOfferAmount: string | null;
  lastOfferAt: string | null;
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
 * Rate negotiation inbox for one load.
 *
 * Threads are private per carrier: a poster talking to three carriers sees
 * three separate conversations, compares their offers side by side, and can
 * accept one — which rewrites the load's asking rate. No carrier can read
 * another's thread.
 */
export function LoadMessagesModal({
  loadId,
  onClose,
  onSeen,
  onRateAccepted,
}: {
  loadId: string | null;
  onClose: () => void;
  /** Fired after the thread loads — lets the parent clear its unread badge. */
  onSeen?: (loadId: string) => void;
  /** Fired after an offer is accepted, so the parent can reload the load. */
  onRateAccepted?: (loadId: string) => void;
}) {
  const [data, setData] = useState<ThreadView | null>(null);
  const [withTenant, setWithTenant] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The offer awaiting confirmation: nothing changes on a single tap. */
  const [pending, setPending] = useState<{ counterpartyTenantId: string; amount: string } | null>(null);

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
    setPending(null);
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

  const accept = async () => {
    if (!loadId || !pending || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/board/loads/${loadId}/accept-offer`, {
        method: 'POST',
        body: { counterpartyTenantId: pending.counterpartyTenantId },
      });
      setPending(null);
      await refresh(loadId, withTenant ?? pending.counterpartyTenantId);
      onRateAccepted?.(loadId);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not accept that offer');
    } finally {
      setBusy(false);
    }
  };

  const rate = data?.load.rate != null ? Number(data.load.rate) : null;
  const currency = data?.load.currency ?? 'CAD';
  const needsPick = !!data && data.viewer.role === 'poster' && !withTenant;
  const isPoster = data?.viewer.role === 'poster';

  // Cheapest offer in the inbox, so the poster can spot it at a glance.
  const offers = (data?.conversations ?? [])
    .map((c) => (c.lastOfferAmount != null ? Number(c.lastOfferAmount) : null))
    .filter((n): n is number => n != null && Number.isFinite(n));
  const bestOffer = offers.length ? Math.min(...offers) : null;
  const totalUnread = (data?.conversations ?? []).reduce((sum, c) => sum + c.unread, 0);

  const title = data
    ? needsPick
      ? 'Negotiations — pick a carrier'
      : `Negotiation — ${data.load.label}`
    : 'Negotiation';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {data && (
        <p className="muted small neg-sub">
          {isPoster
            ? withTenant
              ? `Talking with ${data.viewer.counterpartyName ?? 'carrier'}`
              : `${data.conversations.length} carrier${data.conversations.length === 1 ? '' : 's'} on ${data.load.label}`
            : `${data.load.posterName}${rate != null ? ` · asking ${money(rate, currency)}` : ''}`}
          {isPoster && rate != null ? ` · asking ${money(rate, currency)}` : ''}
          {isPoster && totalUnread > 0 ? ` · ${totalUnread} unread` : ''}
          {data.load.marketplaceStatus === 'BOOKED' ? ' · booked' : ''}
        </p>
      )}

      {/* Accepting rewrites the load's rate — always confirm first. */}
      {pending && (
        <div className="neg-confirm" role="alertdialog" aria-label="Confirm accepted rate">
          <p>
            Set the rate for <strong>{data?.load.label}</strong> to{' '}
            <strong>{money(pending.amount, currency)}</strong>? The carrier is notified and the
            board shows the new asking rate.
          </p>
          <div className="neg-confirm-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-green btn-sm" onClick={() => void accept()} disabled={busy}>
              {busy ? 'Accepting…' : `Accept ${money(pending.amount, currency)}`}
            </button>
          </div>
        </div>
      )}

      {needsPick && data && data.conversations.length > 1 && (
        <ul className="neg-convo-list">
          {data.conversations.map((c) => {
            const offer = c.lastOfferAmount != null ? Number(c.lastOfferAmount) : null;
            const delta = offer != null && rate != null ? offer - rate : null;
            const isBest = offer != null && bestOffer != null && offer === bestOffer;
            return (
              <li key={c.counterpartyTenantId}>
                <div className="neg-convo-row">
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
                      {isBest && <span className="badge badge-green">Best offer</span>}
                      {c.unread > 0 && <span className="msg-count">{c.unread}</span>}
                    </span>
                    <span className="neg-convo-preview muted small">
                      {offer != null ? (
                        <>
                          <strong className="neg-offer">{money(offer, currency)}</strong>
                          {delta != null && delta !== 0 ? (
                            <span className={delta < 0 ? 'neg-delta down' : 'neg-delta up'}>
                              {' '}
                              {delta < 0 ? '−' : '+'}
                              {money(Math.abs(delta), currency).replace(/^\$/, '$')} vs asking
                            </span>
                          ) : null}
                          {' · '}
                        </>
                      ) : null}
                      {c.lastPreview} · {timeAgo(c.lastAt)}
                    </span>
                  </button>
                  {offer != null && (
                    <button
                      type="button"
                      className="btn-sm neg-accept"
                      onClick={() => setPending({ counterpartyTenantId: c.counterpartyTenantId, amount: String(offer) })}
                    >
                      Accept
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(!needsPick || (data?.conversations.length ?? 0) <= 1) && (
        <>
          <div className="negotiation-thread neg-thread-modal">
            {data && data.thread.length === 0 && (
              <p className="muted small" style={{ margin: '4px 0 8px' }}>
                {isPoster
                  ? 'No messages yet — a carrier reached out, reply here to negotiate.'
                  : `Ask about the lane or offer your rate — ${data.load.posterName} gets a notification.`}
              </p>
            )}
            {(data?.thread ?? []).map((m) => (
              <div key={m.id} className={`msg ${m.mine ? 'mine' : 'theirs'} ${m.kind === 'SYSTEM' ? 'sys' : ''}`}>
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
                {isPoster && !m.mine && m.proposedAmount != null && withTenant && (
                  <button
                    type="button"
                    className="btn-sm neg-accept-inline"
                    onClick={() => setPending({ counterpartyTenantId: withTenant, amount: String(Number(m.proposedAmount)) })}
                  >
                    Accept {money(m.proposedAmount, m.currency ?? currency)}
                  </button>
                )}
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
              placeholder={data ? `Offer (${currency})` : 'Offer'}
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
