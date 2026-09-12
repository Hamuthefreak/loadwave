import type { FastifyReply, FastifyRequest } from 'fastify';
import { paymentRequired } from '../../utils/errors';
import { FEATURE_LABELS, PLAN_NAMES, cheapestPlanWith, hasFeature, type Feature } from './plan.policy';
import type { BillingService } from './billing.service';
import type { JwtUser } from '../auth/auth.types';

export interface FeatureGuardOptions {
  billing: BillingService;
  feature: Feature;
  /** The app's authenticate preHandler, used when the guard runs first. */
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/**
 * Blocks a route when the tenant's plan does not include its feature.
 *
 * The guard may be installed as a scope-level hook, which Fastify runs before
 * the route's own preHandler — so it authenticates when it has to, rather than
 * assuming the route already did. Unauthenticated callers still get a 401 from
 * authenticate; only an identified tenant can be told to upgrade.
 */
export function featureGuard(options: FeatureGuardOptions) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    let user = request.user as JwtUser | undefined;
    if (!user) {
      await options.authenticate(request, reply);
      if (reply.sent) return;
      user = request.user as JwtUser | undefined;
      if (!user) return;
    }

    const state = await options.billing.state(user.tenantId);
    if (hasFeature(state, options.feature)) return;

    const plan = cheapestPlanWith(options.feature);
    const suffix = plan ? ` Upgrade to ${PLAN_NAMES[plan]} to use it.` : '';
    throw paymentRequired(
      `${FEATURE_LABELS[options.feature]} is not included in your current plan.${suffix}`,
    );
  };
}
