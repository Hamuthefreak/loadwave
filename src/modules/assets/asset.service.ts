import type { PrismaClient, AssetType } from '@prisma/client';
import { notFound } from '../../utils/errors';

export interface AssetRow {
  id: string;
  tenantId: string;
  vin: string | null;
  powerUnitNumber: string | null;
  assetType: AssetType;
  eldDeviceId: string | null;
  createdAt: string;
}

export interface AssetCreateInput {
  vin?: string | null;
  powerUnitNumber?: string | null;
  assetType?: AssetType;
  eldDeviceId?: string | null;
}

export interface AssetService {
  list(tenantId: string): Promise<AssetRow[]>;
  get(tenantId: string, assetId: string): Promise<AssetRow>;
  create(tenantId: string, input: AssetCreateInput): Promise<AssetRow>;
}

export class PrismaAssetService implements AssetService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: {
    id: string;
    tenantId: string;
    vin: string | null;
    powerUnitNumber: string | null;
    assetType: AssetType;
    eldDeviceId: string | null;
    createdAt: Date;
  }): AssetRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      vin: row.vin,
      powerUnitNumber: row.powerUnitNumber,
      assetType: row.assetType,
      eldDeviceId: row.eldDeviceId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(tenantId: string): Promise<AssetRow[]> {
    const rows = await this.prisma.asset.findMany({
      where: { tenantId },
      orderBy: { powerUnitNumber: 'asc' },
    });
    return rows.map((r) => this.map(r));
  }

  async get(tenantId: string, assetId: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!row) throw notFound('asset not found');
    return this.map(row);
  }

  async create(tenantId: string, input: AssetCreateInput): Promise<AssetRow> {
    const row = await this.prisma.asset.create({
      data: {
        tenantId,
        vin: input.vin ?? null,
        powerUnitNumber: input.powerUnitNumber ?? null,
        assetType: input.assetType ?? 'TRACTOR',
        eldDeviceId: input.eldDeviceId ?? null,
      },
    });
    return this.map(row);
  }
}
