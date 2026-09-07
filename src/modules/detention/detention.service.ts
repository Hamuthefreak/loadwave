import type { PrismaClient } from '@prisma/client';
import { badRequest, conflict, notFound, forbidden } from '../../utils/errors';
import type { JwtUser } from '../auth/auth.types';

export interface DetentionView {
  id: string;
  loadId: string;
  driverId: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Billed minutes — live-computed for the open entry. */
  minutes: number;
  ratePerHour: number | null;
  amount: number | null;
}

export interface LoadDetentionSummary {
  open: { id: string; startedAt: string; secondsElapsed: number } | null;
  totalMinutes: number;
  amount: number | null;
  entries: DetentionView[];
}

/** Billed minutes between start and end (open entries count until `now`). */
export function detentionMinutes(startedAt: Date, endedAt: Date | null, now: Date = new Date()): number {
  const end = (endedAt ?? now).getTime();
  return Math.max(0, Math.round((end - startedAt.getTime()) / 60_000));
}

/** Waiting-time charge: minutes × hourly rate, rounded to the cent. */
export function detentionAmount(minutes: number, ratePerHour: number | null): number | null {
  if (ratePerHour == null) return null;
  return Math.round(((minutes / 60) * ratePerHour) * 100) / 100;
}

export class PrismaDetentionService {
  constructor(private readonly prisma: PrismaClient) {}

  private isOps(user: JwtUser): boolean {
    return user.roles.some((r) => r === 'ADMIN' || r === 'DISPATCHER');
  }

  private view(
    entry: { id: string; loadId: string; driverId: string | null; startedAt: Date; endedAt: Date | null; ratePerHour: unknown },
    now: Date,
  ): DetentionView {
    const minutes = detentionMinutes(entry.startedAt, entry.endedAt, now);
    const rate = entry.ratePerHour == null ? null : Number(entry.ratePerHour);
    return {
      id: entry.id,
      loadId: entry.loadId,
      driverId: entry.driverId,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
      minutes,
      ratePerHour: rate,
      amount: detentionAmount(minutes, rate),
    };
  }

  async start(user: JwtUser, loadId: string): Promise<DetentionView> {
    if (!loadId) throw badRequest('loadId is required');
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, tenantId: true, assigneeDriverId: true, detentionRate: true },
    });
    if (!load || load.tenantId !== user.tenantId) throw notFound('load not found');
    if (!this.isOps(user) && load.assigneeDriverId !== user.driverId) {
      throw forbidden('this load is not assigned to you');
    }
    const open = await this.prisma.detentionEntry.findFirst({
      where: { loadId, endedAt: null },
      select: { id: true },
    });
    if (open) throw conflict('detention is already running for this load');

    const entry = await this.prisma.detentionEntry.create({
      data: {
        tenantId: user.tenantId,
        loadId,
        driverId: user.driverId,
        startedAt: new Date(),
        ratePerHour: load.detentionRate,
      },
    });
    return this.view(entry, new Date());
  }

  async stop(user: JwtUser, entryId: string): Promise<DetentionView> {
    const entry = await this.prisma.detentionEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.tenantId !== user.tenantId) throw notFound('detention entry not found');
    if (entry.endedAt) throw conflict('detention already stopped');
    if (!this.isOps(user) && entry.driverId !== user.driverId) {
      throw forbidden('this detention clock belongs to another driver');
    }
    const updated = await this.prisma.detentionEntry.update({
      where: { id: entryId },
      data: { endedAt: new Date() },
    });
    return this.view(updated, new Date());
  }

  async forLoad(user: JwtUser, loadId: string): Promise<LoadDetentionSummary> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { tenantId: true, assigneeDriverId: true },
    });
    if (!load || load.tenantId !== user.tenantId) throw notFound('load not found');
    if (!this.isOps(user) && load.assigneeDriverId !== user.driverId) {
      throw forbidden('this load is not assigned to you');
    }
    const entries = await this.prisma.detentionEntry.findMany({
      where: { loadId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    const now = new Date();
    const views = entries.map((e) => this.view(e, now));
    const openView = views.find((v) => !v.endedAt);
    return {
      open: openView
        ? {
            id: openView.id,
            startedAt: openView.startedAt,
            secondsElapsed: Math.round((now.getTime() - new Date(openView.startedAt).getTime()) / 1000),
          }
        : null,
      totalMinutes: views.reduce((sum, v) => sum + v.minutes, 0),
      amount: views.reduce((sum, v) => sum + (v.amount ?? 0), 0) || null,
      entries: views,
    };
  }

  /** Live per-load snapshot for trip cards: running clock + closed total. */
  async liveForLoads(loadIds: string[]): Promise<Map<string, { openEntryId: string | null; openSeconds: number; totalMinutes: number }>> {
    if (loadIds.length === 0) return new Map();
    const entries = await this.prisma.detentionEntry.findMany({
      where: { loadId: { in: loadIds } },
      select: { loadId: true, id: true, startedAt: true, endedAt: true },
    });
    const now = Date.now();
    const out = new Map<string, { openEntryId: string | null; openSeconds: number; totalMinutes: number }>();
    for (const e of entries) {
      const cur = out.get(e.loadId) ?? { openEntryId: null, openSeconds: 0, totalMinutes: 0 };
      const mins = detentionMinutes(e.startedAt, e.endedAt, new Date(now));
      cur.totalMinutes += mins;
      if (!e.endedAt) {
        cur.openEntryId = e.id;
        cur.openSeconds = Math.max(0, Math.round((now - e.startedAt.getTime()) / 1000));
      }
      out.set(e.loadId, cur);
    }
    return out;
  }

  /** Total billed detention per load — feeds the invoice line. */
  async totalsForLoads(loadIds: string[]): Promise<Map<string, { minutes: number; amount: number }>> {
    if (loadIds.length === 0) return new Map();
    const entries = await this.prisma.detentionEntry.findMany({
      where: { loadId: { in: loadIds } },
      select: { loadId: true, startedAt: true, endedAt: true, ratePerHour: true },
    });
    const now = new Date();
    const totals = new Map<string, { minutes: number; amount: number }>();
    for (const e of entries) {
      const minutes = detentionMinutes(e.startedAt, e.endedAt, now);
      if (minutes <= 0) continue;
      const cur = totals.get(e.loadId) ?? { minutes: 0, amount: 0 };
      cur.minutes += minutes;
      cur.amount += detentionAmount(minutes, e.ratePerHour == null ? null : Number(e.ratePerHour)) ?? 0;
      totals.set(e.loadId, cur);
    }
    return totals;
  }
}
