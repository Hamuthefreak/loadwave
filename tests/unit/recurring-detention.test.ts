import { detentionAmount, detentionMinutes } from '../../src/modules/detention/detention.service';
import { nextRecurrenceDate, parseRecurringDays, toIsoWeekday } from '../../src/utils/recurring';

describe('detention math', () => {
  it('counts minutes between start and stop', () => {
    const start = new Date('2026-09-07T10:00:00Z');
    const end = new Date('2026-09-07T11:30:00Z');
    expect(detentionMinutes(start, end)).toBe(90);
  });

  it('counts an open clock up to now', () => {
    const start = new Date(Date.now() - 45 * 60 * 1000);
    const minutes = detentionMinutes(start, null);
    expect(minutes).toBeGreaterThanOrEqual(44);
    expect(minutes).toBeLessThanOrEqual(46);
  });

  it('never goes negative', () => {
    const start = new Date('2026-09-07T12:00:00Z');
    const end = new Date('2026-09-07T11:00:00Z');
    expect(detentionMinutes(start, end)).toBe(0);
  });

  it('bills minutes × hourly rate, rounded to the cent', () => {
    expect(detentionAmount(90, 60)).toBe(90);
    expect(detentionAmount(30, 55)).toBe(27.5);
    expect(detentionAmount(45, 47.31)).toBeCloseTo(35.48, 2);
  });

  it('returns null without a rate (free waiting time)', () => {
    expect(detentionAmount(60, null)).toBeNull();
  });
});

describe('recurring schedules', () => {
  it('parses and validates day lists', () => {
    expect(parseRecurringDays('1,4')).toEqual([1, 4]);
    expect(parseRecurringDays(' 7 , 2 ')).toEqual([7, 2]);
    expect(parseRecurringDays('0,8,x,')).toEqual([]);
    expect(parseRecurringDays(null)).toEqual([]);
  });

  it('maps Sunday to ISO 7', () => {
    expect(toIsoWeekday(new Date('2026-09-06T12:00:00Z'))).toBe(7); // Sunday
    expect(toIsoWeekday(new Date('2026-09-07T12:00:00Z'))).toBe(1); // Monday
  });

  it('finds the next scheduled weekday strictly after the fire date', () => {
    // Monday 2026-09-07 → next Mon/Thu occurrence is Thursday the 10th.
    const next = nextRecurrenceDate([1, 4], new Date('2026-09-07T10:00:00Z'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('skips forward a full week when the next day is the same weekday', () => {
    const next = nextRecurrenceDate([1], new Date('2026-09-07T10:00:00Z'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-14');
  });

  it('returns null with no scheduled days', () => {
    expect(nextRecurrenceDate([], new Date())).toBeNull();
  });
});
