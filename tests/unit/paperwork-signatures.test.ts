import { latestSignaturePerRole } from '../../src/modules/documents/paperwork.service';

/**
 * A delivery packet goes to a broker or a factor. It may show one signature per
 * role: capturing a signature appends a row rather than replacing one, so a
 * receiver who signs twice (a corrected name, a re-drawn mark) would otherwise
 * print two conflicting receiver signatures on the same document.
 */
describe('latestSignaturePerRole', () => {
  const at = (iso: string) => new Date(iso);

  it('keeps the newest capture for a role and drops the superseded row', () => {
    const rows = [
      { role: 'RECEIVER', signerName: 'First Receiver', signedAt: at('2026-09-01T10:00:00Z') },
      { role: 'CARRIER', signerName: 'Maria Chen', signedAt: at('2026-09-01T10:05:00Z') },
      { role: 'RECEIVER', signerName: 'Second Receiver', signedAt: at('2026-09-01T11:00:00Z') },
    ];

    const result = latestSignaturePerRole(rows);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.role === 'RECEIVER')?.signerName).toBe('Second Receiver');
    expect(result.find((r) => r.role === 'CARRIER')?.signerName).toBe('Maria Chen');
  });

  it('does not let an older row overwrite a newer one when they arrive out of order', () => {
    const rows = [
      { role: 'RECEIVER', signerName: 'Newer', signedAt: at('2026-09-01T12:00:00Z') },
      { role: 'RECEIVER', signerName: 'Older', signedAt: at('2026-09-01T09:00:00Z') },
    ];

    expect(latestSignaturePerRole(rows)[0].signerName).toBe('Newer');
  });

  it('keeps every distinct role, so all three parties can each sign once', () => {
    const rows = [
      { role: 'CARRIER', signerName: 'Carrier', signedAt: at('2026-09-01T08:00:00Z') },
      { role: 'RECEIVER', signerName: 'Receiver', signedAt: at('2026-09-01T09:00:00Z') },
      { role: 'BROKER', signerName: 'Broker', signedAt: at('2026-09-01T10:00:00Z') },
    ];

    expect(latestSignaturePerRole(rows).map((r) => r.role)).toEqual(['CARRIER', 'RECEIVER', 'BROKER']);
  });

  it('breaks a same-timestamp tie toward the row written last', () => {
    const same = at('2026-09-01T10:00:00Z');
    const rows = [
      { role: 'RECEIVER', signerName: 'First', signedAt: same },
      { role: 'RECEIVER', signerName: 'Second', signedAt: same },
    ];

    expect(latestSignaturePerRole(rows)[0].signerName).toBe('Second');
  });

  it('leaves an empty or single-signature load untouched', () => {
    expect(latestSignaturePerRole([])).toEqual([]);
    const one = [{ role: 'RECEIVER', signerName: 'Dana', signedAt: at('2026-09-01T10:00:00Z') }];
    expect(latestSignaturePerRole(one)).toHaveLength(1);
  });
});
