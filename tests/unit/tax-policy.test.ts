import { determineTax, toJson } from '../../src/modules/invoicing/tax.policy';

describe('tax policy (GST/HST/QST for freight)', () => {
  it('applies GST + QST for a domestic Quebec movement', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'ON',
      destinationCountry: 'CA',
      destinationRegion: 'QC',
    });
    expect(det.zeroRated).toBe(false);
    expect(det.gstRate.toString()).toBe('0.05');
    expect(det.qstRate.toString()).toBe('0.09975');
    expect(det.hstRate.toString()).toBe('0');
    expect(toJson(det).totalRate).toBe('0.14975');
  });

  it('applies 13% HST for an Ontario destination (multi-province domestic supply)', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'QC',
      destinationCountry: 'CA',
      destinationRegion: 'ON',
      isInternational: false,
    });
    expect(det.zeroRated).toBe(false);
    expect(det.hstRate.toString()).toBe('0.13');
    expect(det.gstRate.toString()).toBe('0');
    expect(det.qstRate.toString()).toBe('0');
  });

  it('applies 15% HST for Nova Scotia destination', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'QC',
      destinationCountry: 'CA',
      destinationRegion: 'NS',
    });
    expect(det.hstRate.toString()).toBe('0.15');
  });

  it('applies GST only for a non-HST province (e.g. Alberta)', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'ON',
      destinationCountry: 'CA',
      destinationRegion: 'AB',
    });
    expect(det.gstRate.toString()).toBe('0.05');
    expect(det.hstRate.toString()).toBe('0');
    expect(det.zeroRated).toBe(false);
  });

  it('zero-rates international outbound Canada->US freight', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'QC',
      destinationCountry: 'US',
      destinationRegion: 'NY',
      isInternational: true,
    });
    expect(det.zeroRated).toBe(true);
    expect(det.taxExemptReason).toBe('INTERNATIONAL_OUTBOUND');
    expect(det.gstRate.toString()).toBe('0');
  });

  it('zero-rates continuous inbound/outbound international movements', () => {
    const det = determineTax({
      originCountry: 'US',
      originRegion: 'NY',
      destinationCountry: 'CA',
      destinationRegion: 'ON',
      isInternational: false,
      isContinuousInboundOutbound: true,
    });
    expect(det.zeroRated).toBe(true);
    expect(det.taxExemptReason).toBe('CONTINUOUS_INBOUND');
  });

  it('zero-rates interlined international movements', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'QC',
      destinationCountry: 'US',
      destinationRegion: 'ME',
      interliningPartner: 'ATLAS-INTL',
    });
    expect(det.zeroRated).toBe(true);
    expect(det.taxExemptReason).toBe('INTERLINING');
  });

  it('treats a cross-border country mismatch as international even without a flag', () => {
    const det = determineTax({
      originCountry: 'CA',
      originRegion: 'QC',
      destinationCountry: 'US',
      destinationRegion: 'VT',
      isInternational: false,
    });
    expect(det.zeroRated).toBe(true);
    expect(det.taxExemptReason).toBe('INTERNATIONAL_OUTBOUND');
  });
});
