import {
  COMPLIANCE_KINDS,
  COMPLIANCE_RANK,
  checklist,
  countStatuses,
  daysUntil,
  deriveExpiry,
  documentStatus,
  kindsFor,
  needsAttention,
  specFor,
  statusHeadline,
  subjectStatus,
  attentionSummary,
  type ChecklistItem,
} from '../../src/modules/compliance/compliance.policy';

const NOW = new Date('2026-09-13T12:00:00Z');

function at(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

function item(over: Partial<ChecklistItem>): ChecklistItem {
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
    hasFile: false,
    documentId: null,
    notes: null,
    ...over,
  };
}

describe('document expiry boundaries', () => {
  it('counts whole days to expiry, and negative once past', () => {
    expect(daysUntil(at(30), NOW)).toBe(30);
    expect(daysUntil(at(0), NOW)).toBe(0);
    expect(daysUntil(at(-1), NOW)).toBe(-1);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('not a date', NOW)).toBeNull();
  });

  it('warns inside the window, not on the boundary after it', () => {
    expect(documentStatus(at(31), NOW)).toBe('OK');
    expect(documentStatus(at(30), NOW)).toBe('EXPIRING');
    expect(documentStatus(at(1), NOW)).toBe('EXPIRING');
    // Due today is still a warning, not yet a violation.
    expect(documentStatus(at(0), NOW)).toBe('EXPIRING');
    expect(documentStatus(at(-1), NOW)).toBe('EXPIRED');
  });

  it('treats a document with no expiry as fine rather than guessing a date', () => {
    expect(documentStatus(null, NOW)).toBe('OK');
  });

  it('honours a custom warning window', () => {
    expect(documentStatus(at(45), NOW, 60)).toBe('EXPIRING');
    expect(documentStatus(at(45), NOW, 30)).toBe('OK');
  });

  it('derives an expiry only for documents whose cycle is set by rule', () => {
    expect(deriveExpiry('2026-01-15T00:00:00Z', 12)?.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(deriveExpiry('2026-01-15T00:00:00Z', null)).toBeNull();
    expect(deriveExpiry(null, 12)).toBeNull();
    // A CDL carries no rule-based validity — only the printed date counts.
    expect(specFor('CDL')?.validityMonths).toBeNull();
    expect(specFor('ANNUAL_REVIEW')?.validityMonths).toBe(12);
  });
});

describe('checklist', () => {
  it('lists every required driver kind and flags the absent ones', () => {
    const items = checklist('DRIVER', [{ kind: 'CDL', expiresAt: at(400) }], NOW);
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));

    expect(byKind.CDL.status).toBe('OK');
    expect(byKind.MEDICAL_CARD.status).toBe('MISSING');
    expect(byKind.ANNUAL_REVIEW.status).toBe('MISSING');
    // The optional road test isn't a gap just because nobody uploaded one.
    expect(byKind.ROAD_TEST.status).toBe('MISSING');
    expect(byKind.ROAD_TEST.required).toBe(false);
  });

  it('sorts worst-first so the urgent row is the one on screen', () => {
    const items = checklist(
      'DRIVER',
      [
        { kind: 'CDL', expiresAt: at(500) },
        { kind: 'MEDICAL_CARD', expiresAt: at(-3) },
        { kind: 'ANNUAL_REVIEW', expiresAt: at(10) },
      ],
      NOW,
    );
    // Ranks never interleave: every expired row precedes every gap, and so on.
    const ranks = items.map((i) => COMPLIANCE_RANK[i.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(items[0].kind).toBe('MEDICAL_CARD');
    expect(items[0].status).toBe('EXPIRED');
    // The expiring review sits above the healthy CDL, below the gaps.
    const review = items.findIndex((i) => i.kind === 'ANNUAL_REVIEW');
    const cdl = items.findIndex((i) => i.kind === 'CDL');
    expect(items[review].status).toBe('EXPIRING');
    expect(review).toBeLessThan(cdl);
    expect(items.at(-1)!.status).toBe('OK');
  });

  it('scopes kinds to the subject they actually belong to', () => {
    expect(kindsFor('DRIVER').every((k) => k.scope === 'DRIVER')).toBe(true);
    expect(kindsFor('ASSET').map((k) => k.kind)).toEqual([
      'REGISTRATION',
      'ANNUAL_INSPECTION',
      'IRP_CAB_CARD',
    ]);
    // Authority is carrier-level, not something each truck carries.
    expect(kindsFor('ASSET').some((k) => k.kind === 'AUTHORITY')).toBe(false);
  });

  it('uses a single kind registry — no scope has a kind with no spec', () => {
    for (const spec of COMPLIANCE_KINDS) {
      expect(specFor(spec.kind)).toBe(spec);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.reference.length).toBeGreaterThan(0);
    }
  });
});

describe('subject rollup', () => {
  it('reports the worst required problem', () => {
    expect(subjectStatus([item({ status: 'OK' }), item({ status: 'EXPIRING' })])).toBe('EXPIRING');
    expect(subjectStatus([item({ status: 'EXPIRING' }), item({ status: 'EXPIRED' })])).toBe('EXPIRED');
    expect(subjectStatus([item({ status: 'MISSING' }), item({ status: 'EXPIRED' })])).toBe('EXPIRED');
  });

  it('does not fail a subject for an optional document that is absent', () => {
    const optional = item({ status: 'MISSING', required: false, kind: 'ROAD_TEST' });
    expect(subjectStatus([item({ status: 'OK' }), optional])).toBe('OK');
    expect(countStatuses([item({ status: 'OK' }), optional])).toEqual({
      expired: 0,
      missing: 0,
      expiring: 0,
      ok: 1,
    });
  });

  it('counts required gaps', () => {
    expect(
      countStatuses([
        item({ status: 'EXPIRED' }),
        item({ status: 'MISSING' }),
        item({ status: 'EXPIRING' }),
        item({ status: 'OK' }),
      ]),
    ).toEqual({ expired: 1, missing: 1, expiring: 1, ok: 1 });
  });

  it('ranks EXPIRED as the most urgent thing to fix', () => {
    expect(COMPLIANCE_RANK.EXPIRED).toBeLessThan(COMPLIANCE_RANK.MISSING);
    expect(COMPLIANCE_RANK.MISSING).toBeLessThan(COMPLIANCE_RANK.EXPIRING);
    expect(COMPLIANCE_RANK.EXPIRING).toBeLessThan(COMPLIANCE_RANK.OK);
  });
});

describe('wording', () => {
  it('names the document instead of claiming compliance', () => {
    expect(statusHeadline([item({ status: 'OK' })])).toBe('All required documents on file');
    expect(statusHeadline([item({ status: 'EXPIRED', label: 'Medical examiner’s certificate' })])).toBe(
      'Medical examiner’s certificate expired',
    );
    expect(statusHeadline([item({ status: 'MISSING', required: true, label: 'Registration' })])).toBe(
      'Registration not on file',
    );
    expect(
      statusHeadline([item({ status: 'EXPIRING', label: 'Annual inspection', daysUntil: 1 })]),
    ).toBe('Annual inspection expires in 1 day');
    expect(
      statusHeadline([item({ status: 'EXPIRING', label: 'Annual inspection', daysUntil: 0 })]),
    ).toBe('Annual inspection expires today');
  });

  it('only asks for attention when something is actually wrong', () => {
    expect(needsAttention([item({ status: 'OK' })])).toBe(false);
    expect(needsAttention([item({ status: 'EXPIRING' })])).toBe(true);
    expect(needsAttention([item({ status: 'MISSING', required: false })])).toBe(false);
    expect(attentionSummary('Maria Chen', [item({ status: 'OK' })])).toBeNull();
  });

  it('summarises what to renew and how late it is', () => {
    const summary = attentionSummary('Maria Chen', [
      item({ status: 'EXPIRED', label: 'CDL / licence', daysUntil: -2 }),
      item({ status: 'MISSING', label: 'Annual driving record review', required: true }),
      item({ status: 'OK' }),
    ]);
    expect(summary?.title).toBe('Maria Chen: CDL / licence expired (+1 more)');
    expect(summary?.body).toContain('CDL / licence — expired 2 days ago');
    expect(summary?.body).toContain('Annual driving record review — not on file');
  });
});
