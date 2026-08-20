import { EventBus } from '../../src/events/event-bus';
import { EVENTS, type IftaQuarterComputedPayload } from '../../src/events/domain-events';
import { IftaService } from '../../src/modules/ifta/ifta.service';
import type { IftaRepo, IftaPeriod, IftaSummaryView } from '../../src/modules/ifta/ifta.repo';
import type { JurisdictionTotals, IftaSummaryRow } from '../../src/modules/ifta/ifta.policy';
import { d } from '../../src/utils/decimal';

class FakeIftaRepo implements IftaRepo {
  totals: JurisdictionTotals[] = [
    { jurisdictionCode: 'QC', totalKm: d(2000), taxableKm: d(2000), litresPurchased: d(600) },
    { jurisdictionCode: 'ON', totalKm: d(1000), taxableKm: d(1000), litresPurchased: d(200) },
  ];
  hasPoints = true;
  hasFuelTx = true;
  persisted: IftaSummaryRow[] = [];
  summaries: IftaSummaryView[] = [];

  async getTotals(): Promise<JurisdictionTotals[]> {
    return this.totals;
  }
  async hasRoutePoints(): Promise<boolean> {
    return this.hasPoints;
  }
  async hasFuel(): Promise<boolean> {
    return this.hasFuelTx;
  }
  async hasSegmentsInPeriod(): Promise<boolean> {
    return true;
  }
  async ensureSegments(_input: IftaPeriod): Promise<void> {
    return undefined;
  }
  async persistSummaries(rows: IftaSummaryRow[]): Promise<number> {
    this.persisted = this.persisted.concat(rows);
    return rows.length;
  }
  async listSummaries(): Promise<IftaSummaryView[]> {
    return this.summaries;
  }
}

describe('IFTA engine (event driven)', () => {
  it('listens to a compute request and produces asset + fleet summaries', async () => {
    const repo = new FakeIftaRepo();
    const bus = new EventBus();
    const computed: Array<{ quarter: string; assetId: string | null }> = [];
    bus.subscribe<IftaQuarterComputedPayload>(EVENTS.IFTA_QUARTER_COMPUTED, async (payload) => {
      computed.push({ quarter: payload.quarter, assetId: payload.assetId });
    });

    const svc = new IftaService(repo, bus, { QC: '0.197', ON: '0.143' });
    const results = await svc.requestCompute({
      tenantId: 't1',
      assetId: 'asset-1',
      driverId: 'd1',
      quarter: '2026-Q1',
      reason: 'MANUAL',
    });

    expect(results).toHaveLength(2);
    const assetResult = results.find((r) => r.assetId === 'asset-1');
    expect(assetResult?.summaryCount).toBe(2);
    expect(assetResult?.totalKm).toBe('3000');

    // Fleet average = (600+200)/(2000+1000) = 0.266666...; QC litresConsumed = 2000*avg.
    const qc = repo.persisted.find((r) => r.jurisdictionCode === 'QC' && r.assetId === 'asset-1');
    expect(qc).toBeDefined();
    expect(Number(qc!.litresConsumed)).toBeCloseTo(533.333, 3);
    expect(qc!.averageConsumption.toString()).toMatch(/^0\.26666/);

    // Two IftaQuarterComputed events: one per compute (asset + fleet).
    expect(computed).toHaveLength(2);
    expect(computed.map((c) => c.assetId)).toEqual(['asset-1', null]);
  });

  it('skips the run when no route points or fuel exist in the quarter', async () => {
    const repo = new FakeIftaRepo();
    repo.hasPoints = false;
    repo.hasFuelTx = false;
    const bus = new EventBus();
    const svc = new IftaService(repo, bus, { QC: '0.197' });
    const results = await svc.requestCompute({
      tenantId: 't1',
      assetId: 'asset-1',
      driverId: null,
      quarter: '2026-Q1',
      reason: 'FUEL_IMPORT',
    });
    expect(results).toHaveLength(0);
    expect(repo.persisted).toHaveLength(0);
  });

  it('computes the fleet rollup when no asset is specified', async () => {
    const repo = new FakeIftaRepo();
    const bus = new EventBus();
    const svc = new IftaService(repo, bus, { QC: '0.197', ON: '0.143' });
    const results = await svc.requestCompute({
      tenantId: 't1',
      assetId: null,
      driverId: null,
      quarter: '2026-Q1',
      reason: 'MANUAL',
    });
    expect(results).toHaveLength(1);
    expect(results[0].assetId).toBeNull();
    expect(repo.persisted.every((r) => r.assetId === null)).toBe(true);
  });
});
