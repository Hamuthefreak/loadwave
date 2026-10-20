import { availabilityFor } from '../../src/modules/availability/availability.policy';
import {
  GeoIpLookup,
  clientIp,
  isPublicIp,
} from '../../src/modules/availability/geoip.service';

describe('availability policy', () => {
  it('allows Canada, the United States and Mexico', () => {
    for (const country of ['CA', 'US', 'MX', 'ca']) {
      expect(availabilityFor(country)).toMatchObject({
        available: true,
        checked: true,
        region: 'north-america',
        country: country.toUpperCase(),
      });
    }
  });

  it('allows Europe', () => {
    for (const country of ['GB', 'FR', 'DE', 'IE', 'SE', 'PL']) {
      expect(availabilityFor(country)).toMatchObject({
        available: true,
        checked: true,
        region: 'europe',
      });
    }
  });

  it('blocks a country outside both regions', () => {
    expect(availabilityFor('BR')).toEqual({
      country: 'BR',
      region: null,
      available: false,
      checked: true,
    });
    expect(availabilityFor('AU').available).toBe(false);
  });

  it('fails open when no country could be resolved', () => {
    // An outage at the geo provider must not close the product to everyone.
    expect(availabilityFor(null)).toMatchObject({ available: true, checked: false, country: null });
    expect(availabilityFor(undefined)).toMatchObject({ available: true, checked: false });
    expect(availabilityFor('not-a-country')).toMatchObject({ available: true, checked: false });
  });
});

describe('public address detection', () => {
  it('rejects loopback, private and malformed addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '::1', 'nope']) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });

  it('accepts a public address', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2001:4860:4860::8888')).toBe(true);
  });
});

describe('client address', () => {
  const request = (headers: Record<string, string>, ip = '127.0.0.1') =>
    ({ headers, ip }) as Parameters<typeof clientIp>[0];

  it('uses the address nginx recorded', () => {
    expect(clientIp(request({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8');
  });

  it('does not treat a private proxy address as the visitor', () => {
    expect(clientIp(request({ 'x-real-ip': '10.0.0.2' }))).toBeNull();
    expect(clientIp(request({}, '127.0.0.1'))).toBeNull();
  });
});

describe('GeoIpLookup', () => {
  const response = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as Response;

  it('reads and caches the country', async () => {
    const fetcher = jest.fn(async () => response({ success: true, country_code: 'us' }));
    const geoip = new GeoIpLookup({ url: 'https://geo.test/{ip}', fetcher });

    await expect(geoip.countryFor('8.8.8.8')).resolves.toBe('US');
    await expect(geoip.countryFor('8.8.8.8')).resolves.toBe('US');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://geo.test/8.8.8.8',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('returns null for a failed or malformed answer', async () => {
    const denied = new GeoIpLookup({
      url: 'https://geo.test/{ip}',
      fetcher: jest.fn(async () => response({}, false)),
    });
    await expect(denied.countryFor('8.8.8.8')).resolves.toBeNull();

    const malformed = new GeoIpLookup({
      url: 'https://geo.test/{ip}',
      fetcher: jest.fn(async () => response({ success: false, country_code: 'US' })),
    });
    await expect(malformed.countryFor('8.8.8.8')).resolves.toBeNull();
  });

  it('does not call the provider for a private address', async () => {
    const fetcher = jest.fn(async () => response({ success: true, country_code: 'CA' }));
    const geoip = new GeoIpLookup({ url: 'https://geo.test/{ip}', fetcher });
    await expect(geoip.countryFor('127.0.0.1')).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats an empty URL as switched off', async () => {
    const fetcher = jest.fn(async () => response({ success: true, country_code: 'CA' }));
    const geoip = new GeoIpLookup({ url: '', fetcher });
    await expect(geoip.countryFor('8.8.8.8')).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('survives a throwing provider', async () => {
    const geoip = new GeoIpLookup({
      url: 'https://geo.test/{ip}',
      fetcher: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    await expect(geoip.countryFor('8.8.8.8')).resolves.toBeNull();
  });
});
