import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import {
  REPORT_MAX_DETAILS,
  REPORT_WINDOW_DAYS,
  isReportCategory,
  paymentRecord,
  reportAllowed,
  trustSummary,
  withinCooldown,
  type AuthorityState,
  type InsuranceState,
  type PaymentRecord,
  type TrustLevel,
} from './trust.policy';
import type { ReportRow, TrustRepo } from './trust.repo';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_WINDOW_DAYS = 730;

export const AUTHORITY_STATUSES = ['UNVERIFIED', 'ACTIVE', 'REVOKED', 'OUT_OF_SERVICE'] as const;

/**
 * What a counterparty sees about a tenant before committing to a load.
 * Every field is either declared by the tenant or observed by the platform —
 * none of it is an external verification, and the UI says so.
 */
export interface TrustSignals {
  tenantId: string;
  name: string;
  level: TrustLevel;
  authority: AuthorityState;
  authorityStatus: string;
  authoritySince: string | null;
  authorityAgeYears: number | null;
  insurance: InsuranceState;
  insuranceExpiresAt: string | null;
  payment: PaymentRecord | null;
  openReports: number;
  ratingAvg: number | null;
  ratingCount: number;
  mcNumber: string | null;
  usdotNumber: string | null;
  verified: boolean;
  flags: string[];
  /** When the tenant last updated its compliance details, if ever. */
  declaredAt: string | null;
}

export interface ComplianceInput {
  authoritySince?: string | null;
  authorityStatus?: string;
  insuranceCarrier?: string | null;
  insurancePolicyNumber?: string | null;
  cargoInsuranceLimit?: number | null;
  insuranceExpiresAt?: string | null;
}

export interface ReportInput {
  reporterTenantId: string;
  subjectTenantId: string;
  loadId?: string | null;
  category: string;
  details?: string | null;
}

export interface TrustService {
  /** Batch lookup so a board page costs three queries, not three per row. */
  signalsFor(tenantIds: string[], now?: Date): Promise<Map<string, TrustSignals>>;
  signals(tenantId: string, now?: Date): Promise<TrustSignals>;
  setCompliance(tenantId: string, input: ComplianceInput): Promise<TrustSignals>;
  report(input: ReportInput): Promise<ReportRow>;
  /** Reports this tenant filed (their own view; never the platform's case file). */
  myReports(tenantId: string): Promise<ReportRow[]>;
}

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date`);
  return d;
}

function cleanText(value: string | null | undefined, max: number, field: string): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return trimmed;
}

export class PrismaTrustService implements TrustService {
  constructor(private readonly repo: TrustRepo) {}

  async signalsFor(tenantIds: string[], now: Date = new Date()): Promise<Map<string, TrustSignals>> {
    const ids = Array.from(new Set(tenantIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    const compliance = await this.repo.compliance(ids);
    const [payments, reportCounts] = await Promise.all([
      this.repo.settledInvoices(ids, new Date(now.getTime() - PAYMENT_WINDOW_DAYS * DAY_MS)),
      this.repo.reportCounts(ids, new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY_MS)),
    ]);

    const paidBy = new Map(payments.map((p) => [p.payerTenantId, p.rows]));
    const out = new Map<string, TrustSignals>();

    for (const row of compliance) {
      const payment = paymentRecord(paidBy.get(row.tenantId) ?? [], now, { windowDays: PAYMENT_WINDOW_DAYS });
      const openReports = reportCounts.get(row.tenantId) ?? 0;
      const summary = trustSummary(
        {
          insuranceExpiresAt: row.insuranceExpiresAt,
          authorityStatus: row.authorityStatus,
          authoritySince: row.authoritySince,
          payment,
          openReports,
          ratingAvg: row.ratingAvg,
          ratingCount: row.ratingCount,
        },
        now,
      );

      out.set(row.tenantId, {
        tenantId: row.tenantId,
        name: row.name,
        level: summary.level,
        authority: summary.authority,
        authorityStatus: (row.authorityStatus || 'UNVERIFIED').toUpperCase(),
        authoritySince: row.authoritySince ? row.authoritySince.toISOString() : null,
        authorityAgeYears: summary.authorityAgeYears,
        insurance: summary.insurance,
        insuranceExpiresAt: row.insuranceExpiresAt ? row.insuranceExpiresAt.toISOString() : null,
        payment: summary.payment,
        openReports,
        ratingAvg: row.ratingAvg,
        ratingCount: row.ratingCount,
        mcNumber: row.mcNumber,
        usdotNumber: row.usdotNumber,
        verified: Boolean(row.mcNumber || row.usdotNumber),
        flags: summary.flags,
        declaredAt: row.complianceUpdatedAt ? row.complianceUpdatedAt.toISOString() : null,
      });
    }

    return out;
  }

  async signals(tenantId: string, now: Date = new Date()): Promise<TrustSignals> {
    const map = await this.signalsFor([tenantId], now);
    const found = map.get(tenantId);
    if (!found) throw notFound('tenant not found');
    return found;
  }

  async setCompliance(tenantId: string, input: ComplianceInput): Promise<TrustSignals> {
    if (input.authorityStatus !== undefined) {
      const status = String(input.authorityStatus).toUpperCase();
      if (!(AUTHORITY_STATUSES as readonly string[]).includes(status)) {
        throw badRequest(`authorityStatus must be one of ${AUTHORITY_STATUSES.join(', ')}`);
      }
    }
    const authoritySince = input.authoritySince !== undefined ? parseDate(input.authoritySince, 'authoritySince') : undefined;
    if (authoritySince && authoritySince.getTime() > Date.now() + DAY_MS) {
      throw badRequest('authoritySince cannot be in the future');
    }
    const insuranceExpiresAt =
      input.insuranceExpiresAt !== undefined ? parseDate(input.insuranceExpiresAt, 'insuranceExpiresAt') : undefined;

    let cargoInsuranceLimit: number | null | undefined;
    if (input.cargoInsuranceLimit !== undefined) {
      if (input.cargoInsuranceLimit === null) {
        cargoInsuranceLimit = null;
      } else {
        const limit = Number(input.cargoInsuranceLimit);
        if (!Number.isFinite(limit) || limit < 0 || limit > 100_000_000) {
          throw badRequest('cargoInsuranceLimit looks wrong');
        }
        cargoInsuranceLimit = Math.round(limit * 100) / 100;
      }
    }

    await this.repo.updateCompliance(tenantId, {
      ...(authoritySince !== undefined ? { authoritySince } : {}),
      ...(input.authorityStatus !== undefined ? { authorityStatus: String(input.authorityStatus).toUpperCase() } : {}),
      ...(input.insuranceCarrier !== undefined
        ? { insuranceCarrier: cleanText(input.insuranceCarrier, 120, 'insuranceCarrier') }
        : {}),
      ...(input.insurancePolicyNumber !== undefined
        ? { insurancePolicyNumber: cleanText(input.insurancePolicyNumber, 80, 'insurancePolicyNumber') }
        : {}),
      ...(cargoInsuranceLimit !== undefined ? { cargoInsuranceLimit } : {}),
      ...(insuranceExpiresAt !== undefined ? { insuranceExpiresAt } : {}),
      complianceUpdatedAt: new Date(),
    });

    return this.signals(tenantId);
  }

  async report(input: ReportInput): Promise<ReportRow> {
    const category = String(input.category ?? '').toUpperCase();
    if (!isReportCategory(category)) {
      throw badRequest('choose a report reason that exists');
    }
    const details = cleanText(input.details, REPORT_MAX_DETAILS, 'details');
    if (!input.subjectTenantId) throw badRequest('subjectTenantId is required');

    const allowed = reportAllowed(input.subjectTenantId, input.reporterTenantId, {
      sharedLoad: await this.repo.hasTradingRelation(input.reporterTenantId, input.subjectTenantId),
    });
    if (!allowed.ok) {
      // A missing relation is a permission problem, not a validation one.
      if (allowed.reason === 'you cannot report yourself') throw badRequest(allowed.reason);
      throw forbidden(allowed.reason ?? 'this carrier cannot be reported');
    }
    if (!(await this.repo.tenantExists(input.subjectTenantId))) throw notFound('that carrier is not on Loadwave');

    const now = new Date();
    const last = await this.repo.lastReportAt(input.reporterTenantId, input.subjectTenantId);
    if (last && withinCooldown(last, now)) {
      throw conflict('you have already reported this carrier recently — platform review has it');
    }

    const created = await this.repo.insertReport({
      reporterTenantId: input.reporterTenantId,
      subjectTenantId: input.subjectTenantId,
      loadId: input.loadId ?? null,
      category,
      details,
    });

    return {
      id: created.id,
      subjectTenantId: input.subjectTenantId,
      subjectName: null,
      loadId: input.loadId ?? null,
      category,
      details,
      status: 'OPEN',
      createdAt: created.createdAt.toISOString(),
    };
  }

  async myReports(tenantId: string): Promise<ReportRow[]> {
    return this.repo.reportsBy(tenantId);
  }
}
