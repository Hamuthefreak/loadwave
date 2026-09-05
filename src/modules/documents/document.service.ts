import type { PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '../../utils/errors';

export type DocumentKind = 'POD' | 'BOL' | 'DAMAGE' | 'OTHER';

export const DOCUMENT_KINDS: DocumentKind[] = ['POD', 'BOL', 'DAMAGE', 'OTHER'];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export interface LoadDocumentRow {
  id: string;
  tenantId: string;
  loadId: string;
  driverId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: string;
}

export interface LoadDocumentUploadInput {
  tenantId: string;
  loadId: string;
  kind: DocumentKind;
  fileName: string;
  mimeType?: string;
  dataBase64: string;
  driverId?: string | null;
  uploadedById?: string | null;
}

export interface LoadDocumentService {
  upload(input: LoadDocumentUploadInput): Promise<LoadDocumentRow>;
  list(tenantId: string, loadId: string): Promise<LoadDocumentRow[]>;
  // Full document including binary payload, or null when it doesn't match the load.
  get(
    tenantId: string,
    loadId: string,
    documentId: string,
  ): Promise<{ row: LoadDocumentRow; data: Buffer } | null>;
}

/** The shape shared by Prisma results and our public rows (minus the binary). */
interface DocumentRowBase {
  id: string;
  tenantId: string;
  loadId: string;
  driverId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: Date;
}

export class PrismaLoadDocumentService implements LoadDocumentService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: DocumentRowBase): LoadDocumentRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      loadId: row.loadId,
      driverId: row.driverId,
      kind: row.kind,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async ensureLoad(tenantId: string, loadId: string): Promise<void> {
    const load = await this.prisma.load.findFirst({ where: { id: loadId, tenantId }, select: { id: true } });
    if (!load) throw notFound('load not found');
  }

  async upload(input: LoadDocumentUploadInput): Promise<LoadDocumentRow> {
    await this.ensureLoad(input.tenantId, input.loadId);

    let data: Buffer;
    try {
      data = Buffer.from(input.dataBase64, 'base64');
    } catch {
      throw badRequest('document data is not valid base64');
    }
    if (data.length === 0) throw badRequest('document is empty');
    if (data.length > MAX_DOCUMENT_BYTES) {
      throw badRequest(`document exceeds the ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB limit`);
    }

    const created = await this.prisma.loadDocument.create({
      data: {
        tenantId: input.tenantId,
        loadId: input.loadId,
        driverId: input.driverId ?? null,
        kind: input.kind,
        fileName: input.fileName.slice(0, 255),
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: data.length,
        data,
        uploadedById: input.uploadedById ?? null,
      },
    });
    return this.map(created);
  }

  async list(tenantId: string, loadId: string): Promise<LoadDocumentRow[]> {
    const rows = await this.prisma.loadDocument.findMany({
      where: { tenantId, loadId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.map(r));
  }

  async get(
    tenantId: string,
    loadId: string,
    documentId: string,
  ): Promise<{ row: LoadDocumentRow; data: Buffer } | null> {
    const row = await this.prisma.loadDocument.findFirst({
      where: { id: documentId, tenantId, loadId },
    });
    if (!row) return null;
    return { row: this.map(row), data: row.data };
  }
}
