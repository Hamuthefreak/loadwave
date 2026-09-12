/**
 * FMCSA parsing and the verified/self-declared distinction.
 *
 * This is the module that decides whether a badge says "checked" or
 * "declared", so it is tested against the payload shapes FMCSA actually
 * returns — including the ones that would otherwise quietly produce a
 * confident-looking carrier object out of nothing.
 */
import {
  FMCSA_FRESH_DAYS,
  deriveStatus,
  extractCarrier,
  mapCarrier,
  normalizeDot,
  normalizeMcNumber,
  verificationState,
} from '../../src/modules/trust/fmcsa.policy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-12T12:00:00Z');

describe('normalizeDot', () => {
  it('pulls digits out of how people actually write it', () => {
    expect(normalizeDot('USDOT 1234567')).toBe('1234567');
    expect(normalizeDot(' 1234567 ')).toBe('1234567');
    expect(normalizeDot('dot#1234567')).toBe('1234567');
  });

  it('drops leading zeros but keeps a usable number', () => {
    expect(normalizeDot('000123')).toBe('123');
    expect(normalizeDot('0000')).toBe('0');
  });

  it('rejects empty, non-numeric and absurdly long values', () => {
    expect(normalizeDot(null)).toBeNull();
    expect(normalizeDot('')).toBeNull();
    expect(normalizeDot('MC-ABC')).toBeNull();
    expect(normalizeDot('1234567890123')).toBeNull();
  });
});

describe('extractCarrier', () => {
  const carrier = { dotNumber: 1234567, legalName: 'Acme Freight Inc' };

  it('handles the object wrapper', () => {
    expect(extractCarrier({ content: { carrier } })).toEqual(carrier);
  });

  it('handles the array wrapper — the same endpoint returns both shapes', () => {
    expect(extractCarrier({ content: [{ carrier }] })).toEqual(carrier);
  });

  it('handles a bare carrier object', () => {
    expect(extractCarrier({ carrier })).toEqual(carrier);
    expect(extractCarrier(carrier)).toEqual(carrier);
  });

  it('returns null rather than inventing a carrier from junk', () => {
    expect(extractCarrier(null)).toBeNull();
    expect(extractCarrier('nope')).toBeNull();
    expect(extractCarrier({})).toBeNull();
    expect(extractCarrier({ content: [] })).toBeNull();
    expect(extractCarrier({ content: { unrelated: true } })).toBeNull();
  });
});

describe('deriveStatus', () => {
  it('treats a not-allowed carrier as not allowed even when the record is open', () => {
    expect(deriveStatus({ allowedToOperate: 'N', statusCode: 'A' })).toBe('NOT_ALLOWED');
    expect(deriveStatus({ allowedToOperate: 'n' })).toBe('NOT_ALLOWED');
  });

  it('reads the active flags', () => {
    expect(deriveStatus({ allowedToOperate: 'Y' })).toBe('ACTIVE');
    expect(deriveStatus({ statusCode: 'I' })).toBe('INACTIVE');
  });

  it('refuses to guess when the record carries no operating flag', () => {
    expect(deriveStatus({})).toBe('UNKNOWN');
    expect(deriveStatus({ allowedToOperate: undefined, statusCode: undefined })).toBe('UNKNOWN');
    expect(deriveStatus({ allowedToOperate: '?' , statusCode: '?' })).toBe('UNKNOWN');
  });
});

describe('normalizeMcNumber', () => {
  it('takes a plain value, a number, or a docket array', () => {
    expect(normalizeMcNumber('MC123')).toBe('MC123');
    expect(normalizeMcNumber(123456)).toBe('123456');
    expect(normalizeMcNumber([{ mcNumber: 'MC999' }])).toBe('MC999');
  });

  it('returns null when there is nothing to read', () => {
    expect(normalizeMcNumber(undefined)).toBeNull();
    expect(normalizeMcNumber([{ other: 1 }])).toBeNull();
  });
});

describe('mapCarrier', () => {
  it('maps a realistic QCMobile payload', () => {
    const mapped = mapCarrier({
      content: {
        carrier: {
          dotNumber: 1234567,
          legalName: 'NORTHLINE PARTNERS INC',
          dbaName: 'Northline',
          mcNumber: 'MC188421',
          allowedToOperate: 'Y',
          statusCode: 'A',
        },
      },
    });
    expect(mapped).toEqual({
      dotNumber: '1234567',
      legalName: 'NORTHLINE PARTNERS INC',
      dbaName: 'Northline',
      mcNumber: 'MC188421',
      status: 'ACTIVE',
      allowedToOperate: 'Y',
      statusCode: 'A',
    });
  });

  it('returns null when there is no usable DOT number', () => {
    expect(mapCarrier({ content: { carrier: { legalName: 'No DOT' } } })).toBeNull();
  });
});

describe('verificationState', () => {
  const base = {
    mcNumber: 'MC1',
    usdotNumber: '1234567',
    checkStatus: null as string | null,
    checkedAt: null as Date | null,
    now: NOW,
    enabled: true,
  };

  it('is NONE without any number on file', () => {
    const v = verificationState({ ...base, mcNumber: null, usdotNumber: null });
    expect(v.state).toBe('NONE');
    expect(v.verified).toBe(false);
  });

  it('is DECLARED when we have never checked — with or without the check switched on', () => {
    const on = verificationState(base);
    expect(on.state).toBe('DECLARED');
    expect(on.verified).toBe(false);
    expect(on.note).toMatch(/not checked yet/i);

    const off = verificationState({ ...base, enabled: false });
    expect(off.state).toBe('DECLARED');
    expect(off.note).toMatch(/not checked/i);
  });

  it('is VERIFIED only on a fresh, successful, operating check', () => {
    const v = verificationState({ ...base, checkedAt: new Date(NOW.getTime() - 10 * DAY), checkStatus: 'ACTIVE' });
    expect(v.state).toBe('VERIFIED');
    expect(v.verified).toBe(true);
    expect(v.stale).toBe(false);
  });

  it('stops claiming verification once the check is stale', () => {
    const v = verificationState({
      ...base,
      checkedAt: new Date(NOW.getTime() - (FMCSA_FRESH_DAYS + 1) * DAY),
      checkStatus: 'ACTIVE',
    });
    expect(v.state).toBe('VERIFIED');
    expect(v.stale).toBe(true);
    // The badge must not read as a current pass.
    expect(v.verified).toBe(false);
  });

  it('is FAILED when FMCSA says the carrier may not operate', () => {
    expect(verificationState({ ...base, checkedAt: NOW, checkStatus: 'NOT_ALLOWED' }).state).toBe('FAILED');
    expect(verificationState({ ...base, checkedAt: NOW, checkStatus: 'INACTIVE' }).state).toBe('FAILED');
  });

  it('does not upgrade an inconclusive record to verified', () => {
    const v = verificationState({ ...base, checkedAt: NOW, checkStatus: 'UNKNOWN' });
    expect(v.state).toBe('DECLARED');
    expect(v.verified).toBe(false);
    expect(v.note).toMatch(/could not be confirmed/i);
  });
});
