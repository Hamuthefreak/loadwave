import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import type { BoardFilters } from '../board/board.policy';
import type { NotificationService } from '../notification/notification.service';

export interface SavedSearchRow {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  filters: BoardFilters;
  notify: boolean;
  lastCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  matchCount: number;
}

export interface SavedSearchService {
  create(tenantId: string, input: { name?: string; filters: BoardFilters; notify?: boolean; userId?: string | null }): Promise<SavedSearchRow>;
  list(tenantId: string): Promise<SavedSearchRow[]>;
  get(tenantId: string, id: string): Promise<SavedSearchRow>;
  update(tenantId: string, id: string, patch: { name?: string; filters?: BoardFilters; notify?: boolean }): Promise<SavedSearchRow>;
  remove(tenantId: string, id: string): Promise<void>;
  /** Re-runs the saved filter and counts rows newer than lastCheckAt. */
  match(tenantId: string, id: string): Promise<{ matches: number; checkedAt: string }>;
  /** Sweeps every notify-enabled search and fires load_match notifications. */
  runAlerts(notifications: NotificationService, asOf?: Date): Promise<{ checked: number; alerted: number }>;
}

interface Row {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  filtersJson: string;
  notify: boolean;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  matchCount: number;
}

function parseFilters(json: string): BoardFilters {
  try {
    return JSON.parse(json) as BoardFilters;
  } catch {
    return {};
  }
}

function laneLabel(filters: BoardFilters): string | null {
  if (!filters.originRegion && !filters.destinationRegion) return null;
  return `${filters.originRegion ?? 'Any'} → ${filters.destinationRegion ?? 'Any'}`;
}

export class PrismaSavedSearchService implements SavedSearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly boardList: (tenantId: string, filters: BoardFilters) => Promise<Array<{ id: string; createdAt: string }>>,
  ) {}

  private map(row: Row): SavedSearchRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      name: row.name,
      filters: parseFilters(row.filtersJson),
      notify: row.notify,
      lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      matchCount: row.matchCount,
    };
  }

  private select = {
    id: true,
    tenantId: true,
    userId: true,
    name: true,
    filtersJson: true,
    notify: true,
    lastCheckAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async create(tenantId: string, input: { name?: string; filters: BoardFilters; notify?: boolean; userId?: string | null }): Promise<SavedSearchRow> {
    const row = await this.prisma.savedSearch.create({
      data: {
        tenantId,
        userId: input.userId ?? null,
        name: input.name?.trim() || 'Saved search',
        filtersJson: JSON.stringify(input.filters ?? {}),
        notify: input.notify ?? false,
        // Seed the checkpoint so first-run alerts only cover posts after saving.
        lastCheckAt: new Date(),
      },
      select: this.select,
    });
    return this.map({ ...row, matchCount: 0 } as unknown as Row);
  }

  async list(tenantId: string): Promise<SavedSearchRow[]> {
    const rows = await this.prisma.savedSearch.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: this.select,
    });
    return Promise.all(
      rows.map(async (r) => {
        const matchCount = await this.countMatches(tenantId, r.filtersJson, null);
        return this.map({ ...r, matchCount } as unknown as Row);
      }),
    );
  }

  async get(tenantId: string, id: string): Promise<SavedSearchRow> {
    const row = await this.prisma.savedSearch.findFirst({ where: { id, tenantId } });
    if (!row) throw notFound('saved search not found');
    const matchCount = await this.countMatches(tenantId, row.filtersJson, null);
    return this.map({ ...row, matchCount } as unknown as Row);
  }

  async update(tenantId: string, id: string, patch: { name?: string; filters?: BoardFilters; notify?: boolean }): Promise<SavedSearchRow> {
    const existing = await this.prisma.savedSearch.findFirst({ where: { id, tenantId } });
    if (!existing) throw notFound('saved search not found');
    const row = await this.prisma.savedSearch.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.filters !== undefined ? { filtersJson: JSON.stringify(patch.filters) } : {}),
        ...(patch.notify !== undefined ? { notify: patch.notify } : {}),
      },
      select: this.select,
    });
    const matchCount = await this.countMatches(tenantId, row.filtersJson, null);
    return this.map({ ...row, matchCount } as unknown as Row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.savedSearch.findFirst({ where: { id, tenantId } });
    if (!existing) throw notFound('saved search not found');
    await this.prisma.savedSearch.delete({ where: { id } });
  }

  async match(tenantId: string, id: string): Promise<{ matches: number; checkedAt: string }> {
    const row = await this.prisma.savedSearch.findFirst({ where: { id, tenantId } });
    if (!row) throw notFound('saved search not found');
    const since = row.lastCheckAt;
    const matches = await this.countMatches(tenantId, row.filtersJson, since);
    const checkedAt = new Date();
    await this.prisma.savedSearch.update({
      where: { id },
      data: { lastCheckAt: checkedAt },
    });
    return { matches, checkedAt: checkedAt.toISOString() };
  }

  async runAlerts(notifications: NotificationService, asOf: Date = new Date()): Promise<{ checked: number; alerted: number }> {
    const searches = await this.prisma.savedSearch.findMany({
      where: { notify: true },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        name: true,
        filtersJson: true,
        lastCheckAt: true,
        createdAt: true,
      },
    });

    let checked = 0;
    let alerted = 0;
    for (const s of searches) {
      checked += 1;
      const since = s.lastCheckAt ?? s.createdAt;
      const count = await this.countMatches(s.tenantId, s.filtersJson, since);
      await this.prisma.savedSearch.updateMany({
        where: { id: s.id },
        data: { lastCheckAt: asOf },
      });
      if (count <= 0) continue;

      let emailTo: string | null = null;
      if (s.userId) {
        const user = await this.prisma.user.findUnique({ where: { id: s.userId } });
        emailTo = user?.email ?? null;
      }

      const filters = parseFilters(s.filtersJson);
      const lane = laneLabel(filters);
      const noun = count === 1 ? 'load' : 'loads';
      await notifications.notify({
        tenantId: s.tenantId,
        userId: s.userId,
        kind: 'load_match',
        title: lane ? `${count} new ${noun} match ${lane}` : `${count} new ${noun} match your saved search`,
        body: `“${s.name}” — new loads are on the board.`,
        link: '/app/board',
        emailTo,
        payload: { searchId: s.id },
      });
      alerted += 1;
    }
    return { checked, alerted };
  }

  private async countMatches(tenantId: string, filtersJson: string, since: Date | null): Promise<number> {
    const rows = await this.boardList(tenantId, parseFilters(filtersJson));
    return rows.filter((r) => !since || new Date(r.createdAt) > since).length;
  }
}