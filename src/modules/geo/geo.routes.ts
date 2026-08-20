import type { FastifyInstance } from 'fastify';
import type { GeoService } from './geo.service';

export interface GeoModuleDeps {
  geo: GeoService;
}

interface PlaceQuery {
  q?: string;
  country?: string;
}

export function registerGeoRoutes(app: FastifyInstance, deps: GeoModuleDeps): void {
  app.get<{ Querystring: PlaceQuery }>(
    '/api/geo/places',
    { preHandler: app.authenticate },
    async (request) => {
      const country = request.query.country?.toUpperCase() ?? 'CA';
      const results = await deps.geo.search(country, request.query.q ?? '');
      return results.map((r) => ({
        id: r.id,
        country: r.country,
        region: r.region,
        placeName: r.placeName,
        postalPrefix: r.postalPrefix,
        lat: r.lat,
        lon: r.lon,
        label: [r.placeName, r.region === r.placeName ? '' : r.region].filter(Boolean).join(', ') + (r.postalPrefix ? ` (${r.postalPrefix})` : ''),
      }));
    },
  );
}