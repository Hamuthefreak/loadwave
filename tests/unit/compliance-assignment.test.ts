import {
  assignmentBlocks,
  assignmentWarnings,
  blockedMessage,
  describeFlag,
  MIN_OVERRIDE_REASON,
  overrideReasonIssue,
  overrideSnapshot,
  type ChecklistItem,
  type ComplianceFlag,
} from '../../src/modules/compliance/compliance.policy';

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    kind: 'CDL',
    label: 'CDL / licence',
    scope: 'DRIVER',
    required: true,
    reference: '49 CFR 383.153',
    status: 'OK',
    expiresAt: null,
    daysUntil: null,
    identifier: null,
    hasFile: true,
    documentId: 'doc-1',
    notes: null,
    pendingReview: false,
    ...overrides,
  };
}

describe('a document the holder uploaded but nobody confirmed', () => {
  it('blocks the assignment even though the date on it is fine', () => {
    // The whole point: a driver typing their own renewal date must not be the
    // way past the gate, because then the gate only stops honest mistakes.
    const items = [item({ kind: 'MEDICAL_CARD', label: 'Medical examiner\u2019s certificate', status: 'OK', pendingReview: true })];
    const blocks = assignmentBlocks(items, 'DRIVER', 'd1', 'Maria Chen');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.pendingReview).toBe(true);
    expect(describeFlag(blocks[0] as ComplianceFlag)).toBe(
      'Maria Chen — Medical examiner\u2019s certificate uploaded, awaiting confirmation',
    );
  });

  it('is not also reported as a warning, so it is not counted twice', () => {
    const items = [item({ status: 'EXPIRING', daysUntil: 10, pendingReview: true })];
    expect(assignmentWarnings(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(0);
    expect(assignmentBlocks(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(1);
  });

  it('tells the dispatcher to confirm rather than to renew', () => {
    const pending = assignmentBlocks(
      [item({ pendingReview: true, status: 'OK' })],
      'DRIVER',
      'd1',
      'Maria Chen',
    );
    expect(blockedMessage(pending)).toContain('Confirm it on the compliance page');

    const lapsed = assignmentBlocks(
      [item({ status: 'EXPIRED', daysUntil: -2 })],
      'DRIVER',
      'd1',
      'Maria Chen',
    );
    expect(blockedMessage(lapsed)).toContain('Renew it');

    // A batch with one of each is told the stronger remedy, since the lapse is
    // the part that cannot be fixed by looking at the screen.
    expect(blockedMessage([...pending, ...lapsed])).toContain('Renew it');
  });
});

describe('assignment gate', () => {
  it('stops a dispatch on a lapsed document, and says which one', () => {
    const items = [
      item({ kind: 'CDL', label: 'CDL / licence', status: 'EXPIRED', daysUntil: -3 }),
      item({ kind: 'MVR', label: 'Motor vehicle record', status: 'OK' }),
    ];
    const blocks = assignmentBlocks(items, 'DRIVER', 'd1', 'Maria Chen');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      pendingReview: false,
      subject: 'DRIVER',
      subjectId: 'd1',
      label: 'Maria Chen',
      kind: 'CDL',
      status: 'EXPIRED',
    });
    expect(describeFlag(blocks[0] as ComplianceFlag)).toBe('Maria Chen — CDL / licence expired 3 days ago');
  });

  it('does not stop a dispatch for paperwork that is simply not on file yet', () => {
    // A new carrier's vault starts empty. Blocking on absence would refuse every
    // assignment on day one and teach dispatch to work around the gate.
    const items = [
      item({ kind: 'MEDICAL_CARD', label: "Medical examiner's certificate", status: 'MISSING' }),
      item({ kind: 'ANNUAL_REVIEW', label: 'Annual driving record review', status: 'MISSING' }),
    ];
    expect(assignmentBlocks(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(0);
    expect(assignmentWarnings(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(2);
  });

  it('warns about an optional document that is missing, but not as a block', () => {
    const items = [item({ kind: 'HAZMAT_TRAINING', label: 'Hazmat endorsement / training', required: false, status: 'MISSING' })];
    expect(assignmentBlocks(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(0);
    expect(assignmentWarnings(items, 'DRIVER', 'd1', 'Maria Chen')).toHaveLength(0);
  });

  it('warns, but does not block, on a document inside the expiry window', () => {
    const items = [item({ kind: 'ANNUAL_INSPECTION', label: 'Annual inspection', scope: 'ASSET', status: 'EXPIRING', daysUntil: 4 })];
    expect(assignmentBlocks(items, 'ASSET', 'a1', 'Unit 4021')).toHaveLength(0);
    const warnings = assignmentWarnings(items, 'ASSET', 'a1', 'Unit 4021');
    expect(warnings).toHaveLength(1);
    expect(describeFlag(warnings[0] as ComplianceFlag)).toBe('Unit 4021 — Annual inspection expires in 4 days');
  });

  it('names the first problem and counts the rest', () => {
    const flags: ComplianceFlag[] = [
      { subject: 'DRIVER', subjectId: 'd1', label: 'Maria', kind: 'CDL', itemLabel: 'CDL / licence', status: 'EXPIRED', expiresAt: null, daysUntil: -1, pendingReview: false },
      { subject: 'ASSET', subjectId: 'a1', label: 'Unit 42', kind: 'ANNUAL_INSPECTION', itemLabel: 'Annual inspection', status: 'EXPIRED', expiresAt: null, daysUntil: 0, pendingReview: false },
    ];
    const message = blockedMessage(flags);
    expect(message).toContain('Maria — CDL / licence expired 1 day ago');
    expect(message).toContain('(+1 more)');
    expect(message).toContain('override with a reason');
  });

  it('insists on a real reason for an override', () => {
    expect(overrideReasonIssue('')).not.toBeNull();
    expect(overrideReasonIssue(undefined)).not.toBeNull();
    expect(overrideReasonIssue('ok')).not.toBeNull();
    expect(overrideReasonIssue('   ')).not.toBeNull();
    // Just under the floor still fails; just over it passes.
    expect(overrideReasonIssue('a'.repeat(MIN_OVERRIDE_REASON - 1))).not.toBeNull();
    expect(overrideReasonIssue('a'.repeat(MIN_OVERRIDE_REASON))).toBeNull();
    expect(overrideReasonIssue('Delivering to a customer on a hard appointment')).toBeNull();
    expect(overrideReasonIssue(`  Driver emailed the renewal, card in cab  `)).toBeNull();
    expect(overrideReasonIssue('a'.repeat(1001))).not.toBeNull();
  });

  it('snapshots what was overridden, so a renewal does not erase the reason', () => {
    const flags = assignmentBlocks(
      [item({ status: 'EXPIRED', daysUntil: -2 })],
      'DRIVER',
      'd1',
      'Maria Chen',
    );
    const snapshot = overrideSnapshot(flags);
    expect(snapshot).toEqual([
      {
        subject: 'DRIVER',
        subjectId: 'd1',
        label: 'Maria Chen',
        kind: 'CDL',
        status: 'EXPIRED',
        expiresAt: null,
      },
    ]);
  });
});
