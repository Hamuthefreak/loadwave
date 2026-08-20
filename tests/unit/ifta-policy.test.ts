import { d } from '../../src/utils/decimal';
import {
  computeQuarterSummaries,
  fleetAverageConsumption,
  netLitresFor,
  netTaxDue,
  type JurisdictionTotals,
} from '../../src/modules/ifta/ifta.policy';

function totals(): JurisdictionTotals[] {
  return [
    { jurisdictionCode: 'QC', totalKm: d(2000), taxableKm: d(2000), litresPurchased: d(600) },
    { jurisdictionCode: 'ON', totalKm: d(1000), taxableKm: d(1000), litresPurchased: d(200) },
    { jurisdictionCode: 'NY', totalKm: d(1000), taxableKm: d(1000), litresPurchased: d(100) },
  ];
}

describe('IFTA engine math', () => {
  it('computes fleet-wide average consumption = total litres / total km', () => {
    const avg = fleetAverageConsumption(totals());
    // (600 + 200 + 100) / (2000 + 1000 + 1000) = 900 / 4000 = 0.225
    expect(avg.toString()).toBe('0.225');
  });

  it('computes net litres and net tax per jurisdiction', () => {
    const consumed = netLitresFor(d(2000), d(600), d('0.225'));
    // 2000 * 0.225 - 600 = 450 - 600 = -150
    expect(consumed.toString()).toBe('-150');
    const tax = netTaxDue(consumed, d('0.197'));
    expect(tax.toString()).toBe('-29.55');
  });

  it('produces quarterly summaries keyed by jurisdiction and fuel type', () => {
    const rates = { QC: '0.197', ON: '0.143', NY: '0.185' };
    const rows = computeQuarterSummaries(totals(), rates, {
      tenantId: 'tenant-1',
      quarter: '2026-Q1',
      assetId: 'asset-1',
      fuelType: 'DSL',
    });

    expect(rows).toHaveLength(3);
    const qc = rows.find((r) => r.jurisdictionCode === 'QC');
    expect(qc?.tenantId).toBe('tenant-1');
    expect(qc?.quarter).toBe('2026-Q1');
    expect(qc?.assetId).toBe('asset-1');
    expect(qc?.averageConsumption.toString()).toBe('0.225');
    expect(qc?.litresConsumed.toString()).toBe('450');
    expect(qc?.netLitres.toString()).toBe('-150');
    expect(qc?.netTaxDueBase.toString()).toBe('-29.55');
  });

  it('keeps litresConsumed proportional to km in each jurisdiction', () => {
    const rows = computeQuarterSummaries(
      totals(),
      { QC: '0.1', ON: '0.1', NY: '0.1' },
      {
        tenantId: 'tenant-1',
        quarter: '2026-Q1',
        assetId: null,
      },
    );
    const qc = rows.find((r) => r.jurisdictionCode === 'QC')!;
    const on = rows.find((r) => r.jurisdictionCode === 'ON')!;
    expect(qc.litresConsumed.dividedBy(on.litresConsumed).toString()).toBe('2');
  });

  it('returns empty summaries when there is no distance data', () => {
    const rows = computeQuarterSummaries(
      [],
      {},
      {
        tenantId: 't',
        quarter: '2026-Q1',
        assetId: null,
      },
    );
    expect(rows).toHaveLength(0);
  });
});
