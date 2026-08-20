import type { PrismaClient, CycleType } from '@prisma/client';
import { notFound } from '../../utils/errors';

export interface DriverRow {
  id: string;
  tenantId: string;
  externalEldId: string | null;
  name: string;
  licenseNumber: string | null;
  homeTerminalTz: string;
  cycleType: CycleType;
  status: string;
  createdAt: string;
}

export interface DriverCreateInput {
  externalEldId?: string | null;
  name: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
}

export interface DriverUpdateInput {
  name?: string;
  licenseNumber?: string | null;
  homeTerminalTz?: string;
  cycleType?: CycleType;
  status?: string;
}

export interface DriverService {
  list(tenantId: string): Promise<DriverRow[]>;
  get(tenantId: string, driverId: string): Promise<DriverRow>;
  create(tenantId: string, input: DriverCreateInput): Promise<DriverRow>;
  update(tenantId: string, driverId: string, input: DriverUpdateInput): Promise<DriverRow>;
}

export class PrismaDriverService implements DriverService {
  constructor(private readonly prisma: PrismaClient) {}

  private map(row: {
    id: string;
    tenantId: string;
    externalEldId: string | null;
    name: string;
    licenseNumber: string | null;
    homeTerminalTz: string;
    cycleType: CycleType;
    status: string;
    createdAt: Date;
  }): DriverRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      externalEldId: row.externalEldId,
      name: row.name,
      licenseNumber: row.licenseNumber,
      homeTerminalTz: row.homeTerminalTz,
      cycleType: row.cycleType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(tenantId: string): Promise<DriverRow[]> {
    const rows = await this.prisma.driver.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.map(r));
  }

  async get(tenantId: string, driverId: string): Promise<DriverRow> {
    const row = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!row) throw notFound('driver not found');
    return this.map(row);
  }

  async create(tenantId: string, input: DriverCreateInput): Promise<DriverRow> {
    const row = await this.prisma.driver.create({
      data: {
        tenantId,
        externalEldId: input.externalEldId ?? null,
        name: input.name,
        licenseNumber: input.licenseNumber ?? null,
        homeTerminalTz: input.homeTerminalTz ?? 'America/Toronto',
        cycleType: input.cycleType ?? 'CYCLE_1',
      },
    });
    return this.map(row);
  }

  async update(tenantId: string, driverId: string, input: DriverUpdateInput): Promise<DriverRow> {
    const existing = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId } });
    if (!existing) throw notFound('driver not found');
    const row = await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
        ...(input.homeTerminalTz !== undefined ? { homeTerminalTz: input.homeTerminalTz } : {}),
        ...(input.cycleType !== undefined ? { cycleType: input.cycleType } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    return this.map(row);
  }
}
