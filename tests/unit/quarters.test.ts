import { quarterOf, quarterRange, sameQuarter, type Quarter } from '../../src/utils/quarters';

describe('quarters', () => {
  it('computes the quarter for a date', () => {
    expect(quarterOf(new Date('2026-01-05T10:00:00Z'))).toBe('2026-Q1');
    expect(quarterOf(new Date('2026-04-30T10:00:00Z'))).toBe('2026-Q2');
    expect(quarterOf(new Date('2026-07-01T00:00:00Z'))).toBe('2026-Q3');
    expect(quarterOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-Q4');
  });

  it('returns inclusive start and exclusive end bounds', () => {
    const q1 = quarterRange('2026-Q1');
    expect(q1.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(q1.end.toISOString()).toBe('2026-04-01T00:00:00.000Z');

    const q4 = quarterRange('2026-Q4');
    expect(q4.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(q4.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects malformed quarters', () => {
    expect(() => quarterRange('2026-Q5' as Quarter)).toThrow();
    expect(() => quarterRange('Q1-2026' as Quarter)).toThrow();
    expect(() => quarterRange('potato' as Quarter)).toThrow();
  });

  it('compares quarters across dates', () => {
    expect(sameQuarter(new Date('2026-02-01T00:00:00Z'), new Date('2026-03-15T00:00:00Z'))).toBe(true);
    expect(sameQuarter(new Date('2026-03-31T12:00:00Z'), new Date('2026-04-01T00:00:00Z'))).toBe(false);
  });
});
