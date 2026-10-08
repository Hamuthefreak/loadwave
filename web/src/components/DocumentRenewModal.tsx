import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './ui';
import { IconCamera } from './icons';
import { fullDate } from '../utils/format';
import { describeAamva, kindHasBarcode, parseAamva } from '../utils/aamva';
import { readPdf417FromImage } from '../utils/pdf417';
import { failureAction } from '../utils/pendingQueue';
import { type RenewalDraft } from '../utils/renewalQueue';
import { queueRenewal, sendRenewal } from '../utils/renewalSend';
import { currentOwner } from '../utils/queueOwner';
import { refreshRenewals } from '../pending-store';

/**
 * A driver renewing their own document, from the cab, on a phone.
 *
 * The licence and the medical card are theirs to produce — waiting until they
 * are next in the yard means the truck sits. What this sends is a *request*: the
 * office gets the photo and the date, and confirms it. Until they do, the
 * document keeps the driver off a dispatch, which is deliberate. A renewal the
 * driver can self-approve is a renewal that stops being checked at all.
 *
 * Two taps and a photo is the whole flow: the date is prefilled from what is on
 * file (a card usually renews into the same month), the camera is one tap, and
 * there is nothing to type unless they want to.
 *
 * For a licence there is a third shortcut: the PDF417 barcode on the back of the
 * card carries the expiry and the licence number precisely as the jurisdiction
 * printed them. Scanning it beats photographing the front and hoping an OCR pass
 * reads a smudged month correctly, and it costs nothing per scan. What it does
 * not do is decide anything — it fills the two boxes the driver is looking at,
 * shows what it read so they can check it, and the office still confirms.
 *
 * And the fourth thing a driver at a fuel stop does not have is signal. If the
 * office cannot be reached the renewal is kept on the phone and sent by itself
 * later (see utils/renewalQueue) rather than handed back as a failed request —
 * losing a photograph of the new card because the signal dropped is how a
 * renewal ends up not happening at all.
 */

export interface RenewableDoc {
  kind: string;
  label: string;
  reference: string;
  expiresAt: string | null;
  documentId: string | null;
  hasFile: boolean;
}

/** Date-only string a year after the current expiry, which is the common cycle. */
function suggestExpiry(expiresAt: string | null): string {
  const base = expiresAt ? new Date(expiresAt) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  const next = new Date(base);
  next.setFullYear(next.getFullYear() + 1);
  return next.toISOString().slice(0, 10);
}

export function DocumentRenewModal({
  doc,
  onClose,
  onSent,
}: {
  doc: RenewableDoc | null;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [expiresAt, setExpiresAt] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<{ text: string; warn: boolean } | null>(null);
  // `navigator.onLine` is only ever a hint, and it is not the decision — a
  // dropped upload falls into the same queue a moment later.
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const scanInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!doc) return;
    setExpiresAt(suggestExpiry(doc.expiresAt));
    setIdentifier('');
    setFile(null);
    setError(null);
    setScanNote(null);
    setScanBusy(false);
  }, [doc?.kind, doc?.expiresAt, doc?.documentId]);

  if (!doc) return null;

  /**
   * Read the barcode off the back of the licence and fill the boxes with it.
   *
   * Every failure here is a phrasing problem, not an error: this runs on a phone
   * held over a plastic card in bad light, so "that did not read" has to tell the
   * driver what to do next, and never leave them stuck.
   */
  const scan = async (picked: File | undefined) => {
    if (!picked || scanBusy) return;
    setScanBusy(true);
    setScanNote(null);
    try {
      const text = await readPdf417FromImage(picked);
      const result = text ? parseAamva(text) : null;
      if (!result || !result.ok) {
        setScanNote({
          warn: true,
          text:
            result?.reason ??
            'No barcode in that photo — get closer, keep the card flat, and try again in good light.',
        });
        return;
      }
      if (result.fields.expiresAt) setExpiresAt(result.fields.expiresAt);
      if (result.fields.licenceNumber) setIdentifier(result.fields.licenceNumber);
      setScanNote({
        warn: result.missingExpiry,
        text: result.missingExpiry
          ? `${describeAamva(result)} — the expiry would not read, so check the date above.`
          : `${describeAamva(result)}. Check it against the card before you send.`,
      });
    } finally {
      setScanBusy(false);
    }
  };

  /**
   * Keep it on the phone and say so. False when this device would not store it,
   * because a renewal that is neither sent nor saved has to be reported as a
   * failure rather than as a success.
   */
  const keepForLater = async (draft: RenewalDraft): Promise<boolean> => {
    const owner = currentOwner();
    if (!owner) return false;
    const queued = await queueRenewal(draft, owner);
    if (!queued) return false;
    await refreshRenewals();
    onSent(
      `${draft.label} is saved on your phone — it sends itself as soon as you have signal, and the office confirms it then.`,
    );
    return true;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const draft: RenewalDraft = {
      kind: doc.kind,
      label: doc.label,
      identifier: identifier || null,
      expiresAt: expiresAt || null,
      photo: file,
      fileName: file?.name ?? null,
      mimeType: file?.type || null,
    };
    try {
      // With no signal at all the attempt is a guaranteed failure, so save it
      // instead — that is the situation this sheet was built for.
      if (!navigator.onLine && (await keepForLater(draft))) return;
      await sendRenewal(draft);
      onSent(
        file
          ? `${doc.label} sent to the office with your photo — they confirm it, then it stops blocking you.`
          : `${doc.label} sent to the office — they confirm it, then it stops blocking you.`,
      );
    } catch (err) {
      // A connection that dropped mid-upload is not an answer from the office —
      // it is the truck-stop signal — so keep the renewal rather than making the
      // driver take the photograph again.
      if (failureAction(err) === 'retry' && (await keepForLater(draft))) return;
      setError(err instanceof Error ? err.message : 'Could not send that renewal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Renew ${doc.label}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-green" onClick={(e) => void submit(e)} disabled={busy}>
            {busy ? 'Sending…' : 'Send to the office'}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)}>
        <p className="muted small" style={{ marginTop: 0 }}>
          {doc.reference}
          {doc.expiresAt ? ` · on file it expires ${fullDate(doc.expiresAt)}` : ' · nothing on file yet'}
        </p>

        {/* Only the licence carries a barcode. Offering a scan on a medical card
            that has none is a dead end on the document drivers renew most. */}
        {kindHasBarcode(doc.kind) && (
          <div className="renew-scan">
            <div className="renew-scan-text">
              <strong>Scan the back of the licence</strong>
              <p className="muted small">
                The barcode carries the expiry and the licence number exactly as your state or
                province printed them. It only fills the boxes below — you check them, then send.
              </p>
            </div>
            {/* The picker is opened by a real button rather than a styled
                label, so it keeps the tap target the rest of the app has. */}
            <button
              type="button"
              className="btn-ghost renew-scan-btn"
              onClick={() => scanInput.current?.click()}
              disabled={scanBusy}
            >
              {scanBusy ? (
                'Reading…'
              ) : (
                <>
                  <IconCamera size={15} className="inline-ico" />
                  Scan the back
                </>
              )}
            </button>
            <input
              ref={scanInput}
              className="renew-scan-input"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Photo of the back of the licence"
              disabled={scanBusy}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                // Clear it so the same photo can be chosen again after a miss.
                e.target.value = '';
                void scan(picked);
              }}
            />
          </div>
        )}

        {scanNote && (
          <div className={`alert ${scanNote.warn ? 'alert-warn' : 'alert-success'}`}>
            {scanNote.text}
          </div>
        )}

        <div className="form-grid">
          <label>
            Renewed to
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
          <label>
            Number on it
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="licence or certificate number"
              maxLength={120}
            />
          </label>
        </div>

        <label className="renew-photo">
          Photo of the new one
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && <p className="muted small">{file.name}</p>}

        <p className="muted small">
          The office sees this on their compliance page and confirms it. It stays a request until
          they do — so nothing here can put a truck on the road by itself.
        </p>

        {!online && (
          <div className="alert alert-warn">
            No signal here — this is saved on your phone and sends itself when you are back in
            coverage.
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {/* A visible submit as well as the footer: on a phone the footer button
            sits under the keyboard once the date picker closes. */}
        <button type="submit" className="btn-green renew-submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send renewal to the office'}
        </button>
      </form>
    </Modal>
  );
}
