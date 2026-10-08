import {
  ARRIVAL_RADIUS_KM,
  milestonesFor,
  placeName,
  publicStatus,
  roundPosition,
  trackingProgress,
  type TrackFix,
  type TrackStopInput,
} from '../../src/modules/tracking/tracking.policy';
import { trackingLink, trackingToken, verifyTrackingToken } from '../../src/modules/tracking/tracking.token';

const TORONTO = { lat: 43.6532, lon: -79.3832 };
const MONTREAL = { lat: 45.5019, lon: -73.5674 };

const fix = (at: string, point: { lat: number; lon: number }): TrackFix => ({ at, ...point });

const stop = (over: Partial<TrackStopInput> & { id: string }): TrackStopInput => ({
  kind: 'ORIGIN',
  stopOrder: 1,
  country: 'CA',
  region: 'QC',
  locality: 'Montréal',
  lat: MONTREAL.lat,
  lon: MONTREAL.lon,
  scheduledAt: null,
  ...over,
});

describe('milestones from the trail', () => {
  it('records arrival as the first fix inside the fence and departure as the first one out', () => {
    const stops = [stop({ id: 's1', scheduledAt: '2026-10-05T08:00:00Z' })];
    const fixes = [
      fix('2026-10-05T07:30:00Z', { lat: 45.383, lon: -73.5674 }), // 13 km out: not here yet
      fix('2026-10-05T08:45:00Z', MONTREAL),
      fix('2026-10-05T10:15:00Z', { lat: 45.60, lon: -73.40 }), // ~15 km away: gone
    ];
    const [m] = milestonesFor(stops, fixes);
    expect(m.arrivedAt).toBe('2026-10-05T08:45:00Z');
    expect(m.departedAt).toBe('2026-10-05T10:15:00Z');
    expect(m.dwellMinutes).toBe(90);
    expect(m.lateMinutes).toBe(45);
  });

  it('counts a fix inside the fence and leaves the departure open', () => {
    const stops = [stop({ id: 's1' })];
    const fixes = [fix('2026-10-05T08:45:00Z', MONTREAL), fix('2026-10-05T09:30:00Z', MONTREAL)];
    const [m] = milestonesFor(stops, fixes);
    expect(m.arrivedAt).toBe('2026-10-05T08:45:00Z');
    expect(m.departedAt).toBeNull();
    expect(m.dwellMinutes).toBeNull();
  });

  it('reports a negative lateness for an early arrival', () => {
    const stops = [stop({ id: 's1', scheduledAt: '2026-10-05T09:30:00Z' })];
    const [m] = milestonesFor(stops, [fix('2026-10-05T08:45:00Z', MONTREAL)]);
    expect(m.lateMinutes).toBe(-45);
  });

  it('records nothing for a stop the truck never reached', () => {
    const stops = [stop({ id: 's1' })];
    const [m] = milestonesFor(stops, [fix('2026-10-05T08:45:00Z', TORONTO)]);
    expect(m.arrivedAt).toBeNull();
    expect(m.departedAt).toBeNull();
    expect(m.lateMinutes).toBeNull();
  });

  it('records nothing for a stop with no coordinate, rather than guessing one', () => {
    const stops = [stop({ id: 's1', lat: null, lon: null })];
    const [m] = milestonesFor(stops, [fix('2026-10-05T08:45:00Z', MONTREAL)]);
    expect(m.arrivedAt).toBeNull();
    expect(m.place).toBe('Montréal, QC');
  });

  it('sorts stray fixes into time order before reading the trail', () => {
    const stops = [stop({ id: 's1' })];
    const outOfOrder = [
      fix('2026-10-05T10:15:00Z', { lat: 45.60, lon: -73.40 }),
      fix('2026-10-05T08:45:00Z', MONTREAL),
    ];
    const [m] = milestonesFor(stops, outOfOrder);
    expect(m.arrivedAt).toBe('2026-10-05T08:45:00Z');
    expect(m.departedAt).toBe('2026-10-05T10:15:00Z');
  });

  it('orders stops by stopOrder, not by the order they were passed in', () => {
    const stops = [
      stop({ id: 'delivery', kind: 'DELIVERY', stopOrder: 2, region: 'ON', locality: 'Toronto', lat: TORONTO.lat, lon: TORONTO.lon }),
      stop({ id: 'origin', stopOrder: 1 }),
    ];
    const milestones = milestonesFor(stops, []);
    expect(milestones.map((m) => m.stopId)).toEqual(['origin', 'delivery']);
  });

  it('uses a fence a yard can actually fit inside', () => {
    expect(ARRIVAL_RADIUS_KM).toBe(0.75);
    // 700 m from the stop is inside; 900 m is not.
    const stops = [stop({ id: 's1' })];
    expect(milestonesFor(stops, [fix('2026-10-05T08:00:00Z', { lat: 45.508, lon: -73.5674 })])[0].arrivedAt).not.toBeNull();
    expect(milestonesFor(stops, [fix('2026-10-05T08:00:00Z', { lat: 45.5101, lon: -73.5674 })])[0].arrivedAt).toBeNull();
  });
});

describe('progress and headline', () => {
  const stops = [
    stop({ id: 'origin', stopOrder: 1, scheduledAt: '2026-10-05T08:00:00Z' }),
    stop({
      id: 'delivery',
      kind: 'DELIVERY',
      stopOrder: 2,
      region: 'ON',
      locality: 'Toronto',
      lat: TORONTO.lat,
      lon: TORONTO.lon,
    }),
  ];

  it('says there is no position rather than inventing movement', () => {
    const progress = trackingProgress(stops, []);
    expect(progress.lastFix).toBeNull();
    expect(progress.current?.stopId).toBe('origin');
    expect(progress.headline).toBe('No position reported yet — next: Montréal, QC');
  });

  it('reports on site with the time, once a fix is inside the fence', () => {
    const progress = trackingProgress(stops, [fix('2026-10-05T08:45:00Z', MONTREAL)]);
    expect(progress.current?.stopId).toBe('origin');
    expect(progress.headline).toBe('On site at Montréal, QC since 08:45Z');
  });

  it('moves to the next stop once the first is departed', () => {
    const progress = trackingProgress(stops, [
      fix('2026-10-05T08:45:00Z', MONTREAL),
      fix('2026-10-05T10:15:00Z', { lat: 45.60, lon: -73.40 }),
    ]);
    expect(progress.current?.stopId).toBe('delivery');
    expect(progress.kmToCurrent).toBeGreaterThan(400);
    expect(progress.headline).toContain('En route to Toronto, ON');
  });

  it('narrows the wording when the truck is close', () => {
    const progress = trackingProgress(stops, [
      fix('2026-10-05T08:45:00Z', MONTREAL),
      fix('2026-10-05T10:15:00Z', { lat: 45.60, lon: -73.40 }),
      fix('2026-10-05T14:00:00Z', { lat: 43.75, lon: -79.35 }), // ~11 km from Toronto
    ]);
    expect(progress.headline).toBe('Nearing Toronto, ON (11 km out)');
  });

  it('says delivered once the last stop is behind the truck', () => {
    const progress = trackingProgress(stops, [
      fix('2026-10-05T08:45:00Z', MONTREAL),
      fix('2026-10-05T10:15:00Z', { lat: 45.6, lon: -73.4 }),
      fix('2026-10-05T16:00:00Z', TORONTO),
      fix('2026-10-05T17:30:00Z', { lat: 43.9, lon: -78.9 }),
    ]);
    expect(progress.current).toBeNull();
    expect(progress.headline).toBe('Delivered — left Toronto, ON');
  });

  it('handles a load with no stops at all', () => {
    const progress = trackingProgress([], [fix('2026-10-05T08:45:00Z', MONTREAL)]);
    expect(progress.headline).toBe('No stops on this load yet');
    expect(progress.current).toBeNull();
  });
});

describe('the public projection', () => {
  it('maps internal statuses onto what a customer is told', () => {
    expect(publicStatus('OPEN')).toEqual({ code: 'BOOKED', label: 'Booked' });
    expect(publicStatus('ASSIGNED')).toEqual({ code: 'BOOKED', label: 'Booked' });
    expect(publicStatus('IN_TRANSIT')).toEqual({ code: 'IN_TRANSIT', label: 'In transit' });
    expect(publicStatus('DELIVERED')).toEqual({ code: 'DELIVERED', label: 'Delivered' });
    expect(publicStatus('INVOICED')).toEqual({ code: 'DELIVERED', label: 'Delivered' });
  });

  it('rounds a position to roughly a hundred metres', () => {
    expect(roundPosition({ lat: 43.65322612, lon: -79.38318431 })).toEqual({
      lat: 43.653,
      lon: -79.383,
    });
  });

  it('names a place from the geography we store, never a guessed address', () => {
    expect(placeName({ locality: 'Toronto', region: 'ON', country: 'CA' })).toBe('Toronto, ON');
    expect(placeName({ locality: 'Buffalo', region: 'NY', country: 'US' })).toBe('Buffalo, NY, US');
    expect(placeName({ locality: null, region: 'QC', country: 'CA' })).toBe('QC');
    expect(placeName({ locality: null, region: '', country: 'CA' })).toBe('Unnamed stop');
  });
});

describe('the tracking token', () => {
  const SECRET = 'test-access-secret-0123456789abcdef';

  it('is derived, stable, and specific to the load', () => {
    const token = trackingToken('load-a', SECRET);
    expect(token).toBe(trackingToken('load-a', SECRET));
    expect(token).not.toBe(trackingToken('load-b', SECRET));
    expect(token).toHaveLength(32);
    expect(verifyTrackingToken('load-a', token, SECRET)).toBe(true);
  });

  it('rejects a token issued for another load', () => {
    expect(verifyTrackingToken('load-a', trackingToken('load-b', SECRET), SECRET)).toBe(false);
  });

  it('rejects a token signed with another secret — a redeploy rotates it', () => {
    const old = trackingToken('load-a', 'a-different-secret-0123456789');
    expect(verifyTrackingToken('load-a', old, SECRET)).toBe(false);
  });

  it('answers false for every degenerate case instead of throwing', () => {
    expect(verifyTrackingToken('load-a', undefined, SECRET)).toBe(false);
    expect(verifyTrackingToken('load-a', '', SECRET)).toBe(false);
    expect(verifyTrackingToken('load-a', 'short', SECRET)).toBe(false);
    expect(verifyTrackingToken('load-a', trackingToken('load-a', SECRET), '')).toBe(false);
    expect(verifyTrackingToken('', trackingToken('load-a', SECRET), SECRET)).toBe(false);
  });

  it('builds a link with no trailing-slash doubling', () => {
    expect(trackingLink('https://demo.loadwave.app/', 'load-a', SECRET)).toBe(
      `https://demo.loadwave.app/track/load-a/${trackingToken('load-a', SECRET)}`,
    );
  });
});
