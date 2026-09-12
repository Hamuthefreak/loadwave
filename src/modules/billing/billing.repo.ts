import type { PrismaClient } from '@prisma/client';
import type { Plan } from './plan.policy';

export interface TenantPlanRow {
  tenantId: string;
  plan: string;
  trialEndsAt: Date | null;
  planChangedAt: Date | null;
}

export interface PlanRequestRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  requestedPlan: string;
  status: string;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface BillingRepo {
  plan(tenantId: string): Promise<TenantPlanRow | null>;
  setPlan(tenantId: string, plan: string, at: Date): Promise<void>;
  /** The tenant's open request, if any — at most one is allowed at a time. */
  openRequest(tenantId: string): Promise<PlanRequestRow | null>;
  createRequest(input: {
    tenantId: string;
    requestedPlan: Plan;
    requestedById: string | null;
    note?: string | null;
  }): Promise<PlanRequestRow>;
  requestById(id: string): Promise<PlanRequestRow | null>;
  listRequests(status: string): Promise<PlanRequestRow[]>;
  decideRequest(id: string, status: 'APPROVED' | 'DECLINED', note: string | null, at: Date): Promise<void>;
}

function mapRequest(row: {
  id: string;
  tenantId: string;
  requestedPlan: string;
  status: string;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  tenant?: { name: string } | null;
}): PlanRequestRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    requestedPlan: row.requestedPlan,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

export class PrismaBillingRepo implements BillingRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async plan(tenantId: string): Promise<TenantPlanRow | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, plan: true, trialEndsAt: true, planChangedAt: true },
    });
    if (!row) return null;
    return {
      tenantId: row.id,
      plan: row.plan,
      trialEndsAt: row.trialEndsAt,
      planChangedAt: row.planChangedAt,
    };
  }

  async setPlan(tenantId: string, plan: string, at: Date): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan, planChangedAt: at },
    });
  }

  async openRequest(tenantId: string): Promise<PlanRequestRow | null> {
    const row = await this.prisma.planRequest.findFirst({
      where: { tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapRequest(row) : null;
  }

  async createRequest(input: {
    tenantId: string;
    requestedPlan: Plan;
    requestedById: string | null;
    note?: string | null;
  }): Promise<PlanRequestRow> {
    const row = await this.prisma.planRequest.create({
      data: {
        tenantId: input.tenantId,
        requestedPlan: input.requestedPlan,
        requestedById: input.requestedById,
        note: input.note ?? null,
      },
    });
    return mapRequest(row);
  }

  async requestById(id: string): Promise<PlanRequestRow | null> {
    const row = await this.prisma.planRequest.findUnique({ where: { id } });
    return row ? mapRequest(row) : null;
  }

  async listRequests(status: string): Promise<PlanRequestRow[]> {
    const rows = await this.prisma.planRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { tenant: { select: { name: true } } },
    });
    return rows.map(mapRequest);
  }

  async decideRequest(
    id: string,
    status: 'APPROVED' | 'DECLINED',
    note: string | null,
    at: Date,
  ): Promise<void> {
    await this.prisma.planRequest.update({
      where: { id },
      data: { status, note, decidedAt: at },
    });
  }
}
