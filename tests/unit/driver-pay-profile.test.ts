import { assertPayProfile } from '../../src/modules/drivers/driver.service';

/**
 * A pay profile is what turns delivered loads into money owed. These rules exist
 * so a half-filled form can never reach the settlement engine, where a missing
 * rate would silently pay a driver $0.00 for real hauls.
 */
describe('driver pay profile', () => {
  it('accepts a complete profile', () => {
    expect(assertPayProfile('PER_MILE', 0.58, null)).toEqual({ payModel: 'PER_MILE', payRate: 0.58 });
    expect(assertPayProfile('PERCENT_REVENUE', 27, null)).toEqual({ payModel: 'PERCENT_REVENUE', payRate: 27 });
    expect(assertPayProfile('FLAT_PER_LOAD', 0, null)).toEqual({ payModel: 'FLAT_PER_LOAD', payRate: 0 });
  });

  it('rejects a model with no rate instead of defaulting one', () => {
    expect(() => assertPayProfile('PER_MILE', null, null)).toThrow(/pay rate is required/i);
  });

  it('rejects an unknown model', () => {
    expect(() => assertPayProfile('HOURLY', 25, null)).toThrow(/unknown pay model/i);
  });

  it('rejects a rate that is not money', () => {
    expect(() => assertPayProfile('PER_MILE', -1, null)).toThrow(/zero or more/i);
    expect(() => assertPayProfile('PER_MILE', Number.NaN, null)).toThrow(/zero or more/i);
  });

  it('rejects a revenue share above 100%', () => {
    expect(() => assertPayProfile('PERCENT_REVENUE', 140, null)).toThrow(/cannot exceed 100%/i);
    // Every other model has no such ceiling.
    expect(assertPayProfile('FLAT_PER_LOAD', 140, null).payRate).toBe(140);
  });

  it('clears the profile when both halves are null', () => {
    expect(assertPayProfile(null, null, 'PER_MILE')).toEqual({ payModel: null, payRate: null });
  });

  it('keeps the stored model when only a rate is sent', () => {
    expect(assertPayProfile(null, 0.72, 'PER_MILE')).toEqual({ payModel: 'PER_MILE', payRate: 0.72 });
  });

  it('refuses a rate with no model on file to attach it to', () => {
    expect(() => assertPayProfile(null, 0.72, null)).toThrow(/pay model is required/i);
  });
});
