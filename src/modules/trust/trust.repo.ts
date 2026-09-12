import type { PrismaClient } from '@prisma/client';
import { REPORT_WINDOW_DAYS, type SettledInvoice } from './trust.policy';

/** The compliance columns a tenant declares about itself. */
export interface ComplianceRow {
  tenantId: string;
  name: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  authoritySince: Date | null;
  authorityStatus: string;
  insuranceCarrier: string | null;
  insurancePolicyNumber: string | null;
  cargoInsuranceLimit: string | null;
  insuranceExpiresAt: Date | null;
  complianceUpdatedAt: Date | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface ReportRow {
  id: string;
  subjectTenantId: string;
  subjectName: string | null;
  loadId: string | null;
  category: string;
  details: string | null;
  status: string;
  createdAt: string;
}

export interface CompliancePatch {
  authoritySince?: Date | null;
  authorityStatus?: string;
  insuranceCarrier?: string | null;
  insurancePolicyNumber?: string | null;
  cargoInsuranceLimit?: number | null;
  insuranceExpiresAt?: Date | null;
  complianceUpdatedAt: Date;
}

export interface TrustRepo {
  compliance(tenantIds: string[]): Promise<ComplianceRow[]>;
  updateCompliance(tenantId: string, patch: CompliancePatch): Promise<void>;
  /** Settled invoices these tenants owed, for the days-to-pay record. */
  settledInvoices(payerTenantIds: string[], since: Date): Promise<{ payerTenantId: string; rows: SettledInvoice[] }[]>;
  /** Non-dismissed complaints per subject inside the window. */
  reportCounts(subjectTenantIds: string[], since: Date): Promise<Map<string, number>>;
  /** Does a real trading relation exist between these two tenants? */
  hasTradingRelation(a: string, b: string): Promise<boolean>;
  insertReport(input: {
    reporterTenantId: string;
    subjectTenantId: string;
    loadId?: string | null;
    category: string;
    details?: string | null;
  }): Promise<{ id: string; createdAt: Date }>;
  lastReportAt(reporterTenantId: string, subjectTenantId: string): Promise<Date | null>;
  reportsBy(tenantId: string): Promise<ReportRow[]>;
  tenantExists(tenantId: string): Promise<boolean>;
}

export class PrismaTrustRepo implements TrustRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async compliance(tenantIds: string[]): Promise<ComplianceRow[]> {
    if (tenantIds.length === 0) return [];
    const rows = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: {
        id: true,
        name: true,
        mcNumber: true,
        usdotNumber: true,
        authoritySince: true,
        authorityStatus: true,
        insuranceCarrier: true,
        insurancePolicyNumber: true,
        cargoInsuranceLimit: true,
        insuranceExpiresAt: true,
        complianceUpdatedAt: true,
        ratingAvg: true,
        ratingCount: true,
      },
    });
    return rows.map((r) => ({
      tenantId: r.id,
      name: r.name,
      mcNumber: r.mcNumber,
      usdotNumber: r.usdotNumber,
      authoritySince: r.authoritySince,
      authorityStatus: r.authorityStatus,
      insuranceCarrier: r.insuranceCarrier,
      insurancePolicyNumber: r.insurancePolicyNumber,
      cargoInsuranceLimit: r.cargoInsuranceLimit != null ? String(r.cargoInsuranceLimit) : null,
      insuranceExpiresAt: r.insuranceExpiresAt,
      complianceUpdatedAt: r.complianceUpdatedAt,
      ratingAvg: r.ratingAvg != null ? Number(r.ratingAvg) : null,
      ratingCount: r.ratingCount,
    }));
  }

  async updateCompliance(tenantId: string, patch: CompliancePatch): Promise<void> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: patch });
  }

  async settledInvoices(payerTenantIds: string[], since: Date): Promise<{ payerTenantId: string; rows: SettledInvoice[] }[]> {
    if (payerTenantIds.length === 0) return [];
    const rows = await this.prisma.invoice.findMany({
      where: {
        payerTenantId: { in: payerTenantIds },
        paidAt: { not: null },
        issueDate: { gte: since },
      },
      select: { payerTenantId: true, issueDate: true, dueDate: true, paidAt: true },
      take: 5000,
    });
    const byPayer = new Map<string, SettledInvoice[]>();
    for (const r of rows) {
      if (!r.payerTenantId) continue;
      const list = byPayer.get(r.payerTenantId) ?? [];
      list.push({ issueDate: r.issueDate, dueDate: r.dueDate, paidAt: r.paidAt });
      byPayer.set(r.payerTenantId, list);
    }
    return Array.from(byPayer, ([payerTenantId, list]) => ({ payerTenantId, rows: list }));
  }

  async reportCounts(subjectTenantIds: string[], since: Date): Promise<Map<string, number>> {
    if (subjectTenantIds.length === 0) return new Map();
    const grouped = await this.prisma.tenantReport.groupBy({
      by: ['subjectTenantId'],
      where: { subjectTenantId: { in: subjectTenantIds }, createdAt: { gte: since }, status: { not: 'DISMISSED' } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.subjectTenantId, g._count._all]));
  }

  /**
   * A trading relation is a booked load in either direction, or a message on
   * a load one of them posted. Anything weaker would make reports spam-able.
   */
  async hasTradingRelation(a: string, b: string): Promise<boolean> {
    const booked = await this.prisma.load.findFirst({
      where: {
        OR: [
          { tenantId: a, bookedByTenantId: b },
          { tenantId: b, bookedByTenantId: a },
        ],
      },
      select: { id: true },
    });
    if (booked) return true;

    const negotiated = await this.prisma.loadMessage.findFirst({
      where: {
        OR: [
          { authorTenantId: a, load: { tenantId: b } },
          { authorTenantId: b, load: { tenantId: a } },
        ],
      },
      select: { id: true },
    });
    return Boolean(negotiated);
  }

  async insertReport(input: {
    reporterTenantId: string;
    subjectTenantId: string;
    loadId?: string | null;
    category: string;
    details?: string | null;
  }): Promise<{ id: string; createdAt: Date }> {
    const row = await this.prisma.tenantReport.create({
      data: {
        reporterTenantId: input.reporterTenantId,
        subjectTenantId: input.subjectTenantId,
        loadId: input.loadId ?? null,
        category: input.category,
        details: input.details ?? null,
      },
      select: { id: true, createdAt: true },
    });
    return row;
  }

  async lastReportAt(reporterTenantId: string, subjectTenantId: string): Promise<Date | null> {
    const row = await this.prisma.tenantReport.findFirst({
      where: { reporterTenantId, subjectTenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  async reportsBy(tenantId: string): Promise<ReportRow[]> {
    const rows = await this.prisma.tenantReport.findMany({
      where: { reporterTenantId: tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        subjectTenantId: true,
        loadId: true,
        category: true,
        details: true,
        status: true,
        createdAt: true,
        subjectTenant: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      subjectTenantId: r.subjectTenantId,
      subjectName: r.subjectTenant?.name ?? null,
      loadId: r.loadId,
      category: r.category,
      details: r.details,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    return Boolean(row);
  }
}

export const REPORT_WINDOW = REPORT_WINDOW_DAYS;
