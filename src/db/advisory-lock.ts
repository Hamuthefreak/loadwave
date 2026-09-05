import type { PrismaClient } from '@prisma/client';

/**
 * Runs `fn` only if this process holds a Postgres advisory lock named `name`.
 *
 * Every app instance (e.g. after horizontal scaling) calls the same scheduled
 * jobs, but only one may run them at a time. The lock is held for the duration
 * of `fn` and released afterwards. Returns the result of `fn`, or null when
 * another process held the lock.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaClient,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const [acquired] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${name})) AS ok
  `;
  if (!acquired?.ok) return null;
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${name}))
    `.catch(() => {
      /* best effort: the session lock dies with the connection anyway */
    });
  }
}
