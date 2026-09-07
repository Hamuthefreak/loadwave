import {
  LITRES_PER_GAL,
  mapLastStopToPrefill,
  mostCommonStopPrefill,
  sameJurisdictionStreak,
  type FuelStopRow,
  // @ts-ignore — jest transpiles this cross-package ESM import fine; the root
  // tsc program is CJS-first and flags the module kind. Harmless either way.
} from '../../web/src/utils/fuelPrefill';

describe('mapLastStopToPrefill', () => {
  it('returns null for an empty history', () => {
    expect(mapLastStopToPrefill(null)).toBeNull();
    expect(mapLastStopToPrefill(undefined)).toBeNull();
  });

  it('restores jurisdiction, currency and unit for a litres stop', () => {
    const last: FuelStopRow = {
      volumeLitres: '200',
      originalVolume: '200',
      originalVolumeUnit: 'L',
      transactionCurrency: 'USD',
      jurisdictionCode: 'ON',
    };
    const pre = mapLastStopToPrefill(last);
    expect(pre).toEqual({
      jurisdiction: 'ON',
      currency: 'USD',
      unit: 'L',
      volume: '',
      amount: '',
    });
  });

  it('restores gallons on a normal open but leaves volume blank (each fill differs)', () => {
    const last: FuelStopRow = {
      volumeLitres: '75.7082', // 20 US gallons
      originalVolume: '20',
      originalVolumeUnit: 'GAL',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'QC',
    };
    const pre = mapLastStopToPrefill(last);
    expect(pre?.unit).toBe('GAL');
    expect(pre?.volume).toBe('');
  });

  it('coerces unknown currencies to CAD', () => {
    const last: FuelStopRow = {
      volumeLitres: '100',
      originalVolume: '100',
      originalVolumeUnit: 'L',
      transactionCurrency: 'EUR',
      jurisdictionCode: 'QC',
    };
    expect(mapLastStopToPrefill(last)?.currency).toBe('CAD');
  });

  it('copies volume and amount for the repeat-last-stop chip', () => {
    const last: FuelStopRow = {
      volumeLitres: '250.5',
      originalVolume: '250.5',
      originalVolumeUnit: 'L',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'QC',
      amountTransaction: '330.75',
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.volume).toBe('250.5');
    expect(pre?.amount).toBe('330.8'); // round1
  });

  it('repeat chip converts a gallons stop to gallons and keeps the total', () => {
    const gal = 40;
    const last: FuelStopRow = {
      volumeLitres: String(gal * LITRES_PER_GAL),
      originalVolume: String(gal),
      originalVolumeUnit: 'GAL',
      transactionCurrency: 'USD',
      jurisdictionCode: 'NY',
      amountTransaction: '180.25',
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.unit).toBe('GAL');
    expect(Number(pre?.volume)).toBeCloseTo(gal, 1);
    expect(pre?.amount).toBe('180.3');
  });

  it('omits amount when the record has no total (normal prefill path)', () => {
    const last: FuelStopRow = {
      volumeLitres: '300',
      originalVolume: '300',
      originalVolumeUnit: 'L',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'ON',
      amountTransaction: null,
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.amount).toBe('');
  });
});

describe('mostCommonStopPrefill', () => {
  const stop = (jurisdictionCode: string, unit: 'L' | 'GAL' = 'L', volumeLitres = '100'): FuelStopRow => ({
    volumeLitres,
    originalVolume: volumeLitres,
    originalVolumeUnit: unit,
    transactionCurrency: 'CAD',
    jurisdictionCode,
  });

  it('returns null for an empty history', () => {
    expect(mostCommonStopPrefill([])).toBeNull();
    expect(mostCommonStopPrefill(null)).toBeNull();
  });

  it('uses the only stop when there is just one', () => {
    const pre = mostCommonStopPrefill([stop('ON')]);
    expect(pre?.jurisdiction).toBe('ON');
    expect(pre?.unit).toBe('L');
  });

  it('picks the most frequent jurisdiction, not the newest', () => {
    const stops = [stop('ON'), stop('QC'), stop('QC')]; // newest first
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('QC');
  });

  it('breaks ties toward the newest stop', () => {
    const stops = [stop('ON'), stop('QC')]; // 1 vs 1, ON is newest
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('ON');
  });

  it('separates combos by jurisdiction + unit (gallons are their own group)', () => {
    const stops = [stop('QC', 'GAL'), stop('QC', 'GAL'), stop('QC', 'L')];
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('QC');
    expect(pre?.unit).toBe('GAL');
  });
});

describe('sameJurisdictionStreak', () => {
  const stop = (jurisdictionCode: string): FuelStopRow => ({
    volumeLitres: '100',
    originalVolume: '100',
    originalVolumeUnit: 'L',
    transactionCurrency: 'CAD',
    jurisdictionCode,
  });

  it('returns null for too few stops', () => {
    expect(sameJurisdictionStreak([stop('ON'), stop('ON')], 3)).toBeNull();
    expect(sameJurisdictionStreak(null)).toBeNull();
  });

  it('flags a 3+ stop streak in one jurisdiction', () => {
    expect(sameJurisdictionStreak([stop('ON'), stop('ON'), stop('ON')])).toBe('ON');
    expect(sameJurisdictionStreak([stop('QC'), stop('QC'), stop('QC'), stop('QC')])).toBe('QC');
  });

  it('returns null when the streak is broken', () => {
    expect(sameJurisdictionStreak([stop('ON'), stop('QC'), stop('ON')])).toBeNull();
  });
});