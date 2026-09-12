import type { PlanOverview } from './planLock';

/**
 * The signed-in tenant's plan, keyed by tenant id.
 *
 * Lives in its own module with no imports on purpose: the auth layer clears it
 * on sign-out (so one account's entitlements can never survive into the next
 * session — the same mistake the offline cache made), and it must be able to do
 * that without importing the hook that reads it.
 */
const cache = new Map<string, PlanOverview>();

export function readPlanCache(tenantId: string): PlanOverview | undefined {
  return cache.get(tenantId);
}

export function writePlanCache(tenantId: string, plan: PlanOverview): void {
  cache.set(tenantId, plan);
}

/** Drop everything — called whenever credentials are discarded. */
export function clearPlanCache(): void {
  cache.clear();
}
