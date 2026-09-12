import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './ui';

export const REPORT_REASONS = [
  { value: 'NON_PAYMENT', label: 'Did not pay for a load' },
  { value: 'DOUBLE_BROKERING', label: 'Re-brokered my load without consent' },
  { value: 'FRAUD', label: 'Fraud or identity misuse' },
  { value: 'CARGO_DAMAGE', label: 'Cargo damage or shortage' },
  { value: 'MISREPRESENTATION', label: 'Posted something that was not true' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * File a complaint about a counterparty.
 *
 * Reports are only accepted from a tenant that has actually traded with the
 * other side (the API enforces it), and the text stays between the reporter
 * and platform review — only the count is public. That is deliberate: a
 * free-text field anyone can fill is a defamation risk, not a trust signal.
 */
export function ReportModal({
  open,
  subjectTenantId,
  subjectName,
  loadId,
  onClose,
  onFiled,
}: {
  open: boolean;
  subjectTenantId: string | null;
  subjectName: string;
  loadId?: string | null;
  onClose: () => void;
  onFiled?: (category: string) => void;
}) {
  const [category, setCategory] = useState('NON_PAYMENT');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory('NON_PAYMENT');
      setDetails('');
      setError(null);
      setDone(false);
      setBusy(false);
    }
  }, [open, subjectTenantId]);

  const submit = async () => {
    if (!subjectTenantId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/reports', {
        method: 'POST',
        body: {
          subjectTenantId,
          loadId: loadId ?? undefined,
          category,
          details: details.trim() || undefined,
        },
      });
      setDone(true);
      onFiled?.(category);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not file that report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={done ? 'Report filed' : `Report ${subjectName || 'this carrier'}`}>
      {done ? (
        <>
          <p>
            Thanks — platform review has the report. <strong>{subjectName}</strong> is not told who filed it, and the
            only thing other carriers see is that a report exists.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-green" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Only carriers you have actually traded with can be reported, and you can file one report about a
            counterparty every 90 days. Keep it factual — payment terms, dates, what happened.
          </p>

          <label>
            What happened?
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Details (optional)
            <textarea
              rows={4}
              maxLength={2000}
              placeholder="Load number, dates, amounts, what you were told…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>

          {error && <p className="app-crash-msg">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Filing…' : 'File report'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
