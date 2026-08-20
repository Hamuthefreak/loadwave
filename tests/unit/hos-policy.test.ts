import {
  evaluateCycle,
  hasConsecutiveOffDuty,
  onDutyHoursInWindow,
  type HosSegment,
} from '../../src/modules/hos/hos.policy';

const HOUR = 3_600_000;

function seg(startDaysAgo: number, hours: number, status: string, asOf: Date): HosSegment {
  const end = startDaysAgo - hours / 24;
  return {
    startTime: new Date(asOf.getTime() - startDaysAgo * 24 * HOUR),
    endTime: new Date(asOf.getTime() - end * 24 * HOUR),
    dutyStatus: status,
  };
}

function hoursInSpan(segments: HosSegment[], spanDays: number, asOf: Date): number {
  return onDutyHoursInWindow(segments, new Date(asOf.getTime() - spanDays * 24 * HOUR), asOf);
}

describe('HOS policy', () => {
  const asOf = new Date('2026-06-01T12:00:00Z');

  it('counts only DRIVING and ON_DUTY_NOT_DRIVING toward on-duty hours', () => {
    const segments: HosSegment[] = [
      {
        startTime: new Date(asOf.getTime() - 6 * HOUR),
        endTime: new Date(asOf.getTime() - 4 * HOUR),
        dutyStatus: 'DRIVING',
      },
      {
        startTime: new Date(asOf.getTime() - 4 * HOUR),
        endTime: new Date(asOf.getTime() - 2 * HOUR),
        dutyStatus: 'OFF_DUTY',
      },
      { startTime: new Date(asOf.getTime() - 2 * HOUR), endTime: null, dutyStatus: 'ON_DUTY_NOT_DRIVING' },
    ];
    const hours = hoursInSpan(segments, 1, asOf);
    expect(hours).toBeCloseTo(4, 5);
  });

  it('clamps partial-on-duty segments to the window', () => {
    const segments: HosSegment[] = [
      {
        startTime: new Date(asOf.getTime() - 8 * 24 * HOUR),
        endTime: new Date(asOf.getTime() - 6 * 24 * HOUR),
        dutyStatus: 'DRIVING',
      },
    ];
    const hours = hoursInSpan(segments, 7, asOf);
    expect(hours).toBeCloseTo(24, 5);
  });

  it('flags a Cycle 1 violation above 70h in 7 days', () => {
    const segments: HosSegment[] = [seg(6.5, 71, 'DRIVING', asOf)];
    const cycle = evaluateCycle('CYCLE_1', segments, asOf);
    expect(cycle.onDutyHours7).toBeCloseTo(71, 5);
    expect(cycle.violations).toHaveLength(1);
    expect(cycle.remaining7).toBe(0);
    expect(cycle.resetRequiresHours).toBe(36);
  });

  it('warns as a Cycle 1 driver approaches the 7-day limit', () => {
    const segments: HosSegment[] = [seg(6.5, 56, 'DRIVING', asOf)];
    const cycle = evaluateCycle('CYCLE_1', segments, asOf);
    expect(cycle.violations).toHaveLength(0);
    expect(cycle.warnings.some((w) => w.includes('Cycle 1'))).toBe(true);
    expect(cycle.remaining7).toBeCloseTo(14, 5);
  });

  it('flags a Cycle 2 violation above 120h in 14 days', () => {
    const segments: HosSegment[] = [seg(13.5, 121, 'DRIVING', asOf)];
    const cycle = evaluateCycle('CYCLE_2', segments, asOf);
    expect(cycle.onDutyHours14).toBeCloseTo(121, 5);
    expect(cycle.violations.some((v) => v.includes('14-day'))).toBe(true);
    expect(cycle.resetRequiresHours).toBe(72);
  });

  it('Flags exceeding 70h in 7 days for Cycle 2 without a 24h reset', () => {
    const segments: HosSegment[] = [seg(6.5, 75, 'DRIVING', asOf)];
    const cycle = evaluateCycle('CYCLE_2', segments, asOf);
    expect(cycle.violations.some((v) => v.includes('24h consecutive off-duty'))).toBe(true);
  });

  it('does not flag 70h in 7 days for Cycle 2 when a 24h reset exists', () => {
    const segments: HosSegment[] = [seg(12.5, 24, 'OFF_DUTY', asOf), seg(11, 75, 'DRIVING', asOf)];
    const cycle = evaluateCycle('CYCLE_2', segments, asOf);
    expect(cycle.has24hOffIn14).toBe(true);
    expect(cycle.violations.some((v) => v.includes('24h consecutive'))).toBe(false);
  });

  it('recognises a 24h off-duty reset window via hasConsecutiveOffDuty', () => {
    const windowStart = new Date(asOf.getTime() - 14 * 24 * HOUR);
    const reset: HosSegment[] = [
      {
        startTime: new Date(asOf.getTime() - 5 * 24 * HOUR),
        endTime: new Date(asOf.getTime() - 4 * 24 * HOUR),
        dutyStatus: 'SLEEPER_BERTH',
      },
    ];
    expect(hasConsecutiveOffDuty(reset, windowStart, asOf, 24)).toBe(true);
    expect(hasConsecutiveOffDuty([] as HosSegment[], windowStart, asOf, 24)).toBe(false);
  });
});
