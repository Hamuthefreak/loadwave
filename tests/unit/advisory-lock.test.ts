/**
 * The scheduled jobs (recurring loads, saved-search alerts, lane snapshots)
 * run on every instance, so they take a Postgres advisory lock: only the
 * process that acquires it acts. This pins that contract and the unlock.
 */
import { withAdvisoryLock } from '../../src/db/advisory-lock';
import type { PrismaClient } from '@prisma/client';

function fakePrisma(acquired: boolean) {
  const calls: unknown[][] = [];
  const prisma = {
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      calls.push(args);
      // The first tagged-template call is the try-lock probe.
      return calls.length === 1 ? [{ ok: acquired }] : [];
    }),
  } as unknown as PrismaClient;
  return { prisma, calls };
}

describe('withAdvisoryLock', () => {
  it('runs the job and releases the lock when acquired', async () => {
    const { prisma, calls } = fakePrisma(true);
    const job = jest.fn(async () => 'done');

    await expect(withAdvisoryLock(prisma, 'loadwave:recurring-loads', job)).resolves.toBe('done');

    expect(job).toHaveBeenCalledTimes(1);
    // Probe + unlock.
    expect(calls).toHaveLength(2);
  });

  it('skips the job entirely when another process holds the lock', async () => {
    const { prisma } = fakePrisma(false);
    const job = jest.fn(async () => 'done');

    await expect(withAdvisoryLock(prisma, 'loadwave:recurring-loads', job)).resolves.toBeNull();

    expect(job).not.toHaveBeenCalled();
  });

  it('releases the lock even when the job throws', async () => {
    const { prisma, calls } = fakePrisma(true);
    const job = jest.fn(async () => {
      throw new Error('job blew up');
    });

    await expect(withAdvisoryLock(prisma, 'loadwave:recurring-loads', job)).rejects.toThrow('job blew up');

    expect(calls).toHaveLength(2);
  });
});
