import Decimal from 'decimal.js';

export { Decimal };

export type DecimalInput = Decimal.Value | Decimal | { toString(): string } | null | undefined;

export function d(v: DecimalInput): Decimal {
  if (v === null || v === undefined) return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === 'object') return new Decimal(String(v));
  return new Decimal(v as Decimal.Value);
}

export function toDb(v: Decimal | Decimal.Value): string {
  return new Decimal(v).toString();
}

export function isZero(v: DecimalInput): boolean {
  return d(v).eq(0);
}

export function tryParse(v: unknown, fallback = 0): Decimal {
  if (typeof v === 'number' && Number.isFinite(v)) return new Decimal(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return new Decimal(v);
  }
  if (v instanceof Decimal) return v;
  if (v && typeof (v as { toString?: unknown }).toString === 'function') {
    const s = (v as { toString(): string }).toString();
    if (s !== '' && Number.isFinite(Number(s))) return new Decimal(s);
  }
  return new Decimal(fallback);
}

export function gte(a: DecimalInput, b: DecimalInput): boolean {
  return d(a).gte(d(b));
}

export function lte(a: DecimalInput, b: DecimalInput): boolean {
  return d(a).lte(d(b));
}

export function sum(...values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0));
}

export function minimum(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.min(d(a), d(b));
}

export function maximum(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.max(d(a), d(b));
}
