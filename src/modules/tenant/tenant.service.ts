import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';

export interface TenantRow {
  id: string;
  name: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  verified: boolean;
  createdAt: string;
}

export interface TenantService {
  getTenant(tenantId: string): Promise<TenantRow>;
  updateTenant(
    tenantId: string,
    data: Partial<{
      name: string;
      baseCurrency: string;
      baseJurisdiction: string;
      mcNumber: string;
      usdotNumber: string;
    }>,
  ): Promise<TenantRow>;
}

export class PrismaTenantService implements TenantService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: {
    id: string;
    name: string;
    baseCurrency: string;
    baseJurisdiction: string;
    mcNumber?: string | null;
    usdotNumber?: string | null;
    createdAt: Date;
  }): TenantRow {
    return {
      id: row.id,
      name: row.name,
      baseCurrency: row.baseCurrency,
      baseJurisdiction: row.baseJurisdiction,
      mcNumber: row.mcNumber ?? null,
      usdotNumber: row.usdotNumber ?? null,
      verified: Boolean(row.mcNumber || row.usdotNumber),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getTenant(tenantId: string): Promise<TenantRow> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!row) throw notFound('tenant not found');
    return this.map(row);
  }

  async updateTenant(
    tenantId: string,
    data: Partial<{
      name: string;
      baseCurrency: string;
      baseJurisdiction: string;
      mcNumber: string;
      usdotNumber: string;
    }>,
  ): Promise<TenantRow> {
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.baseCurrency !== undefined ? { baseCurrency: data.baseCurrency } : {}),
        ...(data.baseJurisdiction !== undefined ? { baseJurisdiction: data.baseJurisdiction } : {}),
        ...(data.mcNumber !== undefined ? { mcNumber: data.mcNumber } : {}),
        ...(data.usdotNumber !== undefined ? { usdotNumber: data.usdotNumber } : {}),
      },
    });
    return this.map(row);
  }
}
