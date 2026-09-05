import type { Prisma, PrismaClient } from '@prisma/client';

export interface NotificationRow {
  id: string;
  tenantId: string;
  userId: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface NotifyInput {
  tenantId: string;
  // null = tenant-wide feed (every member sees it)
  userId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  email?: boolean; // sends email when SMTP is configured
  // Direct recipient address; defaults to the tenant's configured address.
  emailTo?: string | null;
  payload?: unknown;
}

export interface NotificationService {
  notify(input: NotifyInput): Promise<NotificationRow>;
  list(
    tenantId: string,
    opts?: { userId?: string | null; unreadOnly?: boolean; limit?: number },
  ): Promise<NotificationRow[]>;
  unreadCount(tenantId: string, userId?: string | null): Promise<number>;
  markAllRead(tenantId: string, userId?: string | null): Promise<number>;
  markRead(tenantId: string, id: string, userId?: string | null): Promise<NotificationRow | null>;
}

export interface NotificationEmailBridge {
  send(tenantId: string, to: string, subject: string, text: string): Promise<void>;
}

// Visibility filter: with a userId a user sees tenant-wide rows plus their own;
// without one (server-side calls) only the tenant-wide feed is addressed.
function visibleFor(userId?: string | null): Prisma.NotificationWhereInput {
  if (!userId) return { userId: null };
  return { OR: [{ userId: null }, { userId }] };
}

export class PrismaNotificationService implements NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly email: NotificationEmailBridge | null,
    private readonly tenantEmail?: (tenantId: string) => Promise<string | null>,
  ) {}

  async notify(input: NotifyInput): Promise<NotificationRow> {
    const row = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        payload: input.payload ?? undefined,
      },
    });
    if (input.email !== false && this.email) {
      try {
        const to = input.emailTo ?? (this.tenantEmail ? await this.tenantEmail(input.tenantId) : null);
        if (to) {
          await this.email.send(input.tenantId, to, input.title, [input.body, input.link].filter(Boolean).join('\n\n'));
        }
      } catch {
        // Email is best-effort; in-app notification already recorded.
      }
    }
    return this.map(row);
  }

  async list(
    tenantId: string,
    opts?: { userId?: string | null; unreadOnly?: boolean; limit?: number },
  ): Promise<NotificationRow[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        tenantId,
        ...visibleFor(opts?.userId),
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
    return rows.map((r) => this.map(r));
  }

  async unreadCount(tenantId: string, userId?: string | null): Promise<number> {
    return this.prisma.notification.count({
      where: { tenantId, ...visibleFor(userId), readAt: null },
    });
  }

  async markAllRead(tenantId: string, userId?: string | null): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { tenantId, ...visibleFor(userId), readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async markRead(tenantId: string, id: string, userId?: string | null): Promise<NotificationRow | null> {
    const row = await this.prisma.notification.findFirst({
      where: { id, tenantId, ...visibleFor(userId) },
    });
    if (!row) return null;
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: row.readAt ?? new Date() },
    });
    return this.map(updated);
  }

  private map(row: {
    id: string;
    tenantId: string;
    userId: string | null;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      payload: row.payload ?? null,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
