/**
 * Paperwork over HTTP.
 *
 * A generated rate confirmation names a carrier, its authority number and the
 * rate it agreed to haul for; the signature endpoint accepts a drawn signature
 * that ends up on a delivery packet. Both are exactly the material that must
 * never cross a tenant boundary and must never be accepted unvalidated, so the
 * tests here are about scope and validation rather than layout (the templates
 * have their own suite).
 */
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/events/event-bus';
import type { PrismaClient } from '@prisma/client';
import type { JwtUser } from '../../src/modules/auth/auth.types';
import {
  PrismaLoadPaperworkService,
  type LoadPaperworkService,
  type LoadSignatureRow,
  type PaperworkFile,
} from '../../src/modules/documents/paperwork.service';

const ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/loadwave_test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  JWT_ISSUER: 'loadwave-test',
  JWT_AUDIENCE: 'loadwave-test-clients',
  ELD_WEBHOOK_SECRET: '',
  LOG_LEVEL: 'silent',
};

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Records what the route asked for, so scoping can be asserted. */
class SpyPaperwork implements LoadPaperworkService {
  calls: Array<{ method: string; tenantId: string; id: string }> = [];
  assigneeDriverId: string | null = 'driver-1';
  readonly pdf = Buffer.from('%PDF-1.4 fake', 'latin1');

  private record(method: string, tenantId: string, id: string): PaperworkFile {
    this.calls.push({ method, tenantId, id });
    return { fileName: `${method}.pdf`, pdf: this.pdf };
  }

  async rateConfirmation(tenantId: string, loadId: string): Promise<PaperworkFile> {
    return this.record('rate-confirmation', tenantId, loadId);
  }
  async packet(tenantId: string, loadId: string): Promise<PaperworkFile> {
    return this.record('packet', tenantId, loadId);
  }
  async invoicePdf(tenantId: string, invoiceId: string): Promise<PaperworkFile> {
    return this.record('invoice', tenantId, invoiceId);
  }
  async captureSignature(input: {
    tenantId: string;
    loadId: string;
    role: string;
    signerName: string;
  }): Promise<LoadSignatureRow> {
    this.calls.push({ method: 'sign', tenantId: input.tenantId, id: input.loadId });
    return {
      id: 'sig-1',
      loadId: input.loadId,
      role: input.role,
      signerName: input.signerName,
      signedAt: new Date(0).toISOString(),
      driverId: null,
      sizeBytes: 10,
      createdAt: new Date(0).toISOString(),
    };
  }
  async listSignatures(): Promise<LoadSignatureRow[]> {
    return [];
  }
  async loadAssignees(tenantId: string, loadId: string): Promise<{ driverId: string | null } | null> {
    this.calls.push({ method: 'assignees', tenantId, id: loadId });
    return loadId === 'missing-load' ? null : { driverId: this.assigneeDriverId };
  }
}

async function buildWithFakes(): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  paperwork: SpyPaperwork;
}> {
  const paperwork = new SpyPaperwork();
  const app = await buildApp({
    env: { ...ENV },
    deps: {
      bus: new EventBus(),
      prisma: {} as unknown as PrismaClient,
      paperwork: paperwork as never,
    },
  });
  await app.ready();
  return { app, paperwork };
}

function token(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  roles: JwtUser['roles'] = ['DISPATCHER'],
  driverId: string | null = null,
) {
  return app.jwt.sign({ sub: `user-${tenantId}`, tenantId, roles, driverId, type: 'access' } as JwtUser);
}

function auth(app: Awaited<ReturnType<typeof buildApp>>, tenantId = TENANT_A, driverId: string | null = null) {
  return { authorization: `Bearer ${token(app, tenantId, ['DISPATCHER'], driverId)}` };
}

function driverAuth(app: Awaited<ReturnType<typeof buildApp>>, tenantId: string, driverId: string) {
  return { authorization: `Bearer ${token(app, tenantId, ['DRIVER'], driverId)}` };
}

describe('generated paperwork is scoped to the caller', () => {
  it('serves a rate confirmation as a PDF with a usable filename', async () => {
    const { app, paperwork } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/loads/load-1/rate-confirmation.pdf',
      headers: auth(app),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(paperwork.calls).toEqual([
      { method: 'rate-confirmation', tenantId: TENANT_A, id: 'load-1' },
    ]);
    await app.close();
  });

  it('takes the tenant from the token, never from the request', async () => {
    const { app, paperwork } = await buildWithFakes();
    // Tenant B asks for a load id that belongs to tenant A. The route must pass
    // B's own tenant to the lookup, which is what makes this a 404 rather than
    // a leak in the real service.
    await app.inject({
      method: 'GET',
      url: '/api/loads/load-1/packet.pdf',
      headers: auth(app, TENANT_B),
    });
    expect(paperwork.calls[0]).toEqual({ method: 'packet', tenantId: TENANT_B, id: 'load-1' });
    await app.close();
  });

  it('requires a signed-in ops user for every document', async () => {
    const { app } = await buildWithFakes();
    for (const url of [
      '/api/loads/load-1/rate-confirmation.pdf',
      '/api/loads/load-1/packet.pdf',
      '/api/invoices/inv-1/pdf',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('will not let a driver pull the paperwork PDFs', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/loads/load-1/packet.pdf',
      headers: driverAuth(app, TENANT_A, 'driver-1'),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('scopes the invoice PDF to the caller too', async () => {
    const { app, paperwork } = await buildWithFakes();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices/inv-9/pdf',
      headers: auth(app, TENANT_B),
    });
    expect(res.statusCode).toBe(200);
    expect(paperwork.calls).toEqual([{ method: 'invoice', tenantId: TENANT_B, id: 'inv-9' }]);
    await app.close();
  });
});

describe('signature capture', () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');

  it('requires authentication', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/loads/load-1/signatures',
      payload: { role: 'RECEIVER', signerName: 'Dana', data: image },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a role outside the three we record', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/loads/load-1/signatures',
      headers: auth(app),
      payload: { role: 'WITNESS', signerName: 'Dana', data: image },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('lets a driver sign their own trip', async () => {
    const { app, paperwork } = await buildWithFakes();
    paperwork.assigneeDriverId = 'driver-1';
    const res = await app.inject({
      method: 'POST',
      url: '/api/loads/load-1/signatures',
      headers: driverAuth(app, TENANT_A, 'driver-1'),
      payload: { role: 'RECEIVER', signerName: 'Dana Whitfield', data: image },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().signerName).toBe('Dana Whitfield');
    await app.close();
  });

  it('stops a driver signing somebody else’s haul', async () => {
    const { app, paperwork } = await buildWithFakes();
    paperwork.assigneeDriverId = 'driver-2';
    const res = await app.inject({
      method: 'POST',
      url: '/api/loads/load-1/signatures',
      headers: driverAuth(app, TENANT_A, 'driver-1'),
      payload: { role: 'RECEIVER', signerName: 'Dana Whitfield', data: image },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/your own trips/i);
    await app.close();
  });

  it('404s a load that is not in the caller’s tenant', async () => {
    const { app } = await buildWithFakes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/loads/missing-load/signatures',
      headers: auth(app),
      payload: { role: 'RECEIVER', signerName: 'Dana Whitfield', data: image },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('signature validation (real service)', () => {
  /** Minimal Prisma stand-in: the service only reads a load and writes a row. */
  function fakePrisma(): { prisma: PrismaClient; created: Array<Record<string, unknown>> } {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      load: { findFirst: async () => ({ id: 'load-1', assigneeDriverId: 'driver-7' }) },
      loadSignature: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return {
            id: 'sig-1',
            ...data,
            signedAt: data.signedAt as Date,
            createdAt: new Date(0),
          };
        },
      },
    } as unknown as PrismaClient;
    return { prisma, created };
  }

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]).toString('base64');

  it('accepts a drawn JPEG and records the driver on the load', async () => {
    const { prisma, created } = fakePrisma();
    const service = new PrismaLoadPaperworkService(prisma);
    const row = await service.captureSignature({
      tenantId: TENANT_A,
      loadId: 'load-1',
      role: 'receiver',
      signerName: '  Dana Whitfield  ',
      dataBase64: jpeg,
      capturedById: 'user-1',
    });

    expect(row.role).toBe('RECEIVER');
    expect(row.signerName).toBe('Dana Whitfield');
    expect(row.sizeBytes).toBeGreaterThan(0);
    expect(created[0]?.mimeType).toBe('image/jpeg');
    expect(created[0]?.driverId).toBe('driver-7');
  });

  it('refuses payloads that are not an image, so the packet can always embed them', async () => {
    const { prisma } = fakePrisma();
    const service = new PrismaLoadPaperworkService(prisma);
    const notAnImage = Buffer.from('this is not an image').toString('base64');

    await expect(
      service.captureSignature({
        tenantId: TENANT_A,
        loadId: 'load-1',
        role: 'RECEIVER',
        signerName: 'Dana Whitfield',
        dataBase64: notAnImage,
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/JPEG or PNG/i) });
  });

  it('refuses an empty or oversized signature', async () => {
    const { prisma } = fakePrisma();
    const service = new PrismaLoadPaperworkService(prisma);
    const base = { tenantId: TENANT_A, loadId: 'load-1', role: 'RECEIVER', signerName: 'Dana Whitfield' };

    await expect(service.captureSignature({ ...base, dataBase64: '' })).rejects.toMatchObject({
      statusCode: 400,
    });

    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 + 10)]).toString('base64');
    await expect(service.captureSignature({ ...base, dataBase64: huge })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/too large/i),
    });
  });

  it('requires a real signer name', async () => {
    const { prisma } = fakePrisma();
    const service = new PrismaLoadPaperworkService(prisma);
    await expect(
      service.captureSignature({
        tenantId: TENANT_A,
        loadId: 'load-1',
        role: 'RECEIVER',
        signerName: ' ',
        dataBase64: jpeg,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
