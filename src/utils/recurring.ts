/**
 * Recurring-load schedule helpers (pure, unit-tested).
 * Weekdays are ISO: 1=Monday … 7=Sunday, matching Load.recurringDays ("1,4").
 */

export function parseRecurringDays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

export function toIsoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/**
 * The next scheduled weekday strictly after `from` (so a load posted on a
 * scheduled day repeats the following week, not the same day).
 */
export function nextRecurrenceDate(days: number[], from: Date): Date | null {
  if (days.length === 0) return null;
  for (let i = 1; i <= 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (days.includes(toIsoWeekday(d))) {
      // Keep the same time-of-day as `from` — the sweep decides clock time.
      return d;
    }
  }
  return null;
}
