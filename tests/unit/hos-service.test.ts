import type { PrismaClient } from '@prisma/client';
import { PrismaHosService } from '../../src/modules/hos/hos.service';

const AS_OF = new Date('2026-09-05T00:00:00Z');

// Hours after a base ISO instant, kept inside the rolling windows.
function plusHours(iso: string, hours: number): Date {
  return new Date(new Date(iso).getTime() + hours * 3_600_000);
}

function buildService(rows: {
  drivers: Array<{ id: string; cycleType: 'CYCLE_1' | 'CYCLE_2'; status?: string }>;
  logs?: Array<{
    driverId: string;
    dutyStatus: string;
    startTime: Date;
    endTime: Date | null;
  }>;
}) {
  const prisma = {
    driver: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const d = rows.drivers.find((x) => x.id === where.id);
        return d
          ? {
              id: d.id,
              tenantId: where.tenantId,
              cycleType: d.cycleType,
              status: d.status ?? 'ACTIVE',
              homeTerminalTz: 'America/Toronto',
            }
          : null;
      }),
      findMany: jest.fn(async () =>
        rows.drivers.map((d) => ({ id: d.id, cycleType: d.cycleType })),
      ),
    },
    hosLog: {
      findMany: jest.fn(async ({ where }: { where: { driverId?: unknown } }) =>
        (rows.logs ?? []).filter((l) => {
          const dw = where.driverId as string | { in?: string[] } | undefined;
          if (typeof dw === 'string') return l.driverId === dw;
          if (dw && Array.isArray(dw.in)) return dw.in.includes(l.driverId);
          return true;
        }),
      ),
    },
  } as unknown as Pick<PrismaClient, 'driver' | 'hosLog'>;
  return new PrismaHosService(prisma as unknown as PrismaClient);
}

describe('PrismaHosService cycle computation', () => {
  it('getStatus returns remaining hours for a single driver', async () => {
    const svc = buildService({
      drivers: [{ id: 'd1', cycleType: 'CYCLE_1' }],
      logs: [
        {
          driverId: 'd1',
          dutyStatus: 'DRIVING',
          startTime: new Date('2026-09-01T00:00:00Z'),
          endTime: new Date('2026-09-01T10:00:00Z'),
        },
      ],
    });
    const status = await svc.getStatus('t1', 'd1', AS_OF);
    expect(status).toMatchObject({ driverId: 'd1', status: 'ACTIVE', segments: 1 });
    expect(status.onDutyHours7).toBeCloseTo(10, 6);
    expect(status.remaining7).toBeCloseTo(60, 6);
    expect(status.violations).toEqual([]);
  });

  it('overview flags a driver who exceeded their cycle', async () => {
    const svc = buildService({
      drivers: [{ id: 'd1', cycleType: 'CYCLE_1' }],
      logs: [
        {
          driverId: 'd1',
          dutyStatus: 'DRIVING',
          startTime: plusHours('2026-08-30T00:00:00Z', 0),
          endTime: plusHours('2026-08-30T00:00:00Z', 40),
        },
        {
          driverId: 'd1',
          dutyStatus: 'ON_DUTY_NOT_DRIVING',
          startTime: plusHours('2026-09-02T00:00:00Z', 0),
          endTime: plusHours('2026-09-02T00:00:00Z', 35),
        },
      ],
    });
    const rows = await svc.overview('t1', AS_OF);
    expect(rows).toHaveLength(1);
    expect(rows[0].onDutyHours7).toBeCloseTo(75, 6);
    expect(rows[0].remaining7).toBe(0);
    expect(rows[0].violations.some((v) => v.includes('exceeded'))).toBe(true);
  });

  it('dailyLog buckets segments into the driver-local calendar days', async () => {
    const svc = buildService({
      drivers: [{ id: 'd1', cycleType: 'CYCLE_1' }],
      logs: [
        {
          driverId: 'd1',
          dutyStatus: 'DRIVING',
          // 2026-09-04 06:00→10:00 EDT (America/Toronto, UTC-4 in September)
          startTime: new Date('2026-09-04T10:00:00Z'),
          endTime: new Date('2026-09-04T14:00:00Z'),
        },
        {
          driverId: 'd1',
          dutyStatus: 'OFF_DUTY',
          startTime: new Date('2026-09-04T14:00:00Z'),
          endTime: new Date('2026-09-04T22:00:00Z'),
        },
      ],
    });
    // 2026-09-05 00:00Z = 2026-09-04 20:00 local
    const log = await svc.dailyLog('t1', 'd1', 2, new Date('2026-09-05T00:00:00Z'));
    expect(log.days).toHaveLength(2);
    expect(log.days[0].date).toBe('2026-09-04');
    expect(log.days[0].onDutyMinutes).toBe(240);
    expect(log.days[0].offDutyMinutes).toBe(480);
    expect(log.days[0].segments).toHaveLength(2);
    expect(log.days[1].date).toBe('2026-09-03');
    expect(log.days[1].onDutyMinutes).toBe(0);
  });

  it('dailyLog counts an open (in-progress) segment through the as-of instant', async () => {
    const svc = buildService({
      drivers: [{ id: 'd1', cycleType: 'CYCLE_1' }],
      logs: [
        {
          driverId: 'd1',
          dutyStatus: 'ON_DUTY_NOT_DRIVING',
          startTime: new Date('2026-09-04T12:00:00Z'),
          endTime: null,
        },
      ],
    });
    // 08:00→12:00 EDT = 4h on duty; the segment crosses midnight local?
    // No — 12:00Z = 08:00 local, and asOf 18:00Z = 14:00 local, same day.
    const log = await svc.dailyLog('t1', 'd1', 1, new Date('2026-09-04T18:00:00Z'));
    expect(log.days[0].onDutyMinutes).toBe(360);
    expect(log.days[0].segments[0].endTime).toBeNull();
  });

  it('overview returns every driver (even with no logs) and cycle-2 14-day data', async () => {
    const svc = buildService({
      drivers: [
        { id: 'd1', cycleType: 'CYCLE_1' },
        { id: 'd2', cycleType: 'CYCLE_2' },
      ],
    });
    const rows = await svc.overview('t1', AS_OF);
    expect(rows).toHaveLength(2);
    const d1 = rows.find((r) => r.driverId === 'd1')!;
    const d2 = rows.find((r) => r.driverId === 'd2')!;
    expect(d1.remaining7).toBe(70);
    expect(d1.limit14).toBeNull();
    expect(d2.remaining7).toBe(70);
    expect(d2.remaining14).toBe(120);
    expect(d2.limit14).toBe(120);
  });
});
