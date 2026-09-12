import type { PrismaClient } from '@prisma/client';
import { notFound } from '../../utils/errors';
import { verificationState, type VerificationState } from '../trust/fmcsa.policy';

export interface TenantRow {
  id: string;
  name: string;
  baseCurrency: string;
  baseJurisdiction: string;
  mcNumber: string | null;
  usdotNumber: string | null;
  /**
   * true only when FMCSA confirmed the carrier may operate. An MC number on
   * file is not verification, so this is no longer derived from its presence.
   */
  verified: boolean;
  /** Lets the UI say "FMCSA checked" vs "self-declared" instead of guessing. */
  verification: VerificationState;
  fmcsaCheckedAt: string | null;
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
    fmcsaStatus?: string | null;
    fmcsaCheckedAt?: Date | null;
    createdAt: Date;
  }): TenantRow {
    const verification = verificationState({
      mcNumber: row.mcNumber ?? null,
      usdotNumber: row.usdotNumber ?? null,
      checkedAt: row.fmcsaCheckedAt ?? null,
      checkStatus: row.fmcsaStatus ?? null,
      now: new Date(),
      // Only affects the wording of the note; the state is the same either way.
      enabled: true,
    });
    return {
      id: row.id,
      name: row.name,
      baseCurrency: row.baseCurrency,
      baseJurisdiction: row.baseJurisdiction,
      mcNumber: row.mcNumber ?? null,
      usdotNumber: row.usdotNumber ?? null,
      verified: verification.verified,
      verification: verification.state,
      fmcsaCheckedAt: row.fmcsaCheckedAt ? row.fmcsaCheckedAt.toISOString() : null,
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
