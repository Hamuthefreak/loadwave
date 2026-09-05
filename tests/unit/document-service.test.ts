import type { PrismaClient } from '@prisma/client';
import { PrismaLoadDocumentService } from '../../src/modules/documents/document.service';

function buildService(options: { loadExists?: boolean } = {}) {
  const docs: Array<Record<string, unknown>> = [];
  const prisma = {
    load: {
      findFirst: jest.fn(async () => (options.loadExists ?? true ? { id: 'load-1' } : null)),
    },
    loadDocument: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'doc-1', createdAt: new Date('2026-09-05T12:00:00Z'), ...data };
        docs.push(row);
        return row;
      }),
      findMany: jest.fn(async () => docs),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        docs.find((d) => d.id === where.id) ?? null,
      ),
    },
  } as unknown as Pick<PrismaClient, 'load' | 'loadDocument'>;
  return { svc: new PrismaLoadDocumentService(prisma as unknown as PrismaClient), docs };
}

describe('PrismaLoadDocumentService', () => {
  it('rejects uploads for loads outside the tenant', async () => {
    const { svc } = buildService({ loadExists: false });
    await expect(
      svc.upload({
        tenantId: 't1',
        loadId: 'load-1',
        kind: 'POD',
        fileName: 'pod.pdf',
        dataBase64: 'aGVsbG8=',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('decodes base64, records byte size and returns metadata', async () => {
    const { svc } = buildService();
    const row = await svc.upload({
      tenantId: 't1',
      loadId: 'load-1',
      kind: 'POD',
      fileName: 'delivery-pod.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('hello delivery').toString('base64'),
      uploadedById: 'u-1',
    });
    expect(row).toMatchObject({
      loadId: 'load-1',
      kind: 'POD',
      fileName: 'delivery-pod.png',
      mimeType: 'image/png',
      sizeBytes: 14,
    });
  });

  it('lists documents and returns the binary on get', async () => {
    const { svc } = buildService();
    await svc.upload({
      tenantId: 't1',
      loadId: 'load-1',
      kind: 'BOL',
      fileName: 'bol.txt',
      dataBase64: Buffer.from('bill of lading').toString('base64'),
    });
    const list = await svc.list('t1', 'load-1');
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe('bol.txt');

    const got = await svc.get('t1', 'load-1', 'doc-1');
    expect(got?.data.toString()).toBe('bill of lading');
    expect(got?.row.kind).toBe('BOL');
  });
});
