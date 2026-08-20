import { d, maximum } from '../../utils/decimal';
import { isOnDutyStatus } from '../eld/eld.policy';

export type CycleType = 'CYCLE_1' | 'CYCLE_2';

export interface HosSegment {
  startTime: Date;
  endTime: Date | null;
  dutyStatus: string;
}

export const CYCLE_LIMITS = {
  CYCLE_1: { limit7: 70, limit14: null },
  CYCLE_2: { limit7: 70, limit14: 120 },
} as const;

export const CYCLE_RESET_HOURS = { CYCLE_1: 36, CYCLE_2: 72 } as const;

export const WARNING_THRESHOLD = 0.8;

/**
 * Overlap between a HOS segment and a sliding window, in hours.
 * Only on-duty statuses (DRIVING, ON_DUTY_NOT_DRIVING) count toward limits.
 */
export function onDutyHoursInWindow(segments: HosSegment[], windowStart: Date, windowEnd: Date): number {
  let totalMs = 0;
  for (const seg of segments) {
    if (!isOnDutyStatus(seg.dutyStatus)) continue;
    if ((seg.endTime ?? windowEnd).getTime() <= windowStart.getTime()) continue;
    if (seg.startTime.getTime() >= windowEnd.getTime()) continue;
    const start = maximum(d(seg.startTime.getTime()), d(windowStart.getTime()));
    const end = maximum(d(seg.endTime ? seg.endTime.getTime() : windowEnd.getTime()), start);
    const overlapMs = end.minus(start).toNumber();
    if (overlapMs > 0) totalMs += overlapMs;
  }
  return totalMs / 3_600_000;
}

/** True if any off-duty / sleeper-berth segment overlaps the window by >= hours. */
export function hasConsecutiveOffDuty(
  segments: HosSegment[],
  windowStart: Date,
  windowEnd: Date,
  hours: number,
): boolean {
  const thresholdMs = hours * 3_600_000;
  for (const seg of segments) {
    if (isOnDutyStatus(seg.dutyStatus)) continue;
    const start = new Date(Math.max(seg.startTime.getTime(), windowStart.getTime()));
    const rawEnd = seg.endTime ? seg.endTime.getTime() : windowEnd.getTime();
    const end = new Date(Math.min(rawEnd, windowEnd.getTime()));
    if (end.getTime() - start.getTime() >= thresholdMs) return true;
  }
  return false;
}

export interface CycleComputed {
  cycleType: CycleType;
  asOf: Date;
  onDutyHours7: number;
  onDutyHours14: number;
  limit7: number | null;
  limit14: number | null;
  remaining7: number | null;
  remaining14: number | null;
  has24hOffIn14: boolean;
  resetRequiresHours: number;
  violations: string[];
  warnings: string[];
}

const DAY = 24 * 3_600_000;

export function evaluateCycle(
  cycleType: CycleType,
  segments: HosSegment[],
  asOf: Date = new Date(),
): CycleComputed {
  const window7Start = new Date(asOf.getTime() - 7 * DAY);
  const window14Start = new Date(asOf.getTime() - 14 * DAY);

  const onDuty7 = onDutyHoursInWindow(segments, window7Start, asOf);
  const onDuty14 = onDutyHoursInWindow(segments, window14Start, asOf);

  const limits = CYCLE_LIMITS[cycleType];
  const has24hOffIn14 = hasConsecutiveOffDuty(segments, window14Start, asOf, 24);
  const resetRequiresHours = CYCLE_RESET_HOURS[cycleType];

  const violations: string[] = [];
  const warnings: string[] = [];

  if (cycleType === 'CYCLE_1') {
    if (onDuty7 > limits.limit7) {
      violations.push(`exceeded ${limits.limit7}h in rolling 7-day Cycle 1 window`);
    } else if (onDuty7 >= limits.limit7 * WARNING_THRESHOLD) {
      warnings.push(`approaching Cycle 1 7-day limit (${onDuty7.toFixed(1)}/70h)`);
    }
  } else {
    if (onDuty14 > CYCLE_LIMITS.CYCLE_2.limit14!) {
      violations.push(`exceeded ${CYCLE_LIMITS.CYCLE_2.limit14}h in rolling 14-day Cycle 2 window`);
    } else if (onDuty14 >= CYCLE_LIMITS.CYCLE_2.limit14! * WARNING_THRESHOLD) {
      warnings.push(
        `approaching Cycle 2 14-day limit (${onDuty14.toFixed(1)}/${CYCLE_LIMITS.CYCLE_2.limit14}h)`,
      );
    }
    if (onDuty7 > 70 && !has24hOffIn14) {
      violations.push('exceeded 70h in 7 days without 24h consecutive off-duty reset');
    } else if (onDuty7 >= 70 * WARNING_THRESHOLD && !has24hOffIn14) {
      warnings.push('approaching 70h in 7 days; 24h consecutive off-duty required');
    }
  }

  return {
    cycleType,
    asOf,
    onDutyHours7: onDuty7,
    onDutyHours14: onDuty14,
    limit7: limits.limit7,
    limit14: cycleType === 'CYCLE_1' ? null : CYCLE_LIMITS.CYCLE_2.limit14,
    remaining7: limits.limit7 !== null ? Math.max(0, limits.limit7 - onDuty7) : null,
    remaining14: cycleType === 'CYCLE_1' ? null : Math.max(0, CYCLE_LIMITS.CYCLE_2.limit14! - onDuty14),
    has24hOffIn14,
    resetRequiresHours,
    violations,
    warnings,
  };
}
