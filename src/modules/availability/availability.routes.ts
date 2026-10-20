import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  UNAVAILABLE_MESSAGE,
  availabilityFor,
} from './availability.policy';
import { clientIp, type GeoIpLookup } from './geoip.service';

interface AvailabilityDeps {
  geoip: GeoIpLookup;
}

export function registerAvailabilityRoutes(app: FastifyInstance, deps: AvailabilityDeps): void {
  /**
   * Public on purpose: the marketing site asks before anyone signs in. It
   * returns only the decision, never the address it was derived from.
   */
  app.get('/api/availability', async (request) => {
    const country = await deps.geoip.countryFor(clientIp(request));
    return availabilityFor(country);
  });
}

/**
 * Registration is the one server action worth enforcing here. Browsing from a
 * blocked country is harmless, but creating a company that cannot be
 * supported should not be possible just because the page's JavaScript was
 * bypassed. Sign-in is deliberately not blocked: a traveller should not lose
 * access to their existing account.
 */
export function availabilityGuard(geoip: GeoIpLookup) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/auth/register') return;

    const country = await geoip.countryFor(clientIp(request));
    const status = availabilityFor(country);
    if (status.checked && !status.available) {
      await reply.code(403).send({ error: 'UNAVAILABLE', message: UNAVAILABLE_MESSAGE });
    }
  };
}
