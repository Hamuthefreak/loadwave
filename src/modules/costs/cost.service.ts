import { badRequest, notFound } from '../../utils/errors';
import {
  buildCostPerMile,
  classifyMileage,
  daysBetween,
  fixedCostFor,
  rollUp,
  type CostPerMile,
} from './cost.policy';
import type { CostRepo, DeclaredCost, DeclaredCostMap, UnitSummary } from './cost.repo';

/** A window longer than this is a report, not a cost per mile. */
export const MAX_WINDOW_DAYS = 366;
export const DEFAULT_WINDOW_DAYS = 30;

export interface CostQuery {
  assetId?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface UnitCost {
  unit: UnitSummary;
  cost: CostPerMile;
  declared: DeclaredCost | null;
}

export interface FleetCost {
  window: { from: string; to: string; days: number };
  /** Every bucket summed over every unit — never a mean of per-unit means. */
  fleet: CostPerMile;
  units: UnitCost[];
  declared: DeclaredCostMap;
}

export class PrismaCostService {
  constructor(private readonly repo: CostRepo) {}

  async perMile(tenantId: string, query: CostQuery = {}): Promise<FleetCost> {
    const { from, to } = parseWindow(query.from, query.to);
    const days = daysBetween(from, to);
    const declared = await this.repo.declared(tenantId);
    const allUnits = await this.repo.units(tenantId);

    const wanted = query.assetId ? allUnits.filter((u) => u.id === query.assetId) : allUnits;
    if (query.assetId && wanted.length === 0) {
      throw notFound('that unit is not in this company');
    }

    const units: UnitCost[] = [];
    for (const unit of wanted) {
      const [fuel, segments, assignments, detention] = await Promise.all([
        this.repo.fuelCost(tenantId, unit.id, from, to),
        this.repo.segments(tenantId, unit.id, from, to),
        this.repo.assignments(tenantId, unit.id, from, to),
        this.repo.detention(tenantId, unit.id, from, to),
      ]);
      const mileage = classifyMileage(segments, assignments);
      units.push({
        unit,
        declared: declared[unit.id] ?? null,
        cost: buildCostPerMile({
          fuel,
          fixed: fixedCostFor(declared[unit.id]?.centsPerDay, days),
          loadedKm: mileage.loadedKm,
          emptyKm: mileage.emptyKm,
          detentionRecovered: detention.recovered,
          detentionMinutes: detention.minutes,
        }),
      });
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString(), days },
      fleet: rollUp(units.map((u) => u.cost)),
      units,
      declared,
    };
  }

  /** Record what a unit costs to own, per day. `null` clears it. */
  async setDeclaredCost(
    tenantId: string,
    assetId: string,
    input: { centsPerDay?: number | null; note?: string | null },
  ): Promise<DeclaredCostMap> {
    if (!assetId) throw badRequest('assetId is required');
    const cents = input.centsPerDay ?? null;
    if (cents !== null) {
      if (!Number.isInteger(cents) || cents < 0 || cents > 10_000_000) {
        throw badRequest('centsPerDay must be a whole number of cents between 0 and 10,000,000');
      }
    }
    const note = input.note?.trim();
    const cost: DeclaredCost | null =
      cents === null || cents === 0
        ? null
        : { centsPerDay: cents, ...(note ? { note } : {}) };
    return this.repo.setDeclared(tenantId, assetId, cost);
  }
}

function parseWindow(fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date } {
  const to = toRaw ? new Date(toRaw) : new Date();
  if (Number.isNaN(to.getTime())) throw badRequest('`to` is not a date');
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  if (Number.isNaN(from.getTime())) throw badRequest('`from` is not a date');
  if (from.getTime() > to.getTime()) throw badRequest('`from` must be before `to`');
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > MAX_WINDOW_DAYS) {
    const capped = new Date(to.getTime() - MAX_WINDOW_DAYS * 86_400_000);
    return { from: capped, to };
  }
  return { from, to };
}
