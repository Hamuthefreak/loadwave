import type { PrismaClient } from '@prisma/client';
import type { PrismaTx } from '../../db/prisma';
import { badRequest, unprocessable } from '../../utils/errors';
import { quarterOf } from '../../utils/quarters';
import type { EventBus } from '../../events/event-bus';
import { EVENTS, HOSLogUpdated, RouteSegmentBatchCompleted } from '../../events/domain-events';
import { isOnDutyStatus, normalizeDutyStatus, type DutyStatusKey } from './eld.policy';
import type { RouteGeometryService } from '../postgis/postgis.service';

export type EldEventType = 'GPS' | 'DUTY_CHANGE';

export interface EldEventInput {
  sourceEventId: string;
  driverEldId: string;
  deviceId?: string | null;
  eventType: EldEventType;
  occurredAt: Date | string;
  lat?: number | null;
  lon?: number | null;
  speed?: number | string | null;
  engineHours?: number | string | null;
  vehicleDistance?: number | string | null;
  vehicleDistanceUnit?: 'KM' | 'MI' | null;
  dutyStatus?: string | null;
}

export interface EldBatchInput {
  tenantId: string;
  ingestSource?: 'WEBHOOK' | 'REST_POLL' | 'MANUAL';
  events: EldEventInput[];
  buildRouteSegments?: boolean;
  /** Exclusive upper bound of the window used to rebuild route segments. */
  segmentWindowEnd?: Date;
}

export interface EldBatchResult {
  driverId: string;
  assetId: string | null;
  routePointsInserted: number;
  routePointsSkippedDup: number;
  hosSegmentsCreated: number;
  hosSegmentsUpdated: number;
  routeSegmentsBuilt: number;
  dedupedDutyChanges: number;
}

interface ResolvedEntities {
  driver: { id: string };
  asset: { id: string; assetType: string } | null;
}

export interface EldIngestService {
  ingestBatch(input: EldBatchInput): Promise<EldBatchResult>;
}

export class PrismaEldIngestService implements EldIngestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
    private readonly geometry: RouteGeometryService,
  ) {}

  async ingestBatch(input: EldBatchInput): Promise<EldBatchResult> {
    if (!input.events.length) throw badRequest('events array must not be empty');

    const { driver, asset } = await this.resolveEntities(input);
    const ingestSource = input.ingestSource ?? 'WEBHOOK';

    const gpsEvents = input.events
      .filter((e) => e.eventType === 'GPS')
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const dutyEvents = input.events
      .filter((e) => e.eventType === 'DUTY_CHANGE')
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const [pointsResult, hosResult] = await this.prisma.$transaction(async (tx) => {
      const pointRows =
        gpsEvents.length && asset
          ? gpsEvents.map((e) => ({
              tenantId: input.tenantId,
              driverId: driver.id,
              assetId: asset.id,
              occurredAt: new Date(e.occurredAt),
              lat: e.lat ?? 0,
              lon: e.lon ?? 0,
              engineHours:
                e.engineHours !== null && e.engineHours !== undefined ? String(e.engineHours) : null,
              vehicleDistanceKm: this.normalizeDistance(e.vehicleDistance, e.vehicleDistanceUnit),
              speed: e.speed !== null && e.speed !== undefined ? String(e.speed) : null,
              eldEventType: e.eventType,
              sourceEventId: e.sourceEventId,
            }))
          : [];

      const pointCreate = pointRows.length
        ? await tx.routePoint.createMany({ data: pointRows, skipDuplicates: true })
        : { count: 0 };

      const duty = await this.upsertDutySegments(
        tx,
        input.tenantId,
        driver.id,
        asset?.id ?? null,
        dutyEvents,
        ingestSource,
      );

      return [
        {
          stored: pointCreate.count,
          skipped: Math.max(0, pointRows.length - pointCreate.count),
        },
        duty,
      ];
    });

    let routeSegmentsBuilt = 0;
    if (input.buildRouteSegments && asset && gpsEvents.length) {
      const toDate = (v: Date | string): Date => new Date(v);
      const start = toDate(gpsEvents[0].occurredAt);
      const endOfPoints = toDate(gpsEvents[gpsEvents.length - 1].occurredAt);
      const windowEnd = input.segmentWindowEnd ?? new Date(endOfPoints.getTime() + 15 * 60 * 1000);
      routeSegmentsBuilt = await this.geometry.buildSegmentsForPeriod({
        tenantId: input.tenantId,
        assetId: asset.id,
        driverId: driver.id,
        start,
        windowEnd,
        gapMinutes: 15,
      });
      const quarter = quarterOf(windowEnd);
      await this.bus.publish(
        EVENTS.ROUTE_SEGMENT_BATCH_COMPLETED,
        new RouteSegmentBatchCompleted({
          tenantId: input.tenantId,
          assetId: asset.id,
          driverId: driver.id,
          quarter,
          segmentCount: routeSegmentsBuilt,
        }).payload,
      );
    }

    if (hosResult.segmentsCreated > 0 || hosResult.segmentsUpdated > 0) {
      await this.bus.publish(
        EVENTS.HOS_LOG_UPDATED,
        new HOSLogUpdated({
          tenantId: input.tenantId,
          driverId: driver.id,
          recordedSegments: hosResult.segmentsCreated,
          asOf: new Date(),
        }).payload,
      );
    }

    return {
      driverId: driver.id,
      assetId: asset?.id ?? null,
      routePointsInserted: pointsResult.stored,
      routePointsSkippedDup: pointsResult.skipped,
      hosSegmentsCreated: hosResult.segmentsCreated,
      hosSegmentsUpdated: hosResult.segmentsUpdated,
      routeSegmentsBuilt,
      dedupedDutyChanges: hosResult.deduped,
    };
  }

  private async resolveEntities(input: EldBatchInput): Promise<ResolvedEntities> {
    if (!input.tenantId) throw badRequest('tenantId is required');
    const driver = await this.prisma.driver.findFirst({
      where: { tenantId: input.tenantId, externalEldId: input.events[0].driverEldId },
    });
    if (!driver) throw unprocessable('driver not found for externalEldId');

    const firstDeviceId = input.events.find((e) => e.deviceId)?.deviceId;
    let asset: ResolvedEntities['asset'] = null;
    if (firstDeviceId) {
      asset =
        (await this.prisma.asset.findFirst({
          where: { tenantId: input.tenantId, eldDeviceId: firstDeviceId },
          select: { id: true, assetType: true },
        })) ?? null;
    }
    if (input.events.some((e) => e.eventType === 'GPS') && !asset) {
      throw unprocessable('asset not found for ELD device; register the device on the asset first');
    }
    return { driver, asset };
  }

  private normalizeDistance(value?: number | string | null, unit?: 'KM' | 'MI' | null): string | null {
    if (value === null || value === undefined) return null;
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (unit === 'MI') return String(v * 1.609344);
    return String(v);
  }

  private async upsertDutySegments(
    tx: PrismaTx,
    tenantId: string,
    driverId: string,
    assetId: string | null,
    dutyEvents: EldEventInput[],
    ingestSource: string,
  ): Promise<{ segmentsCreated: number; segmentsUpdated: number; deduped: number }> {
    if (!dutyEvents.length) return { segmentsCreated: 0, segmentsUpdated: 0, deduped: 0 };

    const prev = await tx.hosLog.findFirst({
      where: { tenantId, driverId, endTime: null },
      orderBy: { startTime: 'desc' },
    });

    let segmentsUpdated = 0;
    if (prev) {
      const firstTime = new Date(dutyEvents[0].occurredAt);
      if (prev.startTime.getTime() < firstTime.getTime()) {
        await tx.hosLog.update({
          where: { id: prev.id },
          data: { endTime: firstTime },
        });
        segmentsUpdated += 1;
      }
    }

    const fresh = dutyEvents.map((e) => ({ time: new Date(e.occurredAt), event: e }));
    const telemetry = new Map<number, EldEventInput>(fresh.map((f, i) => [i, f.event]));

    const rows: Array<{
      tenantId: string;
      driverId: string;
      assetId: string | null;
      dutyStatus: DutyStatusKey;
      startTime: Date;
      endTime: Date | null;
      engineHoursStart: string | null;
      vehicleDistanceStart: string | null;
      sourceEventId: string;
      ingestSource: string;
    }> = [];

    fresh.forEach((f, i) => {
      const next = fresh[i + 1];
      const tele = telemetry.get(i);
      rows.push({
        tenantId,
        driverId,
        assetId,
        dutyStatus: normalizeDutyStatus(tele?.dutyStatus ?? f.event.dutyStatus),
        startTime: f.time,
        endTime: next ? next.time : null,
        engineHoursStart: this.normalizeDistance(tele?.engineHours, null) ?? null,
        vehicleDistanceStart:
          this.normalizeDistance(tele?.vehicleDistance, tele?.vehicleDistanceUnit) ?? null,
        sourceEventId: f.event.sourceEventId,
        ingestSource,
      });
    });

    const seeded = await tx.hosLog.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return { segmentsCreated: seeded.count, segmentsUpdated, deduped: fresh.length - seeded.count };
  }
}

export { isOnDutyStatus };
