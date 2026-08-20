import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import type { BoardFilters } from '../board/board.policy';

export interface SavedSearchRow {
  id: string;
  tenantId: string;
  name: string;
  filters: BoardFilters;
  notify: boolean;
  lastCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  matchCount: number;
}

export interface SavedSearchService {
  create(tenantId: string, input: { name?: string; filters: BoardFilters; notify?: boolean }): Promise<SavedSearchRow>;
  list(tenantId: string): Promise<SavedSearchRow[]>;
  get(tenantId: string, id: string): Promise<SavedSearchRow>;
  update(tenantId: string, id: string, patch: { name?: string; filters?: BoardFilters; notify?: boolean }): Promise<SavedSearchRow>;
  remove(tenantId: string, id: string): Promise<void>;
  /** Re-runs the saved filter and counts rows newer than lastCheckAt. */
  match(tenantId: string, id: string): Promise<{ matches: number; checkedAt: string }>;
}

interface Row {
  id: string;
  tenantId: string;
  name: string;
  filtersJson: string;
  notify: boolean;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  matchCount: number;
}

export class PrismaSavedSearchService implements SavedSearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly boardList: (tenantId: string, filters: BoardFilters) => Promise<Array<{ id: string; createdAt: string }>>,
  ) {}

  private map(row: Row): SavedSearchRow {
    let filters: BoardFilters = {};
    try {
      filters = JSON.parse(row.filtersJson) as BoardFilters;
    } catch {
      filters = {};
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      filters,
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
    name: true,
    filtersJson: true,
    notify: true,
    lastCheckAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async create(tenantId: string, input: { name?: string; filters: BoardFilters; notify?: boolean }): Promise<SavedSearchRow> {
    const row = await this.prisma.savedSearch.create({
      data: {
        tenantId,
        name: input.name?.trim() || 'Saved search',
        filtersJson: JSON.stringify(input.filters ?? {}),
        notify: input.notify ?? false,
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

  private async countMatches(tenantId: string, filtersJson: string, since: Date | null): Promise<number> {
    let filters: BoardFilters = {};
    try {
      filters = JSON.parse(filtersJson) as BoardFilters;
    } catch {
      return 0;
    }
    const rows = await this.boardList(tenantId, filters);
    return rows.filter((r) => !since || new Date(r.createdAt) > since).length;
  }
}