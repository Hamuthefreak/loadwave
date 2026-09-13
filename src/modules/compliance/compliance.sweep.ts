import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { NotificationService } from '../notification/notification.service';
import {
  EXPIRING_WINDOW_DAYS,
  daysUntil,
  documentStatus,
  specFor,
  type ComplianceSubject,
  type ComplianceStatus,
} from './compliance.policy';

/**
 * Announces documents that have entered their warning window or lapsed.
 *
 * The dedupe is the point: a document that is expiring for thirty days should
 * produce one notification when it starts warning and one when it expires — not
 * thirty identical mornings that the office learns to ignore. `notifiedStatus`
 * on the row records what was last said, and is cleared on renewal so next
 * year's lapse is announced too.
 */
export async function runComplianceSweep(
  prisma: PrismaClient,
  notifications: NotificationService,
  logger: Logger,
  now: Date = new Date(),
  warnDays: number = EXPIRING_WINDOW_DAYS,
): Promise<number> {
  const horizon = new Date(now.getTime() + warnDays * 86_400_000);

  const due = await prisma.complianceDocument.findMany({
    where: {
      expiresAt: { not: null, lte: horizon },
      subject: { in: ['DRIVER', 'ASSET', 'TENANT'] as ComplianceSubject[] },
    },
    select: {
      id: true,
      tenantId: true,
      subject: true,
      subjectId: true,
      kind: true,
      expiresAt: true,
      notifiedStatus: true,
    },
  });

  // Renewed since last warned: clear the marker so the next lapse announces.
  const renewed = await prisma.complianceDocument.updateMany({
    where: {
      notifiedStatus: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: horizon } }],
    },
    data: { notifiedStatus: null },
  });
  if (renewed.count > 0) {
    logger.info({ cleared: renewed.count }, 'compliance markers cleared after renewal');
  }

  interface Change {
    id: string;
    status: Exclude<ComplianceStatus, 'OK'>;
    subject: ComplianceSubject;
    subjectId: string;
    kind: string;
    days: number | null;
  }

  const byTenant = new Map<string, Change[]>();
  for (const row of due) {
    const status = documentStatus(row.expiresAt, now, warnDays);
    if (status === 'OK' || status === row.notifiedStatus) continue;
    const change: Change = {
      id: row.id,
      status,
      subject: row.subject as ComplianceSubject,
      subjectId: row.subjectId,
      kind: row.kind,
      days: daysUntil(row.expiresAt, now),
    };
    const list = byTenant.get(row.tenantId);
    if (list) list.push(change);
    else byTenant.set(row.tenantId, [change]);
  }

  if (byTenant.size === 0) return 0;

  // Names for the message: "Maria Chen" and "Unit 402" mean something, an id doesn't.
  const tenantIds = [...byTenant.keys()];
  const [drivers, assets] = await Promise.all([
    prisma.driver.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true, powerUnitNumber: true, vin: true },
    }),
  ]);
  const driverNames = new Map(drivers.map((d) => [d.id, d.name]));
  const assetNames = new Map(
    assets.map((a) => [a.id, a.powerUnitNumber ? `Unit ${a.powerUnitNumber}` : (a.vin ?? 'Unit')]),
  );

  let notified = 0;
  for (const [tenantId, changes] of byTenant) {
    const lines = changes.map((c) => {
      const label = specFor(c.kind)?.label ?? c.kind;
      const who =
        c.subject === 'DRIVER'
          ? (driverNames.get(c.subjectId) ?? 'A driver')
          : c.subject === 'ASSET'
            ? (assetNames.get(c.subjectId) ?? 'A unit')
            : 'Carrier';
      const when =
        c.status === 'EXPIRED'
          ? c.days === null || c.days === 0
            ? 'expired today'
            : `expired ${Math.abs(c.days)} day${Math.abs(c.days) === 1 ? '' : 's'} ago`
          : c.days === 0
            ? 'expires today'
            : `expires in ${c.days} day${c.days === 1 ? '' : 's'}`;
      return `${who} — ${label} ${when}`;
    });

    const expiredCount = changes.filter((c) => c.status === 'EXPIRED').length;
    const title =
      expiredCount > 0
        ? `${expiredCount} compliance document${expiredCount === 1 ? '' : 's'} expired`
        : `${changes.length} document${changes.length === 1 ? '' : 's'} expiring soon`;

    try {
      await notifications.notify({
        tenantId,
        kind: 'COMPLIANCE_EXPIRY',
        title,
        body: lines.join('\n'),
        link: '/app/compliance',
      });
      // Per-row status, since a tenant's batch can mix expiring and expired.
      for (const c of changes) {
        await prisma.complianceDocument.update({
          where: { id: c.id },
          data: { notifiedStatus: c.status },
        });
      }
      notified += changes.length;
    } catch (err) {
      logger.warn({ err, tenantId }, 'compliance expiry notification failed');
    }
  }

  return notified;
}
