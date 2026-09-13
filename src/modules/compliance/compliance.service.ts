import type { PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '../../utils/errors';
import {
  checklist,
  countStatuses,
  deriveExpiry,
  documentStatus,
  specFor,
  statusHeadline,
  subjectStatus,
  type ChecklistItem,
  type ComplianceStatus,
  type ComplianceSubject,
  type StoredDoc,
} from './compliance.policy';
import { normalizeDocumentMime, MAX_DOCUMENT_BYTES } from '../documents/document.service';

export const COMPLIANCE_SUBJECTS: ComplianceSubject[] = ['DRIVER', 'ASSET', 'TENANT'];

export interface ComplianceSubjectView {
  subject: ComplianceSubject;
  subjectId: string;
  /** Driver name, unit number, or carrier name. */
  label: string;
  /** Extra line under the label, e.g. a VIN or a licence number. */
  detail: string | null;
  status: ComplianceStatus;
  headline: string;
  items: ChecklistItem[];
}

export interface ComplianceView {
  asOf: string;
  drivers: ComplianceSubjectView[];
  assets: ComplianceSubjectView[];
  carrier: ComplianceSubjectView;
  totals: { expired: number; missing: number; expiring: number; ok: number };
}

export interface ComplianceDocumentRow {
  id: string;
  subject: ComplianceSubject;
  subjectId: string;
  kind: string;
  identifier: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: ComplianceStatus;
  daysUntil: number | null;
  notes: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string;
}

export interface ComplianceUpsertInput {
  tenantId: string;
  subject: ComplianceSubject;
  subjectId: string;
  kind: string;
  identifier?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  dataBase64?: string | null;
  uploadedById?: string | null;
}

export interface ComplianceService {
  list(tenantId: string): Promise<ComplianceView>;
  /** Just one driver's checklist — the cab-side view. */
  forDriver(tenantId: string, driverId: string): Promise<ComplianceSubjectView | null>;
  upsert(input: ComplianceUpsertInput): Promise<ComplianceDocumentRow>;
  remove(tenantId: string, id: string): Promise<void>;
  file(tenantId: string, id: string): Promise<{ row: ComplianceDocumentRow; data: Buffer } | null>;
}

interface DocRow {
  id: string;
  subject: ComplianceSubject;
  subjectId: string;
  kind: string;
  identifier: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  notes: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
}

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date`);
  return d;
}

export class PrismaComplianceService implements ComplianceService {
  constructor(private readonly prisma: PrismaClient) {}

  private toRow(row: DocRow, now: Date): ComplianceDocumentRow {
    return {
      id: row.id,
      subject: row.subject,
      subjectId: row.subjectId,
      kind: row.kind,
      identifier: row.identifier,
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      status: documentStatus(row.expiresAt, now),
      daysUntil: row.expiresAt
        ? Math.ceil((row.expiresAt.getTime() - now.getTime()) / 86_400_000)
        : null,
      notes: row.notes,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(tenantId: string): Promise<ComplianceView> {
    const now = new Date();
    const [docs, drivers, assets, tenant] = await Promise.all([
      this.prisma.complianceDocument.findMany({
        where: { tenantId },
        select: {
          id: true,
          subject: true,
          subjectId: true,
          kind: true,
          identifier: true,
          issuedAt: true,
          expiresAt: true,
          notes: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          updatedAt: true,
        },
      }),
      this.prisma.driver.findMany({
        where: { tenantId, status: { not: 'SUSPENDED' } },
        select: { id: true, name: true, licenseNumber: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: { tenantId },
        select: { id: true, powerUnitNumber: true, vin: true, assetType: true },
        orderBy: { powerUnitNumber: 'asc' },
      }),
      this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true, name: true } }),
    ]);

    const bySubject = new Map<string, StoredDoc[]>();
    for (const d of docs as DocRow[]) {
      const key = `${d.subject}:${d.subjectId}`;
      const list = bySubject.get(key);
      // `sizeBytes` stands in for "a scan exists" without pulling the bytes.
      const entry: StoredDoc = {
        id: d.id,
        kind: d.kind,
        identifier: d.identifier,
        expiresAt: d.expiresAt,
        notes: d.notes,
        hasFile: d.sizeBytes != null,
      };
      if (list) list.push(entry);
      else bySubject.set(key, [entry]);
    }

    const build = (
      subject: ComplianceSubject,
      subjectId: string,
      label: string,
      detail: string | null,
    ): ComplianceSubjectView => {
      const items = checklist(subject, bySubject.get(`${subject}:${subjectId}`) ?? [], now);
      return {
        subject,
        subjectId,
        label,
        detail,
        status: subjectStatus(items),
        headline: statusHeadline(items),
        items,
      };
    };

    const driverViews = drivers.map((d) =>
      build('DRIVER', d.id, d.name, d.licenseNumber ? `Licence ${d.licenseNumber}` : null),
    );
    const assetViews = assets.map((a) =>
      build(
        'ASSET',
        a.id,
        a.powerUnitNumber ? `Unit ${a.powerUnitNumber}` : (a.vin ?? 'Unnamed unit'),
        [a.assetType, a.vin].filter(Boolean).join(' · ') || null,
      ),
    );
    const carrier = build('TENANT', tenantId, tenant?.name ?? 'Carrier', null);

    // Fleet totals count *subjects* in trouble rather than raw documents, which
    // is the number an owner can act on.
    const totals = { expired: 0, missing: 0, expiring: 0, ok: 0 };
    for (const view of [...driverViews, ...assetViews, carrier]) {
      const counts = countStatuses(view.items);
      totals.expired += counts.expired;
      totals.missing += counts.missing;
      totals.expiring += counts.expiring;
      totals.ok += counts.ok;
    }

    return {
      asOf: now.toISOString(),
      drivers: driverViews.sort(
        (a, b) => rankStatus(a.status) - rankStatus(b.status) || a.label.localeCompare(b.label),
      ),
      assets: assetViews.sort(
        (a, b) => rankStatus(a.status) - rankStatus(b.status) || a.label.localeCompare(b.label),
      ),
      carrier,
      totals,
    };
  }

  async forDriver(tenantId: string, driverId: string): Promise<ComplianceSubjectView | null> {
    const now = new Date();
    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, tenantId },
      select: { id: true, name: true, licenseNumber: true },
    });
    if (!driver) return null;
    const docs = await this.prisma.complianceDocument.findMany({
      where: { tenantId, subject: 'DRIVER', subjectId: driverId },
      select: {
        id: true,
        kind: true,
        identifier: true,
        expiresAt: true,
        notes: true,
        sizeBytes: true,
      },
    });
    const items = checklist('DRIVER', docs as StoredDoc[], now);
    return {
      subject: 'DRIVER',
      subjectId: driver.id,
      label: driver.name,
      detail: driver.licenseNumber ? `Licence ${driver.licenseNumber}` : null,
      status: subjectStatus(items),
      headline: statusHeadline(items),
      items,
    };
  }

  async upsert(input: ComplianceUpsertInput): Promise<ComplianceDocumentRow> {
    const spec = specFor(input.kind);
    if (!spec) throw badRequest(`unknown compliance document kind: ${input.kind}`);
    if (spec.scope !== input.subject) {
      throw badRequest(`${spec.label} belongs to ${spec.scope.toLowerCase()} documents, not ${input.subject.toLowerCase()}`);
    }
    await this.assertSubjectBelongs(input.tenantId, input.subject, input.subjectId);

    const issuedAt = parseDate(input.issuedAt, 'issuedAt');
    let expiresAt = parseDate(input.expiresAt, 'expiresAt');
    // Documents whose cycle is set by rule get the expiry derived for free, so
    // an annual review entered once doesn't quietly become a stale date.
    if (!expiresAt && issuedAt && spec.validityMonths) {
      expiresAt = deriveExpiry(issuedAt, spec.validityMonths);
    }

    let data: Buffer | undefined;
    if (input.dataBase64) {
      data = Buffer.from(input.dataBase64, 'base64');
      if (data.length === 0) throw badRequest('document is empty');
      if (data.length > MAX_DOCUMENT_BYTES) {
        throw badRequest(`document exceeds the ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB limit`);
      }
    }

    const key = {
      tenantId_subject_subjectId_kind: {
        tenantId: input.tenantId,
        subject: input.subject,
        subjectId: input.subjectId,
        kind: input.kind,
      },
    };

    const row = await this.prisma.complianceDocument.upsert({
      where: key,
      create: {
        tenantId: input.tenantId,
        subject: input.subject,
        subjectId: input.subjectId,
        kind: input.kind,
        identifier: input.identifier ?? null,
        issuedAt,
        expiresAt,
        notes: input.notes ?? null,
        fileName: input.fileName ?? null,
        mimeType: data ? normalizeDocumentMime(input.mimeType) : null,
        sizeBytes: data?.length ?? null,
        data: data ?? null,
        uploadedById: input.uploadedById ?? null,
      },
      update: {
        identifier: input.identifier ?? null,
        issuedAt,
        expiresAt,
        notes: input.notes ?? null,
        // Only replace the scan when a new one is actually uploaded, so editing
        // the expiry date doesn't silently throw away the certificate.
        ...(data
          ? {
              fileName: input.fileName ?? null,
              mimeType: normalizeDocumentMime(input.mimeType),
              sizeBytes: data.length,
              data,
            }
          : {}),
        uploadedById: input.uploadedById ?? null,
      },
    });

    return this.toRow(row as DocRow, new Date());
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.complianceDocument.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!found) throw notFound('document not found');
    await this.prisma.complianceDocument.delete({ where: { id } });
  }

  async file(
    tenantId: string,
    id: string,
  ): Promise<{ row: ComplianceDocumentRow; data: Buffer } | null> {
    const row = await this.prisma.complianceDocument.findFirst({ where: { id, tenantId } });
    if (!row) return null;
    const data = (row as { data?: Buffer | null }).data;
    if (!data) return null;
    return { row: this.toRow(row as DocRow, new Date()), data };
  }

  /** A document may only be filed against a subject that is really on this tenant. */
  private async assertSubjectBelongs(
    tenantId: string,
    subject: ComplianceSubject,
    subjectId: string,
  ): Promise<void> {
    if (subject === 'TENANT') {
      if (subjectId !== tenantId) throw badRequest('carrier documents must be filed against your own carrier');
      return;
    }
    const found =
      subject === 'DRIVER'
        ? await this.prisma.driver.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } })
        : await this.prisma.asset.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
    if (!found) throw notFound(`${subject.toLowerCase()} not found`);
  }
}

const STATUS_ORDER: Record<ComplianceStatus, number> = {
  EXPIRED: 0,
  MISSING: 1,
  EXPIRING: 2,
  OK: 3,
};

function rankStatus(status: ComplianceStatus): number {
  return STATUS_ORDER[status];
}
