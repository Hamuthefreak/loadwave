import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Badge, PageHeader, Spinner } from '../../components/ui';
import { km, money, moneyShort, regionLabel, timeAgo } from '../../utils/format';
import { equipmentLabel } from './regions';
import type { BoardLoad, TruckRow } from './boardTypes';

export default function Tools() {
  const [loads, setLoads] = useState<BoardLoad[]>([]);
  const [trucks, setTrucks] = useState<TruckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, t] = await Promise.all([
        api<BoardLoad[]>('/api/board/loads'),
        api<TruckRow[]>('/api/trucks'),
      ]);
      setLoads(l);
      setTrucks(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load market data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lanes = useMemo(() => {
    const map = new Map<string, { from: string; to: string; loads: number; total: number; count: number }>();
    for (const l of loads) {
      const key = `${l.originRegion}-${l.destinationRegion}`;
      const cur = map.get(key) ?? { from: l.originRegion, to: l.destinationRegion, loads: 0, total: 0, count: 0 };
      cur.loads += 1;
      const r = Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0);
      if (r > 0) { cur.total += r; cur.count += 1; }
      map.set(key, cur);
    }
    return [...map.values()]
      .map((l) => ({ ...l, avg: l.count ? l.total / l.count : 0 }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 8);
  }, [loads]);

  const maxLoads = Math.max(...lanes.map((l) => l.loads), 1);

  const equipmentMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of loads) {
      const k = equipmentLabel(l.equipmentType);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    for (const t of trucks) {
      const k = equipmentLabel(t.equipmentType);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [loads, trucks]);

  return (
    <div>
      <PageHeader
        title="Tools & market"
        sub="Rate benchmarks, market conditions and trip intelligence from your live marketplace."
      />

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <Spinner label="Loading market data…" />
      ) : (
        <>
          <div className="grid">
            <div className="card">
              <span className="stat-label">Live loads in market</span>
              <div className="stat-value">{loads.filter((l) => l.marketplaceStatus === 'PUBLIC').length}</div>
              <span className="stat-sub">{loads.length} total listings · {trucks.length} units available</span>
            </div>
            <div className="card">
              <span className="stat-label">Avg rate / load</span>
              <div className="stat-value" style={{ color: 'var(--green)' }}>
                {moneyShort(avgRate(loads))}
              </div>
              <span className="stat-sub">Across all visible lanes</span>
            </div>
            <div className="card">
              <span className="stat-label">Longest lane</span>
              <div className="stat-value">{km(maxDistance(loads))}</div>
              <span className="stat-sub">Current posting</span>
            </div>
            <div className="card">
              <span className="stat-label">Market freshness</span>
              <div className="stat-value"><span className="live-dot" aria-hidden /></div>
              <span className="stat-sub">Listings refresh every 30s</span>
            </div>
          </div>

          <h2>Top lanes right now</h2>
          <div className="card">
            {lanes.length === 0 ? (
              <p className="muted">No lane data yet — loads appear as partners post them.</p>
            ) : (
              <div className="lane-bars">
                {lanes.map((l) => (
                  <div key={l.from + l.to} className="lane-bar">
                    <div className="lane-bar-label">
                      <strong>{regionLabel(l.from)} → {regionLabel(l.to)}</strong>
                      <span className="muted small">{l.loads} loads · avg {money(l.avg)}</span>
                    </div>
                    <div className="lane-bar-track">
                      <div className="lane-bar-fill" style={{ width: `${(l.loads / maxLoads) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h2>Equipment mix</h2>
          <div className="card">
            {equipmentMix.length === 0 ? (
              <p className="muted">No equipment data yet.</p>
            ) : (
              <div className="mix-chips">
                {equipmentMix.map(([label, count]) => (
                  <span className="chip" key={label}>
                    {label} · <b>{count}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          <h2>Recent listings</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Lane / location</th>
                  <th>Rate</th>
                  <th>Carrier</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {loads.slice(0, 8).map((l) => (
                  <tr key={l.id}>
                    <td><Badge tone="blue">Load</Badge></td>
                    <td>{regionLabel(l.originRegion)} → {regionLabel(l.destinationRegion)}</td>
                    <td className="mono-num">{money(l.freightAmountBase ?? l.freightAmountTransaction, l.freightCurrency)}</td>
                    <td>{l.postedByTenantName}</td>
                    <td className="muted">{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
                {trucks.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td><Badge tone="cyan">Truck</Badge></td>
                    <td>{equipmentLabel(t.equipmentType)} · {regionLabel(t.locationRegion)}</td>
                    <td className="mono-num">{money(t.rateAmount, t.rateCurrency)}</td>
                    <td>{t.postedByTenantName}</td>
                    <td className="muted">{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
                {loads.length === 0 && trucks.length === 0 && (
                  <tr><td colSpan={5} className="muted">No listings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2>Gated insights</h2>
          <div className="grid">
            <div className="card gated">
              <div className="detail-row"><dt>Rate insights & trend maps</dt><dd><Badge tone="gray">Pro</Badge></dd></div>
              <p className="muted small">Historical lane rates, seasonal trends and projected rates.</p>
            </div>
            <div className="card gated">
              <div className="detail-row"><dt>Broker credit & directory</dt><dd><Badge tone="gray">Pro</Badge></dd></div>
              <p className="muted small">Company lookup, credit scores and onboarding status.</p>
            </div>
            <div className="card gated">
              <div className="detail-row"><dt>Tri-haul & backhaul routing</dt><dd><Badge tone="gray">Fleet</Badge></dd></div>
              <p className="muted small">Plan triangles so you never run empty.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function avgRate(loads: BoardLoad[]): number {
  const rates = loads.map((l) => Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0)).filter((n) => n > 0);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
}

function maxDistance(loads: BoardLoad[]): number {
  return Math.max(...loads.map((l) => Number(l.distanceKmEstimate ?? 0)), 0);
}