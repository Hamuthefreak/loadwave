import type { PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '../../utils/errors';
import {
  buildStatement,
  DEFAULT_TIMEZONE,
  kmToMiles,
  payProfileOf,
  rollupStatements,
  safeTimezone,
  yearToDatePeriod,
  type PayLoadInput,
  type SettlementPeriod,
  type Statement,
  type StatementLine,
} from './settlement.policy';
import {
  ageInDays,
  answerNotification,
  cents,
  disputeNotification,
  disputeReference,
  disputedCents,
  disputedSummary,
  findOpenDuplicate,
  isDisputeSubject,
  isDisputeStatus,
  normalizeAnswer,
  normalizeMessage,
  signoffText,
  snapshotLine,
  type DisputeStatus,
  type DisputeSubject,
  type DisputedLine,
} from './dispute.policy';
import { buildSettlementStatement, dateOf, moneyOf, referenceOf } from '../documents/pdf.templates';
import {
  latestSignaturePerRole,
  MAX_SIGNATURE_BYTES,
  sniffImageMime,
  type PaperworkFile,
} from '../documents/paperwork.service';
import { toEmbeddableImage, type EmbeddableImage } from '../pdf/pdf.images';
import type { NotificationService } from '../notification/notification.service';

/**
 * Distances are stored to four decimal places of a kilometre and converted
 * here. Rounding to a tenth of a mile before pricing is deliberate: it is the
 * precision dispatch quotes and the driver checks against their own log, and
 * the difference is a few cents on a 500-mile run.
 */
function milesFromKm(km: unknown): number | null {
  if (km == null) return null;
  const value = Number(km);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(kmToMiles(value) * 10) / 10;
}

export interface SettlementTotalsView {
  drivers: number;
  payableDrivers: number;
  loads: number;
  unpricedLoads: number;
  miles: number;
  detentionHours: number;
  revenueCents: number;
  payCents: number;
  detentionCents: number;
  totalPayCents: number;
  marginCents: number;
  effectivePayPerMileCents: number | null;
}

/**
 * A statement as the payroll screen needs it: the money, plus whether the driver
 * has signed off on this period. A week that has been signed and a week that is
 * still waiting are different rows in a payroll run even though they carry the
 * same figure.
 */
export interface DriverStatement extends Statement {
  signedAt: string | null;
  signedBy: string | null;
}

export interface SettlementOverview {
  period: { from: string; to: string; label: string };
  drivers: DriverStatement[];
  totals: SettlementTotalsView;
}

export interface PayDisputeRow {
  id: string;
  reference: string;
  driverId: string;
  driverName: string;
  loadId: string | null;
  subject: DisputeSubject;
  status: DisputeStatus;
  message: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  /** The line as the driver was looking at it, snapshotted at raise time. */
  line: DisputedLine;
  /** The part of the line that was questioned, in cents, at raise time. */
  disputedCents: number;
  /** Summary of the arithmetic, for the office inbox. */
  summary: string;
  /**
   * The same figure as it stands now, or null when the line is no longer on the
   * statement. A difference means the statement moved under the query — often
   * because somebody already fixed it — which is the first thing dispatch needs
   * to know before answering.
   */
  currentCents: number | null;
  lineChanged: boolean;
  resolution: string | null;
  decidedAt: string | null;
  createdAt: string;
  ageDays: number;
}

export interface SettlementSignatureRow {
  id: string;
  driverId: string;
  role: string;
  signerName: string;
  signedAt: string;
  sizeBytes: number;
}

export interface SettlementSignatureInput {
  tenantId: string;
  driverId: string;
  role: string;
  signerName: string;
  periodFrom: Date;
  periodTo: Date;
  periodLabel: string;
  dataBase64: string;
  capturedById?: string | null;
}

export interface DriverSelfView {
  period: { from: string; to: string; label: string };
  statement: Statement;
  yearToDate: Statement;
  /** The driver's signature on this period's statement, when there is one. */
  signature: SettlementSignatureRow | null;
  /** Queries the driver has raised on this period that are still unanswered. */
  openQueries: number;
}

export interface SettlementService {
  /** The whole fleet for one pay period — what a payroll run reads off. */
  overview(tenantId: string, period: SettlementPeriod): Promise<SettlementOverview>;
  /** One driver's statement, for the ops drill-down. */
  forDriver(tenantId: string, driverId: string, period: SettlementPeriod): Promise<Statement>;
  /** What the driver themselves sees: this period plus the year to date. */
  forSelf(tenantId: string, driverId: string, period: SettlementPeriod): Promise<DriverSelfView>;
  /** The home terminal a driver's pay week is cut against. */
  driverTimezone(tenantId: string, driverId: string): Promise<string>;
  /** Fleet default: the home terminal most of the drivers share. */
  tenantTimezone(tenantId: string): Promise<string>;

  /** A driver questioning a line on their own statement. */
  raiseDispute(input: {
    tenantId: string;
    driverId: string;
    loadId: string;
    subject: DisputeSubject;
    message: unknown;
    period: SettlementPeriod;
  }): Promise<PayDisputeRow>;
  /** The driver's own queries, newest first. */
  listDisputesForDriver(tenantId: string, driverId: string): Promise<PayDisputeRow[]>;
  /** The office inbox: every query, open ones first. */
  listDisputes(
    tenantId: string,
    opts?: { status?: string | null; limit?: number },
  ): Promise<{ open: number; disputes: PayDisputeRow[] }>;
  /** The office answering a query. */
  decideDispute(input: {
    tenantId: string;
    id: string;
    decision: DisputeStatus;
    resolution: unknown;
    actorId: string | null;
  }): Promise<PayDisputeRow>;

  /** The statement as a PDF, ready for payroll to file or to hand over. */
  statementPdf(tenantId: string, driverId: string, period: SettlementPeriod): Promise<PaperworkFile>;
  captureSignature(input: SettlementSignatureInput): Promise<SettlementSignatureRow>;
  /** Signatures captured for a period, oldest first. */
  listSignatures(tenantId: string, driverId: string, period?: SettlementPeriod): Promise<SettlementSignatureRow[]>;
}

interface DisputeDbRow {
  id: string;
  tenantId: string;
  driverId: string;
  loadId: string | null;
  subject: string;
  status: string;
  message: string;
  periodLabel: string;
  periodFrom: Date;
  periodTo: Date;
  line: unknown;
  resolution: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const DISPUTE_LIST_LIMIT = 100;

export class PrismaSettlementService implements SettlementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationService | null = null,
  ) {}

  private async driversOf(tenantId: string, only?: string) {
    return this.prisma.driver.findMany({
      where: { tenantId, ...(only ? { id: only } : {}) },
      select: { id: true, name: true, homeTerminalTz: true, payModel: true, payRate: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Delivered work in the window, priced from the driver's own profile. */
  private async loadInputs(
    tenantId: string,
    driverIds: string[],
    period: SettlementPeriod,
  ): Promise<Map<string, { loads: PayLoadInput[]; openDetention: number }>> {
    const byDriver = new Map(driverIds.map((id) => [id, { loads: [] as PayLoadInput[], openDetention: 0 }]));
    if (driverIds.length === 0) return byDriver;

    const loads = await this.prisma.load.findMany({
      where: {
        tenantId,
        assigneeDriverId: { in: driverIds },
        status: { in: ['DELIVERED', 'INVOICED'] },
        deliveredAt: { gte: period.from, lt: period.to },
      },
      select: {
        id: true,
        externalLoadboardId: true,
        originRegion: true,
        destinationRegion: true,
        deliveredAt: true,
        distanceKmEstimate: true,
        freightAmountBase: true,
        detentionRate: true,
        assigneeDriverId: true,
        detentions: { select: { startedAt: true, endedAt: true, ratePerHour: true } },
      },
      orderBy: { deliveredAt: 'asc' },
    });

    for (const load of loads) {
      const key = load.assigneeDriverId;
      if (!key) continue;
      const bucket = byDriver.get(key);
      if (!bucket) continue;

      // Only closed detention is payable: you cannot settle time that has not
      // stopped yet. An open timer is counted so the statement can say so
      // rather than quietly underpaying.
      let hours = 0;
      let rate: number | null = load.detentionRate == null ? null : Number(load.detentionRate);
      for (const entry of load.detentions) {
        if (!entry.endedAt) {
          bucket.openDetention += 1;
          continue;
        }
        const ms = Math.max(0, entry.endedAt.getTime() - entry.startedAt.getTime());
        hours += ms / 3_600_000;
        if (entry.ratePerHour != null) rate = Number(entry.ratePerHour);
      }

      bucket.loads.push({
        id: load.id,
        reference: load.externalLoadboardId ?? load.id.slice(0, 8).toUpperCase(),
        originRegion: load.originRegion,
        destinationRegion: load.destinationRegion,
        deliveredAt: load.deliveredAt,
        distanceMiles: milesFromKm(load.distanceKmEstimate),
        revenueBase: load.freightAmountBase == null ? null : Number(load.freightAmountBase),
        detentionHours: Math.round(hours * 100) / 100,
        detentionRate: rate,
      });
    }
    return byDriver;
  }

  private async statementsFor(
    tenantId: string,
    period: SettlementPeriod,
    only?: string,
  ): Promise<Statement[]> {
    const drivers = await this.driversOf(tenantId, only);
    const byDriver = await this.loadInputs(tenantId, drivers.map((d) => d.id), period);

    return drivers.map((driver) => {
      const bucket = byDriver.get(driver.id) ?? { loads: [], openDetention: 0 };
      const statement = buildStatement({
        driverId: driver.id,
        driverName: driver.name,
        profile: payProfileOf(driver.payModel, driver.payRate),
        loads: bucket.loads,
        from: period.from,
        to: period.to,
        label: period.label,
      });
      const openCount = bucket.openDetention;
      if (openCount > 0) {
        statement.notes.push(
          `${openCount} load${openCount === 1 ? ' has' : 's have'} a detention timer still running — those hours are not included until it is stopped.`,
        );
      }
      return statement;
    });
  }

  async driverTimezone(tenantId: string, driverId: string): Promise<string> {
    const row = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId },
      select: { homeTerminalTz: true },
    });
    return safeTimezone(row?.homeTerminalTz);
  }

  /**
   * No tenant-level timezone column exists, so the fleet's pay week follows the
   * home terminal most of its drivers share. A carrier with one terminal (the
   * common case) gets that terminal exactly.
   */
  async tenantTimezone(tenantId: string): Promise<string> {
    const rows = await this.prisma.driver.groupBy({
      by: ['homeTerminalTz'],
      where: { tenantId },
      _count: { _all: true },
    });
    if (rows.length === 0) return DEFAULT_TIMEZONE;
    const [top] = [...rows].sort((a, b) => b._count._all - a._count._all);
    return safeTimezone(top.homeTerminalTz);
  }

  async overview(tenantId: string, period: SettlementPeriod): Promise<SettlementOverview> {
    const [statements, signatures] = await Promise.all([
      this.statementsFor(tenantId, period),
      // One query for the whole fleet's sign-offs rather than one per driver.
      this.prisma.settlementSignature.findMany({
        where: { tenantId, periodFrom: period.from, periodTo: period.to, role: 'DRIVER' },
        orderBy: { signedAt: 'asc' },
        select: { driverId: true, signerName: true, signedAt: true },
      }),
    ]);

    // Ascending order means the last write per driver is the one that stands,
    // matching how the statement PDF picks the signature it prints.
    const signoff = new Map<string, { signedAt: string; signerName: string }>();
    for (const row of signatures) {
      signoff.set(row.driverId, { signedAt: row.signedAt.toISOString(), signerName: row.signerName });
    }

    const drivers: DriverStatement[] = statements.map((statement) => ({
      ...statement,
      signedAt: signoff.get(statement.driverId)?.signedAt ?? null,
      signedBy: signoff.get(statement.driverId)?.signerName ?? null,
    }));
    // Biggest cheque first: it is the one a payroll run reconciles by hand.
    drivers.sort((a, b) => b.totals.totalPayCents - a.totals.totalPayCents);
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
      drivers,
      totals: rollupStatements(drivers),
    };
  }

  async forDriver(tenantId: string, driverId: string, period: SettlementPeriod): Promise<Statement> {
    const found = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId }, select: { id: true } });
    if (!found) throw notFound('driver not found');
    const [statement] = await this.statementsFor(tenantId, period, driverId);
    return statement;
  }

  async forSelf(tenantId: string, driverId: string, period: SettlementPeriod): Promise<DriverSelfView> {
    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId },
      select: { id: true, homeTerminalTz: true },
    });
    if (!driver) throw notFound('driver not found');

    // Year-to-date is anchored on the same home terminal as the week, so the
    // two figures can never disagree about which year a late-December run
    // belongs to.
    const [statement] = await this.statementsFor(tenantId, period, driverId);
    const [yearToDate] = await this.statementsFor(tenantId, yearToDatePeriod(new Date(), driver.homeTerminalTz), driverId);
    // listSignatures runs oldest-first for the audit trail, so the standing
    // sign-off is the last one: a driver who re-signs must not keep seeing the
    // superseded capture on their own card.
    const signatures = await this.listSignatures(tenantId, driverId, period);
    const signature = signatures.length > 0 ? (signatures[signatures.length - 1] as SettlementSignatureRow) : null;
    const openQueries = await this.prisma.payDispute.count({
      where: {
        tenantId,
        driverId,
        status: 'OPEN',
        periodFrom: period.from,
        periodTo: period.to,
      },
    });
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
      statement,
      yearToDate,
      signature,
      openQueries,
    };
  }

  /* ------------------------------------------------------------------ *
   * Pay queries
   * ------------------------------------------------------------------ */

  /**
   * A driver querying a line. The figure is snapshotted rather than referenced,
   * because the statement it came from is recomputed on every read: a dispute
   * that stored only a load id would quietly start pointing at different numbers
   * the moment somebody corrected a rate.
   */
  async raiseDispute(input: {
    tenantId: string;
    driverId: string;
    loadId: string;
    subject: DisputeSubject;
    message: unknown;
    period: SettlementPeriod;
  }): Promise<PayDisputeRow> {
    if (!isDisputeSubject(input.subject)) throw badRequest('unknown dispute subject');
    const normalised = normalizeMessage(input.message);
    if (!normalised.ok) throw badRequest(normalised.error);

    const [statement] = await this.statementsFor(input.tenantId, input.period, input.driverId);
    if (!statement) throw notFound('driver not found');

    const line = statement.lines.find((l) => l.loadId === input.loadId);
    if (!line) {
      // Say which way out of it, rather than "not found": the driver has almost
      // always opened last week's statement on the card.
      throw badRequest('That load is not on your statement for this period, so there is nothing to query.');
    }
    if (input.subject === 'DETENTION' && line.detentionHours <= 0) {
      throw badRequest('No detention time was recorded on this load.');
    }

    const existing = await this.prisma.payDispute.findMany({
      where: { tenantId: input.tenantId, driverId: input.driverId, loadId: input.loadId, status: 'OPEN' },
      select: { id: true, loadId: true, subject: true, status: true },
    });
    const duplicate = findOpenDuplicate(existing, input.loadId, input.subject);
    if (duplicate) {
      throw badRequest('You already have an open query on this — the office is looking at it.');
    }

    const snapshot = snapshotLine(line);
    const created = await this.prisma.payDispute.create({
      data: {
        tenantId: input.tenantId,
        driverId: input.driverId,
        loadId: input.loadId,
        subject: input.subject,
        message: normalised.value,
        periodLabel: statement.period.label,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        line: snapshot as unknown as never,
      },
    });

    if (this.notifications) {
      const raised = disputeNotification({ driverName: statement.driverName, line: snapshot, subject: input.subject });
      await this.notifications.notify({
        tenantId: input.tenantId,
        kind: 'settlement',
        title: raised.title,
        body: `${raised.body}\n"${normalised.value}"`,
        link: '/app/settlements',
        payload: { disputeId: created.id, loadId: input.loadId },
      });
    }

    return this.mapDispute(created as DisputeDbRow, {
      driverName: statement.driverName,
      currentCents: disputedCents(snapshot, input.subject),
      now: new Date(),
    });
  }

  async listDisputesForDriver(tenantId: string, driverId: string): Promise<PayDisputeRow[]> {
    const rows = await this.prisma.payDispute.findMany({
      where: { tenantId, driverId },
      orderBy: { createdAt: 'desc' },
      take: DISPUTE_LIST_LIMIT,
    });
    return this.decorateDisputes(tenantId, rows as DisputeDbRow[]);
  }

  async listDisputes(
    tenantId: string,
    opts: { status?: string | null; limit?: number } = {},
  ): Promise<{ open: number; disputes: PayDisputeRow[] }> {
    const status = opts.status && isDisputeStatus(opts.status) ? opts.status : null;
    const [rows, open] = await Promise.all([
      this.prisma.payDispute.findMany({
        where: { tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: opts.limit ?? DISPUTE_LIST_LIMIT,
      }),
      this.prisma.payDispute.count({ where: { tenantId, status: 'OPEN' } }),
    ]);
    const disputes = await this.decorateDisputes(tenantId, rows as DisputeDbRow[]);
    // Open queries first, oldest first inside that: the one that has been waiting
    // longest is the one that is about to become a phone call to the labour board.
    disputes.sort((a, b) => {
      const openRank = (d: PayDisputeRow): number => (d.status === 'OPEN' ? 0 : 1);
      return openRank(a) - openRank(b) || a.createdAt.localeCompare(b.createdAt);
    });
    return { open, disputes };
  }

  async decideDispute(input: {
    tenantId: string;
    id: string;
    decision: DisputeStatus;
    resolution: unknown;
    actorId: string | null;
  }): Promise<PayDisputeRow> {
    if (input.decision !== 'RESOLVED' && input.decision !== 'DECLINED') {
      throw badRequest('a query can only be resolved or declined');
    }
    const answer = normalizeAnswer(input.resolution);
    if (!answer.ok) throw badRequest(answer.error);

    const row = await this.prisma.payDispute.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
    });
    if (!row) throw notFound('query not found');
    if (row.status !== 'OPEN') throw badRequest('That query has already been answered.');

    const updated = await this.prisma.payDispute.update({
      where: { id: row.id },
      data: {
        status: input.decision,
        resolution: answer.value,
        decidedById: input.actorId,
        decidedAt: new Date(),
      },
    });

    if (this.notifications) {
      const driverUser = await this.prisma.user.findFirst({
        where: { tenantId: input.tenantId, driverId: row.driverId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true },
      });
      if (driverUser) {
        const notice = answerNotification({
          status: input.decision,
          periodLabel: row.periodLabel,
          reference: disputeReference(row.id),
        });
        await this.notifications.notify({
          tenantId: input.tenantId,
          userId: driverUser.id,
          kind: 'settlement',
          title: notice.title,
          body: `${notice.body}\n${answer.value}`,
          link: '/app/dashboard',
          emailTo: driverUser.email,
          payload: { disputeId: row.id },
        });
      }
    }

    // Decorated like any other row, so the caller gets the driver's name and the
    // figure as it stands now rather than a stripped-down echo of the write.
    const [decorated] = await this.decorateDisputes(input.tenantId, [updated as DisputeDbRow]);
    if (!decorated) throw notFound('query not found');
    return decorated;
  }

  /**
   * Adds the driver's name and what the figure is *now*.
   *
   * The re-read is grouped by driver and period, so twenty queries about the same
   * week cost one statement build rather than twenty — and it is what tells
   * dispatch "the statement has moved since" before they compose an answer.
   */
  private async decorateDisputes(tenantId: string, rows: DisputeDbRow[]): Promise<PayDisputeRow[]> {
    const now = new Date();
    if (rows.length === 0) return [];

    const names = await this.prisma.driver.findMany({
      where: { tenantId, id: { in: [...new Set(rows.map((r) => r.driverId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((d) => [d.id, d.name]));

    const groups = new Map<string, DisputeDbRow[]>();
    for (const row of rows) {
      const key = `${row.driverId}:${row.periodFrom.toISOString()}`;
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }

    const currentByDispute = new Map<string, number | null>();
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const first = group[0] as DisputeDbRow;
        const period: SettlementPeriod = {
          from: first.periodFrom,
          to: first.periodTo,
          label: first.periodLabel,
        };
        const [statement] = await this.statementsFor(tenantId, period, first.driverId);
        for (const row of group) {
          const line = statement?.lines.find((l) => l.loadId === row.loadId);
          currentByDispute.set(
            row.id,
            line && isDisputeSubject(row.subject) ? disputedCents(snapshotLine(line), row.subject) : null,
          );
        }
      }),
    );

    return rows.map((row) =>
      this.mapDispute(row, {
        driverName: nameOf.get(row.driverId) ?? 'Driver',
        currentCents: currentByDispute.get(row.id) ?? null,
        now,
      }),
    );
  }

  private mapDispute(
    row: DisputeDbRow,
    extra: { driverName: string | null; currentCents: number | null; now: Date },
  ): PayDisputeRow {
    const subject: DisputeSubject = isDisputeSubject(row.subject) ? row.subject : 'LINE';
    const status: DisputeStatus = isDisputeStatus(row.status) ? row.status : 'OPEN';
    const line = (row.line ?? {}) as DisputedLine;
    const disputed = disputedCents(line, subject);
    return {
      id: row.id,
      reference: disputeReference(row.id),
      driverId: row.driverId,
      driverName: extra.driverName ?? 'Driver',
      loadId: row.loadId,
      subject,
      status,
      message: row.message,
      periodLabel: row.periodLabel,
      periodFrom: row.periodFrom.toISOString(),
      periodTo: row.periodTo.toISOString(),
      line,
      disputedCents: disputed,
      summary: disputedSummary(line, subject),
      currentCents: extra.currentCents,
      lineChanged: extra.currentCents !== null && extra.currentCents !== disputed,
      resolution: row.resolution,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      ageDays: ageInDays(row.createdAt, extra.now),
    };
  }

  /* ------------------------------------------------------------------ *
   * The statement as a document
   * ------------------------------------------------------------------ */

  async statementPdf(
    tenantId: string,
    driverId: string,
    period: SettlementPeriod,
  ): Promise<PaperworkFile> {
    const [statement, tenant] = await Promise.all([
      this.forDriver(tenantId, driverId, period),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, mcNumber: true, usdotNumber: true, baseJurisdiction: true, fmcsaCheckedAt: true, baseCurrency: true },
      }),
    ]);
    if (!tenant) throw notFound('tenant not found');

    const signatures = await this.listSignatures(tenantId, driverId, period);
    const rows = await this.signatureImages(tenantId, signatures.map((s) => s.id));
    const blocks = latestSignaturePerRole(rows).map((row) => {
      const asset = toEmbeddableImage(row.data, row.mimeType);
      return {
        role: row.role,
        signerName: row.signerName,
        signedAt: row.signedAt,
        asset: asset.ok ? (asset as EmbeddableImage) : null,
      };
    });
    const driverBlock = blocks.find((b) => b.role === 'DRIVER') ?? null;
    const carrierBlock = blocks.find((b) => b.role === 'CARRIER') ?? null;

    const queries = await this.prisma.payDispute.findMany({
      where: { tenantId, driverId, periodFrom: period.from, periodTo: period.to, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, line: true, subject: true },
    });
    // The query's own reference is printed with it: it is the thing the driver
    // quotes on the phone and the office searches for, so a statement that only
    // described the line would leave both of them without a handle.
    const openQueries = queries.map(
      (q) =>
        `${disputeReference(q.id)} — ${disputedSummary(
          q.line as unknown as DisputedLine,
          isDisputeSubject(q.subject) ? q.subject : 'LINE',
        )}`,
    );

    const currency = tenant.baseCurrency;
    const statementNumber = referenceOf('ST', `${driverId}${period.from.toISOString().slice(0, 10)}`);

    // The totals block reads like the slip a driver checks: what was hauled,
    // what the pay is, what the waiting time added, then the figure that lands.
    const totals: Array<{ label: string; amount: string }> = [];
    if (statement.payModel) {
      totals.push({
        label: `Pay — ${statement.totals.loads} load${statement.totals.loads === 1 ? '' : 's'} (${statement.payLabel})`,
        amount: moneyOf(statement.totals.payCents / 100, currency),
      });
      if (statement.totals.detentionHours > 0) {
        totals.push({
          label: `Detention — ${statement.totals.detentionHours.toFixed(1)} h`,
          amount: moneyOf(statement.totals.detentionCents / 100, currency),
        });
      }
    } else {
      totals.push({
        label: `Revenue hauled — ${statement.totals.loads} load${statement.totals.loads === 1 ? '' : 's'} (owner-operator)`,
        amount: moneyOf(statement.totals.revenueCents / 100, currency),
      });
      if (statement.totals.detentionHours > 0) {
        totals.push({ label: `Detention — ${statement.totals.detentionHours.toFixed(1)} h`, amount: '—' });
      }
    }

    const pdf = buildSettlementStatement({
      statementNumber,
      issuedAt: new Date(),
      carrier: {
        name: tenant.name,
        mc: tenant.mcNumber ?? null,
        usdot: tenant.usdotNumber ?? null,
        jurisdiction: tenant.baseJurisdiction ?? null,
        note: tenant.fmcsaCheckedAt ? 'Authority status checked against FMCSA records' : null,
      },
      driver: {
        name: statement.driverName,
        note: statement.payLabel,
      },
      periodLabel: statement.period.label,
      periodFrom: dateOf(statement.period.from),
      periodTo: dateOf(new Date(new Date(statement.period.to).getTime() - 86_400_000)),
      payLabel: statement.payLabel,
      lines: statement.lines.map((line: StatementLine) => ({
        deliveredAt: line.deliveredAt,
        reference: line.reference,
        lane: line.lane,
        basis: line.priced ? line.basis : `${line.basis} — not priced, see notes`,
        detentionBasis: line.detentionBasis,
        amount: moneyOf(line.totalCents / 100, currency),
      })),
      totals,
      totalLabel: statement.payModel ? 'Total pay due' : 'Revenue kept (no pay owed)',
      total: moneyOf(statement.totals.totalPayCents / 100, currency),
      notes: statement.notes,
      openQueries,
      signoff: signoffText({
        driverName: statement.driverName,
        periodLabel: statement.period.label,
        totalLabel: cents(statement.totals.totalPayCents),
        openQueries: openQueries.length,
      }),
      driverSignature: driverBlock,
      carrierSignature: carrierBlock,
    });

    return { fileName: `${statementNumber}_settlement.pdf`, pdf };
  }

  async captureSignature(input: SettlementSignatureInput): Promise<SettlementSignatureRow> {
    const role = (input.role || 'DRIVER').toUpperCase();
    if (role !== 'DRIVER' && role !== 'CARRIER') {
      throw badRequest('role must be DRIVER or CARRIER');
    }
    const signerName = (input.signerName ?? '').trim().slice(0, 120);
    if (signerName.length < 2) throw badRequest('a signer name is required');

    const driver = await this.prisma.driver.findFirst({
      where: { id: input.driverId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!driver) throw notFound('driver not found');

    let data: Buffer;
    try {
      data = Buffer.from(input.dataBase64 ?? '', 'base64');
    } catch {
      throw badRequest('signature image is not valid base64');
    }
    if (data.length === 0) throw badRequest('signature image is empty');
    if (data.length > MAX_SIGNATURE_BYTES) throw badRequest('signature image is too large');

    // Sniffed, not trusted: the stored MIME type is what lets the PDF embed it.
    const mimeType = sniffImageMime(data);
    if (!mimeType) throw badRequest('a signature must be a JPEG or PNG image');

    const created = await this.prisma.settlementSignature.create({
      data: {
        tenantId: input.tenantId,
        driverId: input.driverId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        periodLabel: input.periodLabel,
        role,
        signerName,
        mimeType,
        sizeBytes: data.length,
        data,
        capturedById: input.capturedById ?? null,
      },
    });
    return {
      id: created.id,
      driverId: created.driverId,
      role: created.role,
      signerName: created.signerName,
      signedAt: created.signedAt.toISOString(),
      sizeBytes: created.sizeBytes,
    };
  }

  async listSignatures(
    tenantId: string,
    driverId: string,
    period?: SettlementPeriod,
  ): Promise<SettlementSignatureRow[]> {
    const rows = await this.prisma.settlementSignature.findMany({
      where: {
        tenantId,
        driverId,
        ...(period ? { periodFrom: period.from, periodTo: period.to } : {}),
      },
      orderBy: { signedAt: 'asc' },
      select: { id: true, driverId: true, role: true, signerName: true, signedAt: true, sizeBytes: true },
    });
    return rows.map((row) => ({
      id: row.id,
      driverId: row.driverId,
      role: row.role,
      signerName: row.signerName,
      signedAt: row.signedAt.toISOString(),
      sizeBytes: row.sizeBytes,
    }));
  }

  /** The drawn bytes for a set of signature rows, for embedding in the PDF. */
  private async signatureImages(
    tenantId: string,
    ids: string[],
  ): Promise<Array<{ role: string; signerName: string; signedAt: Date; data: Buffer; mimeType: string }>> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.settlementSignature.findMany({
      where: { tenantId, id: { in: ids } },
      select: { role: true, signerName: true, signedAt: true, data: true, mimeType: true },
    });
    return rows.map((row) => ({
      role: row.role,
      signerName: row.signerName,
      signedAt: row.signedAt,
      data: row.data as Buffer,
      mimeType: row.mimeType,
    }));
  }
}
