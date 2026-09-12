import type { PrismaClient } from '@prisma/client';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import type { NotificationService } from '../notification/notification.service';

export type MessageKind = 'MESSAGE' | 'RATE_PROPOSAL' | 'SYSTEM';

/** Only these two are ever authored by a user. */
function toKind(raw: string): MessageKind {
  if (raw === 'RATE_PROPOSAL') return 'RATE_PROPOSAL';
  if (raw === 'SYSTEM') return 'SYSTEM';
  return 'MESSAGE';
}

export interface MessageRow {
  id: string;
  loadId: string;
  authorTenantId: string;
  mine: boolean;
  authorLabel: string;
  kind: MessageKind;
  body: string | null;
  proposedAmount: string | null;
  currency: string | null;
  createdAt: string;
}

/** One carrier's negotiation on a load — a load can have several. */
export interface ConversationSummary {
  counterpartyTenantId: string;
  counterpartyName: string;
  unread: number;
  lastAt: string;
  lastPreview: string;
  /** That carrier's latest rate offer, for comparing them side by side. */
  lastOfferAmount: string | null;
  lastOfferAt: string | null;
  isBooker: boolean;
}

export interface ThreadView {
  load: {
    id: string;
    label: string;
    posterTenantId: string;
    posterName: string;
    bookedByTenantId: string | null;
    marketplaceStatus: string;
    rate: string | null;
    currency: string;
  };
  viewer: {
    role: 'poster' | 'carrier';
    /** The single carrier this thread belongs to (always set for carriers). */
    counterpartyTenantId: string | null;
    counterpartyName: string | null;
  };
  /** Poster only: every carrier that has reached out on this load. */
  conversations: ConversationSummary[];
  thread: MessageRow[];
}

export interface PostMessageInput {
  body?: string;
  proposedAmount?: number;
}

export interface MessageService {
  list(tenantId: string, loadId: string, withTenantId?: string): Promise<ThreadView>;
  post(
    tenantId: string,
    loadId: string,
    input: PostMessageInput,
    toTenantId?: string,
  ): Promise<MessageRow>;
  /** Unread counts for both sides of every load the tenant touches. */
  unread(tenantId: string): Promise<{
    loads: Array<{ loadId: string; unread: number }>;
    threads: Array<{ loadId: string; counterpartyTenantId: string; unread: number }>;
  }>;
  /**
   * Poster accepts a carrier's latest offer: the load's asking rate becomes
   * that amount and the thread records who agreed to what.
   */
  acceptOffer(
    tenantId: string,
    loadId: string,
    counterpartyTenantId: string,
  ): Promise<AcceptedOffer>;
}

export interface AcceptedOffer {
  counterpartyTenantId: string;
  amount: string;
  currency: string;
  /** The load's rate after accepting. */
  loadRate: string;
}

const MAX_BODY = 2000;

function preview(kind: MessageKind, body: string, amount: string | null, currency: string | null): string {
  if (kind === 'RATE_PROPOSAL' && amount != null) {
    return body ? `${currency ?? ''} ${amount} — ${body}`.trim() : `Proposed ${currency ?? ''} ${amount}`.trim();
  }
  return body;
}

export class PrismaMessageService implements MessageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Loads a marketplace-visible load and decides the caller's side of the table.
   * A carrier does not need an existing thread to start one — reaching out on
   * a public load is the whole point of the board.
   */
  private async context(tenantId: string, loadId: string) {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] } },
      select: {
        id: true,
        tenantId: true,
        originRegion: true,
        destinationRegion: true,
        marketplaceStatus: true,
        freightCurrency: true,
        freightAmountTransaction: true,
        bookedByTenantId: true,
        tenant: { select: { name: true } },
      },
    });
    if (!load) throw notFound('load not found on the board');
    if (load.tenantId !== tenantId && load.marketplaceStatus !== 'PUBLIC' && load.bookedByTenantId !== tenantId) {
      throw notFound('load not found on the board');
    }
    return { load, isPoster: load.tenantId === tenantId };
  }

  async unread(tenantId: string): Promise<ThreadViewUnread> {
    const [posterRows, carrierRows] = await Promise.all([
      this.prisma.loadMessage.groupBy({
        by: ['loadId'],
        where: {
          readByPoster: false,
          authorTenantId: { not: tenantId },
          load: { tenantId, marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] } },
        },
        _count: { _all: true },
      }),
      this.prisma.loadMessage.groupBy({
        by: ['loadId'],
        where: {
          readByOther: false,
          authorTenantId: { not: tenantId },
          counterpartyTenantId: tenantId,
        },
        _count: { _all: true },
      }),
    ]);

    const byLoad = new Map<string, number>();
    for (const r of posterRows) byLoad.set(r.loadId, r._count._all);

    return {
      loads: Array.from(byLoad, ([loadId, unread]) => ({ loadId, unread })),
      threads: carrierRows.map((r) => ({
        loadId: r.loadId,
        counterpartyTenantId: tenantId,
        unread: r._count._all,
      })),
    };
  }

  /** Carrier tenants that have reached out on this load (poster's inbox). */
  private async conversationsFor(loadId: string, bookedByTenantId: string | null, viewerTenantId: string) {
    const rows = await this.prisma.loadMessage.findMany({
      where: { loadId, counterpartyTenantId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        counterpartyTenantId: true,
        authorTenantId: true,
        body: true,
        kind: true,
        proposedAmount: true,
        currency: true,
        readByPoster: true,
        createdAt: true,
      },
    });

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.counterpartyTenantId as string;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const names = await this.prisma.tenant.findMany({
      where: { id: { in: Array.from(groups.keys()) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((t) => [t.id, t.name]));

    return Array.from(groups, ([counterpartyTenantId, list]) => {
      const last = list[list.length - 1];
      const offers = list.filter((m) => m.kind === 'RATE_PROPOSAL' && m.proposedAmount != null);
      const lastOffer = offers[offers.length - 1];
      return {
        counterpartyTenantId,
        counterpartyName: nameById.get(counterpartyTenantId) ?? 'Carrier',
        unread: list.filter((m) => m.authorTenantId !== viewerTenantId && !m.readByPoster).length,
        lastAt: last.createdAt.toISOString(),
        lastPreview: preview(
          toKind(last.kind),
          last.body,
          last.proposedAmount != null ? String(last.proposedAmount) : null,
          last.currency,
        ).slice(0, 140),
        lastOfferAmount: lastOffer ? String(lastOffer.proposedAmount) : null,
        lastOfferAt: lastOffer ? lastOffer.createdAt.toISOString() : null,
        isBooker: counterpartyTenantId === bookedByTenantId,
      };
    }).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }

  async list(tenantId: string, loadId: string, withTenantId?: string): Promise<ThreadView> {
    const { load, isPoster } = await this.context(tenantId, loadId);

    // Carriers only ever see their own negotiation — never a rival's.
    const conversations = isPoster ? await this.conversationsFor(load.id, load.bookedByTenantId, tenantId) : [];

    let counterpartyTenantId: string | null;
    if (isPoster) {
      if (withTenantId) {
        if (!conversations.some((c) => c.counterpartyTenantId === withTenantId)) {
          throw notFound('that carrier has not messaged this load');
        }
        counterpartyTenantId = withTenantId;
      } else {
        // Auto-select only when there is no ambiguity.
        counterpartyTenantId = conversations.length === 1 ? conversations[0].counterpartyTenantId : null;
      }
    } else {
      counterpartyTenantId = tenantId;
    }

    const rows = counterpartyTenantId
      ? await this.prisma.loadMessage.findMany({
          where: { loadId: load.id, counterpartyTenantId },
          orderBy: { createdAt: 'asc' },
          take: 200,
        })
      : [];

    // Mark the counterpart's messages as read for this viewer.
    const unreadIds = rows.filter((r) => r.authorTenantId !== tenantId).map((r) => r.id);
    if (unreadIds.length > 0) {
      await this.prisma.loadMessage.updateMany({
        where: { id: { in: unreadIds } },
        data: isPoster ? { readByPoster: true } : { readByOther: true },
      });
    }

    const otherName = counterpartyTenantId
      ? isPoster
        ? (conversations.find((c) => c.counterpartyTenantId === counterpartyTenantId)?.counterpartyName ?? 'Carrier')
        : (load.tenant?.name ?? 'Poster')
      : null;

    const authorIds = Array.from(new Set(rows.map((r) => r.authorTenantId).filter((id) => id !== tenantId)));
    const tenants = authorIds.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));

    return {
      load: {
        id: load.id,
        label: `${load.originRegion} → ${load.destinationRegion}`,
        posterTenantId: load.tenantId,
        posterName: load.tenant?.name ?? 'Poster',
        bookedByTenantId: load.bookedByTenantId,
        marketplaceStatus: load.marketplaceStatus,
        rate: load.freightAmountTransaction != null ? String(load.freightAmountTransaction) : null,
        currency: load.freightCurrency,
      },
      viewer: { role: isPoster ? 'poster' : 'carrier', counterpartyTenantId, counterpartyName: otherName },
      conversations,
      thread: rows.map((r) => ({
        id: r.id,
        loadId: r.loadId,
        authorTenantId: r.authorTenantId,
        mine: r.authorTenantId === tenantId,
        authorLabel: r.authorTenantId === tenantId ? 'You' : (nameById.get(r.authorTenantId) ?? (isPoster ? 'Carrier' : 'Poster')),
        kind: toKind(r.kind),
        body: r.body,
        proposedAmount: r.proposedAmount != null ? String(r.proposedAmount) : null,
        currency: r.currency,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async acceptOffer(
    tenantId: string,
    loadId: string,
    counterpartyTenantId: string,
  ): Promise<AcceptedOffer> {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, marketplaceStatus: { in: ['PUBLIC', 'BOOKED'] } },
      select: {
        id: true,
        tenantId: true,
        originRegion: true,
        destinationRegion: true,
        freightCurrency: true,
        exchangeRateToBase: true,
      },
    });
    if (!load) throw notFound('load not found on the board');
    // Only the carrier that posted the load sets its price.
    if (load.tenantId !== tenantId) throw forbidden('only the posting carrier can accept an offer');

    const offer = await this.prisma.loadMessage.findFirst({
      where: { loadId: load.id, counterpartyTenantId, kind: 'RATE_PROPOSAL', proposedAmount: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { proposedAmount: true, currency: true },
    });
    if (!offer?.proposedAmount) throw badRequest('that carrier has not proposed a rate');

    const amount = Number(offer.proposedAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('that offer is not a usable amount');
    const currency = offer.currency ?? load.freightCurrency;
    // Same derivation the load service uses on create: base = transaction × rate.
    const rate = Number(load.exchangeRateToBase ?? 1) || 1;
    const base = Math.round(amount * rate * 100) / 100;

    await this.prisma.load.update({
      where: { id: load.id },
      data: { freightAmountTransaction: amount, freightAmountBase: base },
    });

    const lane = `${load.originRegion} → ${load.destinationRegion}`;
    const note = `Offer accepted — the rate for ${lane} is now ${currency} ${amount}${
      offer.currency && offer.currency !== load.freightCurrency ? ` (listed in ${load.freightCurrency})` : ''
    }.`;
    await this.prisma.loadMessage.create({
      data: {
        loadId: load.id,
        authorTenantId: tenantId,
        counterpartyTenantId,
        body: note,
        kind: 'SYSTEM',
        readByPoster: true,
        readByOther: false,
      },
    });

    await this.notifications.notify({
      tenantId: counterpartyTenantId,
      kind: 'load_message',
      title: `Offer accepted on ${lane}`,
      body: `The poster agreed to ${currency} ${amount}.`,
      link: '/app/board',
    });

    return {
      counterpartyTenantId,
      amount: String(amount),
      currency,
      loadRate: String(amount),
    };
  }

  async post(
    tenantId: string,
    loadId: string,
    input: PostMessageInput,
    toTenantId?: string,
  ): Promise<MessageRow> {
    const body = input.body?.trim() ?? '';
    const amount = input.proposedAmount;
    if (!body && (amount == null || !Number.isFinite(amount) || amount <= 0)) {
      throw badRequest('write a message or propose an amount');
    }
    if (body.length > MAX_BODY) throw badRequest(`message is too long (max ${MAX_BODY} characters)`);
    if (amount != null && (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000)) {
      throw badRequest('proposed amount looks wrong');
    }

    const { load, isPoster } = await this.context(tenantId, loadId);

    // A carrier's thread is always their own; the poster addresses one carrier.
    let counterpartyTenantId: string;
    if (isPoster) {
      const conversations = await this.conversationsFor(load.id, load.bookedByTenantId, tenantId);
      if (toTenantId) {
        if (!conversations.some((c) => c.counterpartyTenantId === toTenantId)) {
          throw badRequest('that carrier has not messaged this load');
        }
        counterpartyTenantId = toTenantId;
      } else if (conversations.length === 1) {
        counterpartyTenantId = conversations[0].counterpartyTenantId;
      } else if (conversations.length === 0) {
        throw badRequest('this load has no carrier conversation yet');
      } else {
        throw badRequest('choose which carrier to reply to');
      }
    } else {
      if (load.bookedByTenantId != null && load.bookedByTenantId !== tenantId && load.marketplaceStatus === 'BOOKED') {
        throw forbidden('this load is already booked by another carrier');
      }
      counterpartyTenantId = tenantId;
    }

    const row = await this.prisma.loadMessage.create({
      data: {
        loadId: load.id,
        authorTenantId: tenantId,
        counterpartyTenantId,
        body: body || '',
        kind: amount != null ? 'RATE_PROPOSAL' : 'MESSAGE',
        proposedAmount: amount != null ? amount : null,
        currency: amount != null ? load.freightCurrency : null,
        // The author has obviously seen their own message.
        readByPoster: isPoster,
        readByOther: !isPoster,
      },
    });

    const lane = `${load.originRegion}→${load.destinationRegion}`;
    const previewText = preview(
      amount != null ? 'RATE_PROPOSAL' : 'MESSAGE',
      body,
      amount != null ? String(amount) : null,
      load.freightCurrency,
    );
    const notifyTarget = isPoster ? counterpartyTenantId : load.tenantId;
    await this.notifications.notify({
      tenantId: notifyTarget,
      kind: 'load_message',
      title: isPoster ? `Reply on ${lane}` : `New message on ${lane}`,
      body: previewText.length > 120 ? `${previewText.slice(0, 117)}…` : previewText,
      link: isPoster ? '/app/board' : '/app/myloads',
    });

    return {
      id: row.id,
      loadId: row.loadId,
      authorTenantId: row.authorTenantId,
      mine: true,
      authorLabel: 'You',
      kind: toKind(row.kind),
      body: row.body,
      proposedAmount: row.proposedAmount != null ? String(row.proposedAmount) : null,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

type ThreadViewUnread = {
  loads: Array<{ loadId: string; unread: number }>;
  threads: Array<{ loadId: string; counterpartyTenantId: string; unread: number }>;
};
