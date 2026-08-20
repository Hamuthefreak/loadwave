import { d, toDb, type Decimal } from '../../utils/decimal';
import { quarterRange, type Quarter } from '../../utils/quarters';
import { EVENTS, IftaQuarterComputed } from '../../events/domain-events';
import type { EventBus } from '../../events/event-bus';
import { computeQuarterSummaries } from './ifta.policy';
import type { IftaRepo, IftaSummaryView } from './ifta.repo';

export type IftaComputeReason = 'MANUAL' | 'ROUTE_BATCH' | 'FUEL_IMPORT';

export interface IftaComputeRequest {
  tenantId: string;
  assetId: string | null;
  driverId: string | null;
  quarter: Quarter;
  reason: IftaComputeReason;
}

export interface IftaComputedResult {
  tenantId: string;
  quarter: Quarter;
  assetId: string | null;
  summaryCount: number;
  totalKm: string;
  netTaxDueBase: string;
}

type RateProvider =
  | Record<string, string | number | Decimal>
  | ((tenantId: string) => Record<string, string | number | Decimal>);

export class IftaService {
  constructor(
    private readonly repo: IftaRepo,
    private readonly bus: EventBus,
    private readonly rates: RateProvider,
  ) {}

  private ratesFor(tenantId: string): Record<string, string | number | Decimal> {
    if (typeof this.rates === 'function') return this.rates(tenantId);
    return this.rates;
  }

  async compute(input: IftaComputeRequest): Promise<IftaComputedResult | null> {
    const { start, end } = quarterRange(input.quarter);
    const period = { tenantId: input.tenantId, assetId: input.assetId, start, end };

    const [hasRoutePoints, hasFuel] = await Promise.all([
      this.repo.hasRoutePoints(period),
      this.repo.hasFuel(period),
    ]);
    if (!hasRoutePoints && !hasFuel) return null;

    await this.repo.ensureSegments(period);

    const totals = await this.repo.getTotals(period);
    if (totals.length === 0) return null;

    const rows = computeQuarterSummaries(totals, this.ratesFor(input.tenantId), {
      tenantId: input.tenantId,
      quarter: input.quarter,
      assetId: input.assetId,
      fuelType: 'DSL',
    });

    await this.repo.persistSummaries(rows);

    const totalKm = rows.reduce<Decimal>((acc, r) => acc.plus(r.totalKm), d(0));
    const netTaxDueBase = rows.reduce<Decimal>((acc, r) => acc.plus(r.netTaxDueBase), d(0));

    const result: IftaComputedResult = {
      tenantId: input.tenantId,
      quarter: input.quarter,
      assetId: input.assetId,
      summaryCount: rows.length,
      totalKm: toDb(totalKm),
      netTaxDueBase: toDb(netTaxDueBase),
    };

    await this.bus.publish(EVENTS.IFTA_QUARTER_COMPUTED, new IftaQuarterComputed(result).payload);

    return result;
  }

  async requestCompute(input: IftaComputeRequest): Promise<IftaComputedResult[]> {
    const { start, end } = quarterRange(input.quarter);
    const period = { tenantId: input.tenantId, assetId: input.assetId, start, end };

    const [hasRoutePoints, hasFuel] = await Promise.all([
      this.repo.hasRoutePoints(period),
      this.repo.hasFuel(period),
    ]);
    if (!hasRoutePoints && !hasFuel) return [];

    const results: IftaComputedResult[] = [];
    if (input.assetId) {
      const assetResult = await this.compute({
        ...input,
        assetId: input.assetId,
      });
      if (assetResult) results.push(assetResult);
    }
    const fleetResult = await this.compute({
      tenantId: input.tenantId,
      assetId: null,
      driverId: null,
      quarter: input.quarter,
      reason: input.reason,
    });
    if (fleetResult) results.push(fleetResult);
    return results;
  }

  async getSummaries(tenantId: string, quarter?: Quarter, assetId?: string): Promise<IftaSummaryView[]> {
    return this.repo.listSummaries(tenantId, {
      quarter: quarter as string | undefined,
      assetId,
      status: undefined,
    });
  }
}
