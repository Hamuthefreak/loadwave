import type { PrismaClient } from '@prisma/client';

export interface LaneCondition {
  originRegion: string;
  destinationRegion: string;
  loads: number;
  trucks: number;
  ratio: number;
  avgRate: number | null;
  trend: number; // % change vs previous day (null-tolerant → 0)
}

export interface MarketConditions {
  national: { loads: number; trucks: number; ratio: number; avgRate: number | null };
  lanes: LaneCondition[];
  freshness: string;
}

export interface MarketService {
  conditions(opts?: { originRegion?: string; equipmentType?: string }): Promise<MarketConditions>;
  /** Backfill today's lane snapshot from live board + trucks. Call on boot + daily. */
  snapshot(): Promise<number>;
  /** Trend series for the last `days` days across lanes (for sparklines). */
  laneHistory(days?: number): Promise<Array<{ statDate: string; originRegion: string; destinationRegion: string; loadsSeen: number; trucksSeen: number; avgRate: number | null }>>;
}

export class PrismaMarketService implements MarketService {
  constructor(private readonly prisma: PrismaClient) {}

  async conditions(opts?: { originRegion?: string; equipmentType?: string }): Promise<MarketConditions> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [loadsRaw, trucksRaw] = await Promise.all([
      this.prisma.load.findMany({
        where: {
          marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] },
          ...(opts?.originRegion ? { originRegion: opts.originRegion.toUpperCase() } : {}),
          ...(opts?.equipmentType ? { equipmentType: opts.equipmentType.toUpperCase() } : {}),
          createdAt: { gte: since },
        },
        select: { originRegion: true, destinationRegion: true, freightAmountBase: true, freightAmountTransaction: true },
      }),
      this.prisma.truckPost.findMany({
        where: {
          status: 'ACTIVE',
          ...(opts?.originRegion ? { locationRegion: opts.originRegion.toUpperCase() } : {}),
          ...(opts?.equipmentType ? { equipmentType: opts.equipmentType.toUpperCase() } : {}),
        },
        select: { locationRegion: true, rateAmount: true },
      }),
    ]);

    const avgRate = (n: number[]) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : null);
    const loadRates = loadsRaw.map((l) => Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0)).filter((n) => n > 0);
    const truckRates = trucksRaw.map((t) => Number(t.rateAmount ?? 0)).filter((n) => n > 0);

    const laneMap = new Map<string, { originRegion: string; destinationRegion: string; loads: number; trucks: number; rates: number[] }>();
    for (const l of loadsRaw) {
      const key = `${l.originRegion}|${l.destinationRegion}`;
      const cur = laneMap.get(key) ?? { originRegion: l.originRegion, destinationRegion: l.destinationRegion, loads: 0, trucks: 0, rates: [] };
      cur.loads += 1;
      const r = Number(l.freightAmountBase ?? l.freightAmountTransaction ?? 0);
      if (r > 0) cur.rates.push(r);
      laneMap.set(key, cur);
    }
    // Trucks map to their lane as "loads seek trucks here" — count per origin region.
    for (const t of trucksRaw) {
      const row = [...laneMap.values()].find((l) => l.originRegion === t.locationRegion);
      if (row) row.trucks += 1;
      else {
        const key = `TRK|${t.locationRegion}`;
        const cur = laneMap.get(key) ?? { originRegion: t.locationRegion, destinationRegion: '—', loads: 0, trucks: 0, rates: [] };
        cur.trucks += 1;
        laneMap.set(key, cur);
      }
    }

    const lanes: LaneCondition[] = [...laneMap.values()]
      .filter((l) => l.originRegion !== 'TRK')
      .map((l) => ({
        originRegion: l.originRegion,
        destinationRegion: l.destinationRegion,
        loads: l.loads,
        trucks: l.trucks,
        ratio: l.trucks > 0 ? Number((l.loads / l.trucks).toFixed(2)) : l.loads,
        avgRate: avgRate(l.rates),
        trend: 0,
      }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 12);

    // Trend: compare today's snapshot vs previous day via LaneDailyStat.
    const history = await this.laneHistory(2);
    const prevByLane = new Map<string, number>();
    for (const s of history) {
      prevByLane.set(`${s.originRegion}|${s.destinationRegion}`, s.loadsSeen);
    }
    for (const lane of lanes) {
      const prev = prevByLane.get(`${lane.originRegion}|${lane.destinationRegion}`);
      if (prev != null && prev > 0) {
        lane.trend = Number((((lane.loads - prev) / prev) * 100).toFixed(0));
      }
    }

    return {
      national: {
        loads: loadsRaw.length,
        trucks: trucksRaw.length,
        ratio: trucksRaw.length > 0 ? Number((loadsRaw.length / trucksRaw.length).toFixed(2)) : loadsRaw.length,
        avgRate: avgRate(loadRates) ?? avgRate(truckRates),
      },
      lanes,
      freshness: new Date().toISOString(),
    };
  }

  async snapshot(): Promise<number> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const conditions = await this.conditions();
    const rows = conditions.lanes.map((l) => ({
      statDate: today,
      originRegion: l.originRegion,
      destinationRegion: l.destinationRegion,
      equipmentType: 'ALL',
      loadsSeen: l.loads,
      trucksSeen: l.trucks,
      avgRate: l.avgRate,
    }));
    let created = 0;
    for (const row of rows) {
      await this.prisma.laneDailyStat.upsert({
        where: {
          statDate_originRegion_destinationRegion_equipmentType: {
            statDate: row.statDate,
            originRegion: row.originRegion,
            destinationRegion: row.destinationRegion,
            equipmentType: row.equipmentType,
          },
        },
        update: { loadsSeen: row.loadsSeen, trucksSeen: row.trucksSeen, avgRate: row.avgRate },
        create: row,
      });
      created += 1;
    }
    return created;
  }

  async laneHistory(days = 30): Promise<Array<{ statDate: string; originRegion: string; destinationRegion: string; loadsSeen: number; trucksSeen: number; avgRate: number | null }>> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);
    const rows = await this.prisma.laneDailyStat.findMany({
      where: { statDate: { gte: since } },
      orderBy: [{ statDate: 'asc' }, { originRegion: 'asc' }],
      take: 2000,
    });
    return rows.map((r) => ({
      statDate: r.statDate.toISOString().slice(0, 10),
      originRegion: r.originRegion,
      destinationRegion: r.destinationRegion,
      loadsSeen: r.loadsSeen,
      trucksSeen: r.trucksSeen,
      avgRate: r.avgRate != null ? Number(r.avgRate) : null,
    }));
  }
}