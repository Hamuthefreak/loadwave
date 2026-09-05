import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Modal } from './ui';
import { money, regionLabel } from '../utils/format';

interface InvoiceLoad {
  id: string;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
}

export function InvoiceLoadModal({
  open,
  onClose,
  load,
  onInvoiced,
}: {
  open: boolean;
  onClose: () => void;
  load: InvoiceLoad | null;
  onInvoiced: () => void | Promise<void>;
}) {
  const [customer, setCustomer] = useState('');
  const [currency, setCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = load ? (load.freightAmountTransaction ?? load.freightAmountBase) : null;
  const cur = (load?.freightCurrency ?? 'CAD') as 'CAD' | 'USD';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!load || busy) return;
    if (!customer.trim()) {
      setError('Add who you are billing — the broker or shipper name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Tax (GST/HST/QST) and due date are computed server-side from the lane.
      await api('/api/invoices', {
        method: 'POST',
        body: { customerId: customer.trim(), loadId: load.id, currencyTransaction: currency },
      });
      await api(`/api/loads/${load.id}/status`, { method: 'PATCH', body: { status: 'INVOICED' } });
      await onInvoiced();
      setCustomer('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invoice');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invoice this load"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-green" type="submit" form="invoice-load-form" disabled={busy || !load}>
            {busy ? 'Creating…' : 'Create invoice & mark invoiced'}
          </button>
        </>
      }
    >
      {load && (
        <>
          <p className="muted small" style={{ marginTop: 0, fontWeight: 700 }}>
            {regionLabel(load.originRegion)} → {regionLabel(load.destinationRegion)}
          </p>
          <div className="detail-list" style={{ marginBottom: 12 }}>
            <div className="detail-row"><dt>Freight</dt><dd className="mono-num">{money(subtotal, cur)}</dd></div>
            <div className="detail-row"><dt>Tax</dt><dd className="muted small">GST/HST/QST added automatically for this lane</dd></div>
            <div className="detail-row"><dt>Due</dt><dd className="muted small">30 days from today</dd></div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form id="invoice-load-form" onSubmit={(e) => void submit(e)}>
            <div className="form-grid">
              <label>
                Bill to (broker / shipper)
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="e.g. Acme Logistics"
                  required
                />
              </label>
              <label>
                Currency
                <select value={currency} onChange={(e) => setCurrency(e.target.value as 'CAD' | 'USD')}>
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            </div>
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              Creating the invoice marks this load <strong>Invoiced</strong> and locks it out of further
              dispatch actions.
            </p>
          </form>
        </>
      )}
    </Modal>
  );
}
