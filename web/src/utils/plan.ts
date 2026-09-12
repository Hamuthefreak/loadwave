import { useEffect, useState } from 'react';
import { api, getTokenUser } from '../api';
import type { PlanOverview } from './planLock';
import { readPlanCache, writePlanCache } from './planCache';

/**
 * The signed-in tenant's plan, fetched once and shared by every screen that
 * needs to know what is locked.
 *
 * The cache is keyed by tenant id and cleared when credentials are discarded
 * (see planCache.ts), so one account's entitlements are never shown to another.
 */
export function usePlan(): { plan: PlanOverview | null; loading: boolean } {
  const tenantId = getTokenUser()?.tenantId ?? '';
  const known = tenantId ? (readPlanCache(tenantId) ?? null) : null;
  const [plan, setPlan] = useState<PlanOverview | null>(known);
  const [loading, setLoading] = useState(!known && tenantId !== '');

  useEffect(() => {
    if (!tenantId) {
      setPlan(null);
      setLoading(false);
      return;
    }
    const hit = readPlanCache(tenantId);
    if (hit) {
      setPlan(hit);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    api<PlanOverview>('/api/billing/plan')
      .then((res) => {
        writePlanCache(tenantId, res);
        if (alive) setPlan(res);
      })
      .catch(() => {
        // Fail open: an unreadable plan locks nothing (see planLock.ts).
        if (alive) setPlan(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [tenantId]);

  return { plan, loading };
}
