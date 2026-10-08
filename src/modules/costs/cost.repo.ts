import type { PrismaClient } from '@prisma/client';
import type { AssignmentWindow, MileageSegment } from './cost.policy';

/**
 * The raw material for a cost per mile, with the declared half kept where this
 * product already keeps tenant settings (`TenantSetting`, the same store SMTP
 * and alert preferences use) rather than in a new table. A truck payment is a
 * number the owner types in once; it does not deserve a migration, and it should
 * survive a redeploy the same way the other settings do.
 */

export const ASSET_COST_SETTING_KEY = 'asset_costs';

export interface DeclaredCost {
  /** Truck payment, insurance and permits, in cents per day the unit is available. */
  centsPerDay: number;
  /** Free text from the owner: what "fixed" means for this unit. */
  note?: string;
}

export type DeclaredCostMap = Record<string, DeclaredCost>;

export interface UnitSummary {
  id: string;
  label: string;
  assetType: string;
}

export interface DetentionTotals {
  minutes: number;
  recovered: number;
}

export interface CostRepo {
  units(tenantId: string): Promise<UnitSummary[]>;
  fuelCost(tenantId: string, assetId: string | null, from: Date, to: Date): Promise<number>;
  segments(tenantId: string, assetId: string, from: Date, to: Date): Promise<MileageSegment[]>;
  assignments(tenantId: string, assetId: string, from: Date, to: Date): Promise<AssignmentWindow[]>;
  detention(tenantId: string, assetId: string | null, from: Date, to: Date): Promise<DetentionTotals>;
  declared(tenantId: string): Promise<DeclaredCostMap>;
  setDeclared(tenantId: string, assetId: string, cost: DeclaredCost | null): Promise<DeclaredCostMap>;
}

interface UnitRow {
  id: string;
  powerUnitNumber: string | null;
  vin: string | null;
  assetType: string;
}

export class PrismaCostRepo implements CostRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async units(tenantId: string): Promise<UnitSummary[]> {
    const rows = (await this.prisma.asset.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, powerUnitNumber: true, vin: true, assetType: true },
    })) as unknown as UnitRow[];
    return rows.map((r) => ({
      id: r.id,
      label: r.powerUnitNumber?.trim() || r.vin?.trim() || `Unnumbered ${r.assetType.toLowerCase()}`,
      assetType: r.assetType,
    }));
  }

  /** Fuel actually bought for the unit, in base currency. Exact, not estimated. */
  async fuelCost(tenantId: string, assetId: string | null, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.fuelTransaction.aggregate({
      _sum: { amountBase: true },
      where: {
        tenantId,
        ...(assetId ? { assetId } : {}),
        occurredAt: { gte: from, lte: to },
      },
    });
    const sum = result._sum.amountBase;
    return sum === null ? 0 : Number(sum);
  }

  async segments(tenantId: string, assetId: string, from: Date, to: Date): Promise<MileageSegment[]> {
    const rows = await this.prisma.routeSegment.findMany({
      where: { tenantId, assetId, startTime: { gte: from, lte: to } },
      select: { startTime: true, distanceKm: true },
    });
    return rows.map((r) => ({ startTime: r.startTime, distanceKm: Number(r.distanceKm) }));
  }

  /**
   * Periods a load was assigned to this unit. A load with no delivery yet stays
   * open — the truck is on it right now.
   */
  async assignments(tenantId: string, assetId: string, from: Date, to: Date): Promise<AssignmentWindow[]> {
    const rows = await this.prisma.load.findMany({
      where: {
        tenantId,
        assigneeAssetId: assetId,
        assignedAt: { not: null, lte: to },
        OR: [{ deliveredAt: null }, { deliveredAt: { gte: from } }],
      },
      select: { assignedAt: true, deliveredAt: true },
    });
    return rows
      .filter((r): r is { assignedAt: Date; deliveredAt: Date | null } => r.assignedAt !== null)
      .map((r) => ({ assignedAt: r.assignedAt, deliveredAt: r.deliveredAt }));
  }

  /**
   * Detention minutes and what they were worth. Revenue, kept out of the cost
   * figure — and the reason a carrier cares that the clock gets started at all.
   */
  async detention(tenantId: string, assetId: string | null, from: Date, to: Date): Promise<DetentionTotals> {
    const rows = await this.prisma.detentionEntry.findMany({
      where: {
        tenantId,
        startedAt: { gte: from, lte: to },
        ...(assetId ? { load: { assigneeAssetId: assetId } } : {}),
      },
      select: { startedAt: true, endedAt: true, ratePerHour: true },
    });
    const now = Date.now();
    let minutes = 0;
    let recovered = 0;
    for (const r of rows) {
      const end = r.endedAt ? r.endedAt.getTime() : now;
      const mins = Math.max(0, (end - r.startedAt.getTime()) / 60000);
      minutes += mins;
      const rate = r.ratePerHour === null ? null : Number(r.ratePerHour);
      if (rate !== null && rate > 0) recovered += (mins / 60) * rate;
    }
    return { minutes, recovered };
  }

  async declared(tenantId: string): Promise<DeclaredCostMap> {
    const row = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key: ASSET_COST_SETTING_KEY } },
      select: { valueJson: true },
    });
    if (!row) return {};
    try {
      const parsed: unknown = JSON.parse(row.valueJson);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as DeclaredCostMap)
        : {};
    } catch {
      // A corrupted settings blob must not take the Fleet page down with it.
      return {};
    }
  }

  async setDeclared(
    tenantId: string,
    assetId: string,
    cost: DeclaredCost | null,
  ): Promise<DeclaredCostMap> {
    const current = await this.declared(tenantId);
    if (cost === null) delete current[assetId];
    else current[assetId] = cost;
    const valueJson = JSON.stringify(current);
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: ASSET_COST_SETTING_KEY } },
      create: { tenantId, key: ASSET_COST_SETTING_KEY, valueJson },
      update: { valueJson },
    });
    return current;
  }
}
