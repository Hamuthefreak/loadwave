import type { PrismaClient } from '@prisma/client';

export interface NotificationRow {
  id: string;
  tenantId: string;
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
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  email?: boolean; // sends email when SMTP is configured
  payload?: unknown;
}

export interface NotificationService {
  notify(input: NotifyInput): Promise<NotificationRow>;
  list(tenantId: string, opts?: { unreadOnly?: boolean; limit?: number }): Promise<NotificationRow[]>;
  unreadCount(tenantId: string): Promise<number>;
  markAllRead(tenantId: string): Promise<number>;
  markRead(tenantId: string, id: string): Promise<NotificationRow | null>;
}

export interface NotificationEmailBridge {
  send(tenantId: string, to: string, subject: string, text: string): Promise<void>;
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
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        payload: input.payload ?? undefined,
      },
    });
    if (input.email !== false && this.email && this.tenantEmail) {
      try {
        const to = await this.tenantEmail(input.tenantId);
        if (to) {
          await this.email.send(input.tenantId, to, input.title, [input.body, input.link].filter(Boolean).join('\n\n'));
        }
      } catch {
        // Email is best-effort; in-app notification already recorded.
      }
    }
    return this.map(row);
  }

  async list(tenantId: string, opts?: { unreadOnly?: boolean; limit?: number }): Promise<NotificationRow[]> {
    const rows = await this.prisma.notification.findMany({
      where: { tenantId, ...(opts?.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
    return rows.map((r) => this.map(r));
  }

  async unreadCount(tenantId: string): Promise<number> {
    return this.prisma.notification.count({ where: { tenantId, readAt: null } });
  }

  async markAllRead(tenantId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async markRead(tenantId: string, id: string): Promise<NotificationRow | null> {
    const row = await this.prisma.notification.findFirst({ where: { id, tenantId } });
    if (!row) return null;
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: row.readAt ?? new Date() },
    });
    return this.map(updated);
  }

  private map(row: { id: string; tenantId: string; kind: string; title: string; body: string | null; link: string | null; payload: unknown; readAt: Date | null; createdAt: Date }): NotificationRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
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