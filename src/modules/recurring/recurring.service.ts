import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { nextRecurrenceDate, parseRecurringDays } from '../../utils/recurring';

/**
 * Recurring loads: clone any load whose recurrence is due into a fresh
 * OPEN/PRIVATE load (same lane, freight and schedule; no assignment, no
 * history), then push its next fire date to the following scheduled weekday.
 */
export async function runRecurrenceSweep(prisma: PrismaClient, logger: Logger, now: Date = new Date()): Promise<number> {
  const due = await prisma.load.findMany({
    where: { nextRecurrenceAt: { lte: now }, recurringDays: { not: null } },
    take: 100,
    orderBy: { nextRecurrenceAt: 'asc' },
  });
  let created = 0;

  for (const src of due) {
    try {
      const fireAt = src.nextRecurrenceAt ?? now;
      // Preserve the original pickup→delivery lead time on the clone.
      const leadMs = src.pickupDate && src.deliveryDate ? src.deliveryDate.getTime() - src.pickupDate.getTime() : null;

      await prisma.load.create({
        data: {
          tenantId: src.tenantId,
          originCountry: src.originCountry,
          originRegion: src.originRegion,
          destinationCountry: src.destinationCountry,
          destinationRegion: src.destinationRegion,
          originLocality: src.originLocality,
          destinationLocality: src.destinationLocality,
          originLat: src.originLat,
          originLon: src.originLon,
          destinationLat: src.destinationLat,
          destinationLon: src.destinationLon,
          equipmentType: src.equipmentType,
          pickupDate: fireAt,
          deliveryDate: leadMs != null ? new Date(fireAt.getTime() + leadMs) : null,
          pickupFlexible: src.pickupFlexible,
          distanceKmEstimate: src.distanceKmEstimate,
          weightKg: src.weightKg,
          commodity: src.commodity,
          hazmat: src.hazmat,
          temperatureMin: src.temperatureMin,
          temperatureMax: src.temperatureMax,
          teamRequired: src.teamRequired,
          detentionRate: src.detentionRate,
          accessorials: src.accessorials ?? undefined,
          stopCount: src.stopCount,
          freightCurrency: src.freightCurrency,
          freightAmountTransaction: src.freightAmountTransaction ?? undefined,
          freightAmountBase: src.freightAmountBase ?? undefined,
          exchangeRateToBase: src.exchangeRateToBase,
          isInternational: src.isInternational,
          isContinuousInboundOutbound: src.isContinuousInboundOutbound,
          interliningPartner: src.interliningPartner,
          recurringDays: src.recurringDays,
          nextRecurrenceAt: nextRecurrenceDate(parseRecurringDays(src.recurringDays), fireAt),
        },
      });

      await prisma.load.update({
        where: { id: src.id },
        data: { nextRecurrenceAt: nextRecurrenceDate(parseRecurringDays(src.recurringDays), fireAt) },
      });
      created += 1;
    } catch (err) {
      // Skip forward so one bad row can't wedge the sweep.
      logger.warn({ err, loadId: src.id }, 'recurrence clone failed');
      await prisma.load
        .update({
          where: { id: src.id },
          data: { nextRecurrenceAt: nextRecurrenceDate(parseRecurringDays(src.recurringDays), now) },
        })
        .catch(() => undefined);
    }
  }
  return created;
}
