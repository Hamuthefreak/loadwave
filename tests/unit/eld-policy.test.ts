import { normalizeDutyStatus, normalizeVolumeLitres, isOnDutyStatus } from '../../src/modules/eld/eld.policy';

describe('ELD policy normalization', () => {
  it('maps vendor position codes to canonical duty statuses', () => {
    expect(normalizeDutyStatus('1')).toBe('OFF_DUTY');
    expect(normalizeDutyStatus('OD')).toBe('OFF_DUTY');
    expect(normalizeDutyStatus('2')).toBe('SLEEPER_BERTH');
    expect(normalizeDutyStatus('sb')).toBe('SLEEPER_BERTH');
    expect(normalizeDutyStatus('3')).toBe('DRIVING');
    expect(normalizeDutyStatus('driving')).toBe('DRIVING');
    expect(normalizeDutyStatus('4')).toBe('ON_DUTY_NOT_DRIVING');
    expect(normalizeDutyStatus('ON')).toBe('ON_DUTY_NOT_DRIVING');
  });

  it('rejects unknown status codes', () => {
    expect(() => normalizeDutyStatus('Z')).toThrow();
    expect(() => normalizeDutyStatus('')).toThrow();
    expect(() => normalizeDutyStatus(null)).toThrow();
  });

  it('marks DRIVING and ON_DUTY_NOT_DRIVING as on-duty', () => {
    expect(isOnDutyStatus('DRIVING')).toBe(true);
    expect(isOnDutyStatus('ON_DUTY_NOT_DRIVING')).toBe(true);
    expect(isOnDutyStatus('OFF_DUTY')).toBe(false);
    expect(isOnDutyStatus('SLEEPER_BERTH')).toBe(false);
  });

  it('converts US gallons to litres (1 US gal = 3.785411784 L)', () => {
    const r = normalizeVolumeLitres(100, 'GAL');
    expect(r.originalVolumeUnit).toBe('GAL');
    expect(Number(r.volumeLitres)).toBeCloseTo(378.5411784, 6);
  });

  it('keeps litres as-is when no unit is provided', () => {
    const r = normalizeVolumeLitres('150.5', undefined);
    expect(r.volumeLitres).toBe('150.5');
    expect(r.originalVolumeUnit).toBe('L');
  });
});
