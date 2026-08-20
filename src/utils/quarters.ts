export type Quarter = `20${string}-Q${1 | 2 | 3 | 4}`;

export function quarterOf(d: Date): Quarter {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}` as Quarter;
}

export function currentQuarter(now: Date = new Date()): Quarter {
  return quarterOf(now);
}

/**
 * Inclusive start / exclusive end bounds for an IFTA quarter.
 * Quarters align to the calendar year used by QC CAZ-510 and Ontario IFTA schedules.
 */
export function quarterRange(quarter: Quarter): { start: Date; end: Date } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Invalid quarter: ${quarter}`);
  const year = Number(match[1]);
  const q = Number(match[2]);
  const startMonth = (q - 1) * 3;
  const start = Date.UTC(year, startMonth, 1);
  const end = Date.UTC(year, startMonth + 3, 1);
  return { start: new Date(start), end: new Date(end) };
}

export function sameQuarter(a: Date, b: Date): boolean {
  return quarterOf(a) === quarterOf(b);
}
