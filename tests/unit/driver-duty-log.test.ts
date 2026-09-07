import type { PrismaClient } from '@prisma/client';
import { PrismaDriverService } from '../../src/modules/drivers/driver.service';

interface LogRow {
  id: string;
  tenantId: string;
  driverId: string;
  dutyStatus: string;
  startTime: Date;
  endTime: Date | null;
  ingestSource: string;
}

function buildService(initialStatus: string) {
  let driverStatus = initialStatus;
  const logs: LogRow[] = [];
  const fullRow = (status: string) => ({
    id: 'd1',
    tenantId: 't1',
    externalEldId: null,
    name: 'Maria Chen',
    licenseNumber: null,
    homeTerminalTz: 'America/Toronto',
    cycleType: 'CYCLE_1' as const,
    status,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const tx = {
    driver: {
      update: jest.fn(async ({ data }: { data: { status?: string } }) => {
        if (data.status) driverStatus = data.status;
        return fullRow(driverStatus);
      }),
    },
    hosLog: {
      findFirst: jest.fn(async () => logs.find((l) => l.endTime === null) ?? null),
      update: jest.fn(async ({ data }: { data: { endTime: Date } }) => {
        const open = logs.find((l) => l.endTime === null);
        if (open) open.endTime = data.endTime;
        return open;
      }),
      create: jest.fn(async ({ data }: { data: LogRow }) => {
        logs.push({ ...data, endTime: data.endTime ?? null, id: `log-${logs.length + 1}` });
        return logs[logs.length - 1];
      }),
    },
  };
  const prisma = {
    driver: {
      findFirst: jest.fn(async () => fullRow(driverStatus)),
      update: jest.fn(async ({ data }: { data: { status?: string } }) => {
        if (data.status) driverStatus = data.status;
        return fullRow(driverStatus);
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as Pick<PrismaClient, 'driver' | '$transaction'>;
  return {
    svc: new PrismaDriverService(prisma as unknown as PrismaClient),
    logs,
    prisma,
    tx,
  };
}

describe('driver duty transitions write HOS log segments', () => {
  it('going on duty opens an ON_DUTY_NOT_DRIVING segment with no end', async () => {
    const h = buildService('OFF_DUTY');
    await h.svc.update('t1', 'd1', { status: 'ACTIVE' });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0].dutyStatus).toBe('ON_DUTY_NOT_DRIVING');
    expect(h.logs[0].endTime).toBeNull();
    expect(h.logs[0].ingestSource).toBe('MANUAL');
  });

  it('going off duty closes the open segment and opens OFF_DUTY', async () => {
    const h = buildService('ACTIVE');
    // An in-progress on-duty segment already exists (e.g. from an earlier flip).
    h.logs.push({
      id: 'open-1',
      tenantId: 't1',
      driverId: 'd1',
      dutyStatus: 'ON_DUTY_NOT_DRIVING',
      startTime: new Date('2026-09-04T12:00:00Z'),
      endTime: null,
      ingestSource: 'MANUAL',
    });
    await h.svc.update('t1', 'd1', { status: 'OFF_DUTY' });
    expect(h.logs[0].endTime).not.toBeNull();
    expect(h.logs[1].dutyStatus).toBe('OFF_DUTY');
    expect(h.logs[1].endTime).toBeNull();
  });

  it('suspension closes on-duty time without opening a new active segment', async () => {
    const h = buildService('ACTIVE');
    h.logs.push({
      id: 'open-1',
      tenantId: 't1',
      driverId: 'd1',
      dutyStatus: 'ON_DUTY_NOT_DRIVING',
      startTime: new Date('2026-09-04T12:00:00Z'),
      endTime: null,
      ingestSource: 'MANUAL',
    });
    await h.svc.update('t1', 'd1', { status: 'SUSPENDED' });
    expect(h.logs[0].endTime).not.toBeNull();
    expect(h.logs[1].dutyStatus).toBe('OFF_DUTY');
  });

  it('same-status updates do not touch the log', async () => {
    const h = buildService('ACTIVE');
    await h.svc.update('t1', 'd1', { status: 'ACTIVE' });
    expect(h.logs).toHaveLength(0);
  });

  it('non-status updates leave the log alone', async () => {
    const h = buildService('ACTIVE');
    await h.svc.update('t1', 'd1', { name: 'Maria Chen' });
    expect(h.logs).toHaveLength(0);
  });
});