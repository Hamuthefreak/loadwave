import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Empty, Lane, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../utils/format';
import { equipmentLabel } from './regions';
import type { BoardLoad } from './boardTypes';

export default function Network() {
  const [loads, setLoads] = useState<BoardLoad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLoads(await api<BoardLoad[]>('/api/board/loads/my'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const privateLoads = loads.filter((l) => l.marketplaceStatus === 'PRIVATE');
  const onBoard = loads.filter((l) => l.marketplaceStatus !== 'PRIVATE').length;

  return (
    <div>
      <PageHeader
        title="Private network"
        sub="Loads shared only with the carriers and brokers you trust — not the open board."
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Your private loads</h3>
        <p className="muted small">
          Loads you keep private are visible only to you and the partners you share them with.
          When you post a load to the open board it becomes visible to every verified carrier.
        </p>
        <div className="board-metrics" style={{ marginTop: 10 }}>
          <span><b>{privateLoads.length}</b> private loads</span>
          <span><b>{onBoard}</b> on the open board</span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="spinner-wrap"><span className="spinner" aria-hidden /><span className="muted small">Loading network…</span></div>
      ) : privateLoads.length === 0 ? (
        <Empty
          title="No private loads right now"
          sub="Loads you save as private on the My Loads page appear here. They stay out of the public board until you post them."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lane</th>
                <th>Equipment</th>
                <th>Rate</th>
                <th>Visibility</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {privateLoads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Lane originCountry={l.originCountry} originRegion={l.originRegion} destinationCountry={l.destinationCountry} destinationRegion={l.destinationRegion} />
                  </td>
                  <td>{equipmentLabel(l.equipmentType)}</td>
                  <td className="mono-num">{money(l.freightAmountBase ?? l.freightAmountTransaction, l.freightCurrency)}</td>
                  <td><Badge tone="purple"><span className="badge-dot" /> Private</Badge></td>
                  <td className="muted">{shortDate(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Partners</h2>
      <div className="card" style={{ opacity: 0.85 }}>
        <div className="detail-list">
          <div className="detail-row">
            <dt>Verified partners you can share with</dt>
            <dd>Invite-only</dd>
          </div>
          <div className="detail-row">
            <dt>Credit-scored broker network</dt>
            <dd>Coming in Pro</dd>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Broker credit scores, onboarding status and one-click “share with partner” are on the
          roadmap. Today, your private loads stay locked to your tenant.
        </p>
      </div>
    </div>
  );
}