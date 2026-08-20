import { bookingTruckAllowed, matchesTruckFilters } from '../../src/modules/trucks/truck.policy';

const row = {
  locationCountry: 'CA',
  locationRegion: 'QC',
  equipmentType: 'DRY_VAN',
  trailerType: 'Flatbed',
  rateAmount: '1850',
  postedByTenantName: 'Maple Haulers',
};

describe('truck board policy', () => {
  it('filters by region and equipment case-insensitively', () => {
    expect(matchesTruckFilters(row, { locationRegion: 'qc' })).toBe(true);
    expect(matchesTruckFilters(row, { equipmentType: 'dry_van' })).toBe(true);
    expect(matchesTruckFilters(row, { locationRegion: 'ON' })).toBe(false);
    expect(matchesTruckFilters(row, { equipmentType: 'REEFER' })).toBe(false);
  });

  it('searches free text across region, equipment and carrier', () => {
    expect(matchesTruckFilters(row, { q: 'maple' })).toBe(true);
    expect(matchesTruckFilters(row, { q: 'flat' })).toBe(true);
    expect(matchesTruckFilters(row, { q: 'texas' })).toBe(false);
  });

  it('applies rate range filters', () => {
    expect(matchesTruckFilters(row, { minRate: '1500' })).toBe(true);
    expect(matchesTruckFilters(row, { minRate: '2000' })).toBe(false);
    expect(matchesTruckFilters(row, { maxRate: '2000' })).toBe(true);
    expect(matchesTruckFilters(row, { maxRate: '1000' })).toBe(false);
  });

  it('blocks booking your own truck or a non-active listing', () => {
    expect(bookingTruckAllowed('ACTIVE', 'a', 'b').ok).toBe(true);
    expect(bookingTruckAllowed('ACTIVE', 'a', 'a').ok).toBe(false);
    const booked = bookingTruckAllowed('BOOKED', 'a', 'b');
    expect(booked.ok).toBe(false);
    expect(booked.reason).toContain('no longer available');
  });
});