import type { Quarter } from '../utils/quarters';

export const EVENTS = {
  LOAD_IMPORTED: 'LoadImported',
  HOS_LOG_UPDATED: 'HOSLogUpdated',
  ROUTE_POINT_INGESTED: 'RoutePointIngested',
  ROUTE_SEGMENT_BATCH_COMPLETED: 'RouteSegmentBatchCompleted',
  FUEL_TRANSACTION_IMPORTED: 'FuelTransactionImported',
  IFTA_QUARTER_COMPUTE_REQUESTED: 'IftaQuarterComputeRequested',
  IFTA_QUARTER_COMPUTED: 'IftaQuarterComputed',
} as const;

export interface DomainEvent<Payload> {
  name: string;
  payload: Payload;
  occurredAt: Date;
}

const occurred = (): Date => new Date();

export class LoadImported implements DomainEvent<LoadImportedPayload> {
  readonly name = EVENTS.LOAD_IMPORTED;
  readonly occurredAt = occurred();
  constructor(readonly payload: LoadImportedPayload) {}
}

export class HOSLogUpdated implements DomainEvent<HosLogUpdatedPayload> {
  readonly name = EVENTS.HOS_LOG_UPDATED;
  readonly occurredAt = occurred();
  constructor(readonly payload: HosLogUpdatedPayload) {}
}

export class RouteSegmentBatchCompleted implements DomainEvent<RouteSegmentBatchCompletedPayload> {
  readonly name = EVENTS.ROUTE_SEGMENT_BATCH_COMPLETED;
  readonly occurredAt = occurred();
  constructor(readonly payload: RouteSegmentBatchCompletedPayload) {}
}

export class FuelTransactionImported implements DomainEvent<FuelTransactionImportedPayload> {
  readonly name = EVENTS.FUEL_TRANSACTION_IMPORTED;
  readonly occurredAt = occurred();
  constructor(readonly payload: FuelTransactionImportedPayload) {}
}

export class IftaQuarterComputeRequested implements DomainEvent<IftaQuarterComputeRequestedPayload> {
  readonly name = EVENTS.IFTA_QUARTER_COMPUTE_REQUESTED;
  readonly occurredAt = occurred();
  constructor(readonly payload: IftaQuarterComputeRequestedPayload) {}
}

export class IftaQuarterComputed implements DomainEvent<IftaQuarterComputedPayload> {
  readonly name = EVENTS.IFTA_QUARTER_COMPUTED;
  readonly occurredAt = occurred();
  constructor(readonly payload: IftaQuarterComputedPayload) {}
}

export interface LoadImportedPayload {
  tenantId: string;
  loadId: string;
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  isInternational: boolean;
}

export interface HosLogUpdatedPayload {
  tenantId: string;
  driverId: string;
  recordedSegments: number;
  asOf: Date;
}

export interface RouteSegmentBatchCompletedPayload {
  tenantId: string;
  assetId: string;
  driverId: string | null;
  quarter: Quarter;
  segmentCount: number;
}

export interface FuelTransactionImportedPayload {
  tenantId: string;
  fuelTransactionId: string;
  assetId: string | null;
  quarter: Quarter;
  jurisdictionCode: string;
}

export interface IftaQuarterComputeRequestedPayload {
  tenantId: string;
  assetId: string | null;
  driverId: string | null;
  quarter: Quarter;
  reason: 'MANUAL' | 'ROUTE_BATCH' | 'FUEL_IMPORT';
}

export interface IftaQuarterComputedPayload {
  tenantId: string;
  quarter: Quarter;
  assetId: string | null;
  summaryCount: number;
  totalKm: string;
  netTaxDueBase: string;
}
