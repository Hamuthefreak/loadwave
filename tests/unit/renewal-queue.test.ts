import {
  describeFlush,
  kindSkipHook,
  supersededBy,
  type OnFile,
  type RenewalDraft,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/renewalQueue';

/**
 * The one rule that only applies to documents: a renewal the office has since
 * matched or beaten must not be sent, because writing an older expiry back over
 * a good one would put the document into review again.
 *
 * Everything mechanical — the device, the retry, telling a dropped connection
 * apart from a refusal — is pinned in pending-queue.test.ts. What is left here
 * is the decision itself and the memoisation that keeps it to one read of the
 * driver's file per document kind.
 */

function draft(overrides: Partial<RenewalDraft> = {}): RenewalDraft {
  return {
    kind: 'CDL',
    label: 'CDL / licence',
    identifier: 'L-1002',
    expiresAt: '2027-04-21',
    photo: null,
    fileName: null,
    mimeType: null,
    ...overrides,
  };
}

function onFile(overrides: Partial<OnFile> = {}): OnFile {
  return { expiresAt: '2026-10-25T00:00:00.000Z', hasFile: false, pendingReview: false, ...overrides };
}

describe('supersededBy', () => {
  it('sends when nothing is on file', () => {
    expect(supersededBy(draft(), null)).toBe(false);
  });

  it('drops a copy the office has already matched or beaten', () => {
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2027-04-21' }))).toBe(true);
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2027-05-01' }))).toBe(true);
  });

  it('sends a newer date than the one on file', () => {
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: '2026-10-25' }))).toBe(false);
  });

  it('sends when there is no date to compare', () => {
    // A renewal with no expiry is still a driver saying "the new card is here".
    expect(supersededBy(draft({ expiresAt: null }), onFile())).toBe(false);
    expect(supersededBy(draft({ expiresAt: '2027-04-21' }), onFile({ expiresAt: null }))).toBe(false);
  });

  it('sends a photo the office does not have, whatever the date says', () => {
    // The photograph is the point: the office was missing the scan, not the
    // date, and a later date typed in by hand does not supply the scan.
    const withPhoto = draft({ photo: new Blob(['x']), fileName: 'card.jpg', mimeType: 'image/jpeg' });
    const filedLater = { expiresAt: '2028-01-01T00:00:00.000Z', pendingReview: false };
    expect(supersededBy(withPhoto, onFile({ ...filedLater, hasFile: false }))).toBe(false);
    // With the scan already on file too, the date is the only thing left to decide.
    expect(supersededBy(withPhoto, onFile({ ...filedLater, hasFile: true }))).toBe(true);
  });
});

describe('kindSkipHook', () => {
  it('reads what is on file once per document kind, not once per renewal', async () => {
    const readKinds: string[] = [];
    const skip = kindSkipHook(async (kind) => {
      readKinds.push(kind);
      return onFile({ expiresAt: '2027-09-01', hasFile: true });
    });
    expect(await skip(draft())).toBe(true);
    expect(await skip(draft({ identifier: 'L-1003' }))).toBe(true);
    expect(await skip(draft({ kind: 'MEDICAL_CARD', expiresAt: '2028-01-01' }))).toBe(false);
    expect(readKinds).toEqual(['CDL', 'MEDICAL_CARD']);
  });

  it('treats a file that cannot be read as nothing on file, and still sends', async () => {
    const skip = kindSkipHook(async () => null);
    expect(await skip(draft())).toBe(false);
  });
});

describe('describeFlush', () => {
  it('says nothing when nothing happened', () => {
    expect(describeFlush({ sent: [], skipped: [] })).toBeNull();
  });

  it('says what went, and that it is still only a request', () => {
    expect(describeFlush({ sent: [draft()], skipped: [] })).toMatch(/went to the office/);
    expect(describeFlush({ sent: [draft()], skipped: [] })).toMatch(/confirm it/);
  });

  it('counts more than one', () => {
    expect(describeFlush({ sent: [draft(), draft()], skipped: [] })).toMatch(/2 renewals/);
  });

  it('says so when the only thing waiting was already on file', () => {
    expect(describeFlush({ sent: [], skipped: [draft()] })).toMatch(/already had that document/i);
  });

  it('mentions the dropped copy when some went and some did not', () => {
    const message = describeFlush({ sent: [draft()], skipped: [draft()] });
    expect(message).toMatch(/went to the office/);
    expect(message).toMatch(/already on file/);
  });
});
