import { badRequest, unprocessable } from '../../utils/errors';
import type { Decimal } from '../../utils/decimal';

export type DutyStatusKey = 'OFF_DUTY' | 'SLEEPER_BERTH' | 'DRIVING' | 'ON_DUTY_NOT_DRIVING';

export const ON_DUTY_STATUSES: ReadonlySet<string> = new Set<DutyStatusKey>([
  'DRIVING',
  'ON_DUTY_NOT_DRIVING',
]);

export const DUTY_STATUS_VALUES: DutyStatusKey[] = [
  'OFF_DUTY',
  'SLEEPER_BERTH',
  'DRIVING',
  'ON_DUTY_NOT_DRIVING',
];

// Vendor agnostic mapping. Supports common codes used by certified ELD vendors
// (CCMTA Canadian ELD standard US/Canadian position codes) plus friendly names.
const DUTY_STATUS_ALIASES: Record<string, DutyStatusKey> = {
  '1': 'OFF_DUTY',
  OFF: 'OFF_DUTY',
  OFF_DUTY: 'OFF_DUTY',
  OD: 'OFF_DUTY',
  '2': 'SLEEPER_BERTH',
  SB: 'SLEEPER_BERTH',
  SLPR: 'SLEEPER_BERTH',
  SLEEPER: 'SLEEPER_BERTH',
  SLEEPER_BERTH: 'SLEEPER_BERTH',
  '3': 'DRIVING',
  D: 'DRIVING',
  DRV: 'DRIVING',
  DRIVING: 'DRIVING',
  '4': 'ON_DUTY_NOT_DRIVING',
  ON: 'ON_DUTY_NOT_DRIVING',
  OND: 'ON_DUTY_NOT_DRIVING',
  ON_DUTY_NOT_DRIVING: 'ON_DUTY_NOT_DRIVING',
};

export function normalizeDutyStatus(raw: string | null | undefined): DutyStatusKey {
  if (!raw) throw badRequest('dutyStatus is required for a duty change event');
  const key = String(raw).trim().toUpperCase();
  const mapped = DUTY_STATUS_ALIASES[key];
  if (!mapped) throw unprocessable(`unknown duty status code: ${raw}`);
  return mapped;
}

export function isOnDutyStatus(status: string): boolean {
  return ON_DUTY_STATUSES.has(status);
}

export const GAL_TO_LITRES = '3.785411784';

export function normalizeVolumeLitres(
  originalVolume?: Decimal | string | number | null,
  unit?: string | null,
): { volumeLitres: string | null; originalVolume: string | null; originalVolumeUnit: string | null } {
  if (originalVolume === null || originalVolume === undefined) {
    return { volumeLitres: null, originalVolume: null, originalVolumeUnit: null };
  }
  const value = String(originalVolume);
  const u = (unit ?? '').trim().toUpperCase();
  if (u === 'GAL' || u === 'GALLON' || u === 'USGAL') {
    return {
      volumeLitres: String(Number(value) * Number(GAL_TO_LITRES)),
      originalVolume: value,
      originalVolumeUnit: 'GAL',
    };
  }
  return { volumeLitres: value, originalVolume: value, originalVolumeUnit: u === '' ? 'L' : u };
}
