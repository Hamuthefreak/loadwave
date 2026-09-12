/**
 * Trust layer over HTTP — the guards that make the badges worth reading.
 *
 * The real service runs behind the real routes; only Prisma is faked, so the
 * route schemas are exercised too. The three things that must never regress:
 * a brand-new tenant cannot invent paid invoices, a stranger cannot file a
 * report, and no two calls can report the same counterparty into oblivion.
 */
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/events/event-bus';
import type { PrismaClient } from '@prisma/client';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import { PrismaTrustRepo } from '../../src/modules/trust/trust.repo';
import { PrismaTrustService } from '../../src/modules/trust/trust.service';
import type { FmcsaClient } from '../../src/modules/trust/fmcsa.client';
import type { FmcsaLookupResult } from '../../src/modules/trust/fmcsa.policy';

/** A stand-in FMCSA client that answers with whatever the test wants. */
function fakeFmcsa(result: FmcsaLookupResult): FmcsaClient {
  return { enabled: true, lookupByDot: jest.fn(async () => result) };
}

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
};

const ME = 'tenant-me';
const OTHER = 'tenant-other';

async function buildWithFakes(
  opts: {
    related?: boolean;
    lastReportAt?: Date | null;
    tenants?: Record<string, unknown>;
    /** Injected FMCSA client; omit it to simulate a deployment with checks off. */
    fmcsa?: FmcsaClient;
  } = {},
) {
  const tenants = new Map<string, Record<string, unknown>>([
    [
      ME,
      {
        id: ME,
        name: 'Me Carrier',
        mcNumber: 'MC100',
        usdotNumber: null,
        authoritySince: new Date('2019-03-01T00:00:00Z'),
        authorityStatus: 'ACTIVE',
        insuranceCarrier: null,
        insurancePolicyNumber: null,
        cargoInsuranceLimit: null,
        insuranceExpiresAt: null,
        complianceUpdatedAt: null,
        ratingAvg: null,
        ratingCount: 0,
      },
    ],
    [
      OTHER,
      {
        id: OTHER,
        name: 'Other Carrier',
        mcNumber: 'MC200',
        usdotNumber: null,
        authoritySince: new Date('2018-04-01T00:00:00Z'),
        authorityStatus: 'ACTIVE',
        insuranceCarrier: 'Intact',
        insurancePolicyNumber: 'P-1',
        cargoInsuranceLimit: null,
        insuranceExpiresAt: new Date('2027-01-01T00:00:00Z'),
        complianceUpdatedAt: new Date('2026-09-01T00:00:00Z'),
        ratingAvg: null,
        ratingCount: 0,
      },
    ],
  ]);
  if (opts.tenants) {
    for (const [id, row] of Object.entries(opts.tenants)) {
      const existing: Record<string, unknown> = tenants.get(id) ?? { id, name: id };
      tenants.set(id, { ...existing, ...(row as Record<string, unknown>) });
    }
  }

  const updates: Array<Record<string, unknown>> = [];
  const reports: Array<Record<string, unknown>> = [];

  const prisma = {
    tenant: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => tenants.get(id)).filter(Boolean),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (tenants.get(where.id) ?? null)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, ...data });
        const row = tenants.get(where.id);
        if (row) tenants.set(where.id, { ...row, ...data });
        return tenants.get(where.id);
      }),
    },
    invoice: { findMany: jest.fn(async () => invoices) },
    load: { findFirst: jest.fn(async () => (opts.related ? { id: 'load-1' } : null)) },
    loadMessage: { findFirst: jest.fn(async () => null) },
    tenantReport: {
      groupBy: jest.fn(async () => reportCounts),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        reports.push(data);
        return { id: 'report-1', createdAt: new Date('2026-09-12T10:00:00Z') };
      }),
      findFirst: jest.fn(async () => (opts.lastReportAt ? { createdAt: opts.lastReportAt } : null)),
      findMany: jest.fn(async () => []),
    },
  } as unknown as PrismaClient;

  const invoices = [
    // Paid 25 days after issue, 5 days before due.
    { payerTenantId: OTHER, issueDate: new Date('2026-07-01T00:00:00Z'), dueDate: new Date('2026-07-31T00:00:00Z'), paidAt: new Date('2026-07-26T00:00:00Z') },
    { payerTenantId: OTHER, issueDate: new Date('2026-06-01T00:00:00Z'), dueDate: new Date('2026-07-01T00:00:00Z'), paidAt: new Date('2026-06-26T00:00:00Z') },
  ];
  const reportCounts = [{ subjectTenantId: OTHER, _count: { _all: 1 } }];

  const trust = new PrismaTrustService(new PrismaTrustRepo(prisma), opts.fmcsa);
  const app = await buildApp({
    env: ENV,
    deps: { bus: new EventBus(), prisma, trust, notifications: { notify: jest.fn() } as never, email: { send: jest.fn() } as never },
  });
  return { app, updates, reports, tenants };
}

function token(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string, roles: JwtUser['roles'] = ['ADMIN']) {
  return app.jwt.sign({ sub: `user-${tenantId}`, tenantId, roles, driverId: null, type: 'access' } as JwtUser);
}

describe('trust signals (HTTP)', () => {
  it('derives days-to-pay from settled invoices rather than any declared number', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: `/api/trust/tenants/${OTHER}`,
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const signals = res.json().signals;
    expect(signals.payment).toMatchObject({ samples: 2, band: 'ON_TIME' });
    expect(signals.payment.avgDaysToPay).toBe(25);
    expect(signals.insurance).toBe('VALID');
    expect(signals.openReports).toBe(1);
    // Two reports would be a caution verdict; one is a flag on an otherwise fine file.
    expect(signals.level).toBe('ESTABLISHED');
    expect(signals.flags).toContain('1 report in the last year');
    await app.close();
  });

  it('shows an empty payment record as no history, never as a good record', async () => {
    const { app } = await buildWithFakes({ tenants: { [OTHER]: { insuranceExpiresAt: new Date('2027-01-01T00:00:00Z') } } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trust/me',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const signals = res.json().signals;
    expect(signals.payment).toBeNull();
    expect(signals.insurance).toBe('MISSING');
    expect(signals.flags).toContain('No insurance on file');
    await app.close();
  });

  it('404s a tenant that does not exist instead of inventing a badge', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/trust/tenants/ghost',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('declaring compliance (HTTP)', () => {
  it('saves authority and insurance and reflects them straight away', async () => {
    const { app, updates } = await buildWithFakes();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/trust/me',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: {
        authoritySince: '2024-05-01',
        authorityStatus: 'active',
        insuranceCarrier: '  Intact  ',
        insurancePolicyNumber: 'P-9',
        cargoInsuranceLimit: 250000,
        insuranceExpiresAt: '2027-05-01',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().signals).toMatchObject({ insurance: 'VALID' });
    expect(updates[0]).toMatchObject({
      id: ME,
      authorityStatus: 'ACTIVE',
      insuranceCarrier: 'Intact',
      insurancePolicyNumber: 'P-9',
    });
    await app.close();
  });

  it('rejects an unknown authority status and a future start date', async () => {
    const { app } = await buildWithFakes();
    const badStatus = await app.inject({
      method: 'PATCH',
      url: '/api/trust/me',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { authorityStatus: 'PROBABLY_FINE' },
    });
    expect(badStatus.statusCode).toBe(400);

    const future = await app.inject({
      method: 'PATCH',
      url: '/api/trust/me',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { authoritySince: '2099-01-01' },
    });
    expect(future.statusCode).toBe(400);
    await app.close();
  });

  it('refuses compliance claims from a driver account', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/trust/me',
      headers: { authorization: `Bearer ${token(app, ME, ['DRIVER'])}` },
      payload: { authorityStatus: 'ACTIVE' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('reporting a counterparty (HTTP)', () => {
  it('files a report when the two have traded', async () => {
    const { app, reports } = await buildWithFakes({ related: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { subjectTenantId: OTHER, category: 'NON_PAYMENT', details: 'Invoice 42 still open at 90 days.' },
    });

    expect(res.statusCode).toBe(201);
    expect(reports[0]).toMatchObject({ reporterTenantId: ME, subjectTenantId: OTHER, category: 'NON_PAYMENT' });
    await app.close();
  });

  it('refuses a report about a stranger — the count has to mean something', async () => {
    const { app, reports } = await buildWithFakes({ related: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { subjectTenantId: OTHER, category: 'NON_PAYMENT' },
    });

    expect(res.statusCode).toBe(403);
    expect(reports).toHaveLength(0);
    await app.close();
  });

  it('refuses a self-report and an unknown category', async () => {
    const { app } = await buildWithFakes({ related: true });
    const self = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { subjectTenantId: ME, category: 'NON_PAYMENT' },
    });
    expect(self.statusCode).toBe(400);

    const bogus = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { subjectTenantId: OTHER, category: 'I_DO_NOT_LIKE_THEM' },
    });
    expect(bogus.statusCode).toBe(400);
    await app.close();
  });

  it('refuses a second report inside the cooldown', async () => {
    const { app, reports } = await buildWithFakes({ related: true, lastReportAt: new Date(Date.now() - 3 * 86_400_000) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token(app, ME)}` },
      payload: { subjectTenantId: OTHER, category: 'FRAUD' },
    });

    expect(res.statusCode).toBe(409);
    expect(reports).toHaveLength(0);
    await app.close();
  });
});

/**
 * The FMCSA check. These are the tests that keep the badge honest: a lookup
 * that fails, or that never ran, must leave the number labelled self-declared.
 */
describe('authority verification (HTTP)', () => {
  const withDot = { [ME]: { usdotNumber: '1234567', mcNumber: 'MC100' } };

  it('says self-declared, and writes nothing, when checks are not configured', async () => {
    const { app, updates } = await buildWithFakes({ tenants: withDot });
    const res = await app.inject({
      method: 'POST',
      url: '/api/trust/me/verify',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checked).toBe(false);
    expect(body.reason).toMatch(/not configured/i);
    expect(body.signals.verification).toBe('DECLARED');
    expect(body.signals.verified).toBe(false);
    expect(body.signals.fmcsaCheckedAt).toBeNull();
    // Nothing that looks like a check was persisted.
    expect(updates.some((u) => 'fmcsaCheckedAt' in u)).toBe(false);
    await app.close();
  });

  it('asks for a USDOT before looking anything up', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/trust/me/verify',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/USDOT/i);
    await app.close();
  });

  it('records a successful check and flips the badge to FMCSA checked', async () => {
    const { app, updates } = await buildWithFakes({
      tenants: withDot,
      fmcsa: fakeFmcsa({
        ok: true,
        carrier: {
          dotNumber: '1234567',
          legalName: 'ME CARRIER LTD',
          dbaName: null,
          mcNumber: 'MC100',
          status: 'ACTIVE',
          allowedToOperate: 'Y',
          statusCode: 'A',
        },
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/trust/me/verify',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checked).toBe(true);
    expect(body.signals.verification).toBe('VERIFIED');
    expect(body.signals.verified).toBe(true);
    expect(body.signals.fmcsaLegalName).toBe('ME CARRIER LTD');
    expect(updates.some((u) => u.fmcsaStatus === 'ACTIVE')).toBe(true);
    await app.close();
  });

  it('marks a carrier FMCSA does not permit as a failed check, not a silent pass', async () => {
    const { app } = await buildWithFakes({
      tenants: withDot,
      fmcsa: fakeFmcsa({
        ok: true,
        carrier: {
          dotNumber: '1234567',
          legalName: 'ME CARRIER LTD',
          dbaName: null,
          mcNumber: 'MC100',
          status: 'NOT_ALLOWED',
          allowedToOperate: 'N',
          statusCode: 'A',
        },
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/trust/me/verify',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.signals.verification).toBe('FAILED');
    expect(body.signals.verified).toBe(false);
    expect(body.signals.flags).toContain('FMCSA records do not allow this carrier to operate');
    await app.close();
  });

  it('does not record anything when FMCSA cannot be reached', async () => {
    const { app, updates } = await buildWithFakes({
      tenants: withDot,
      fmcsa: fakeFmcsa({ ok: false, reason: 'UPSTREAM_ERROR', detail: 'boom' }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/trust/me/verify',
      headers: { authorization: `Bearer ${token(app, ME)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checked).toBe(false);
    expect(body.reason).toMatch(/could not be reached/i);
    expect(body.signals.verification).toBe('DECLARED');
    expect(updates.some((u) => 'fmcsaCheckedAt' in u)).toBe(false);
    await app.close();
  });
});
