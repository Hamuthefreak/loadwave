import {
  buildStatement,
  DEFAULT_TIMEZONE,
  isValidTimezone,
  kmToMiles,
  safeTimezone,
  payProfileOf,
  payRateLabel,
  periodFromInputs,
  rollupStatements,
  settlementPeriod,
  statementLine,
  yearToDatePeriod,
  zonedTime,
  type PayLoadInput,
} from '../../src/modules/settlements/settlement.policy';

const TZ = 'America/Toronto';

function load(overrides: Partial<PayLoadInput> = {}): PayLoadInput {
  return {
    id: 'load-1',
    reference: 'LW-1001',
    originRegion: 'QC',
    destinationRegion: 'ON',
    deliveredAt: '2026-09-08T18:00:00.000Z',
    distanceMiles: 200,
    revenueBase: 1000,
    detentionHours: 0,
    detentionRate: null,
    ...overrides,
  };
}

describe('pay profiles', () => {
  it('converts km to miles without drifting', () => {
    expect(kmToMiles(160.9344)).toBeCloseTo(100, 6);
    expect(kmToMiles(0)).toBe(0);
  });

  it('rejects half a profile or a negative rate', () => {
    expect(payProfileOf('PER_MILE', null)).toBeNull();
    expect(payProfileOf(null, 0.6)).toBeNull();
    expect(payProfileOf('HOURLY', 20)).toBeNull();
    expect(payProfileOf('PER_MILE', -0.6)).toBeNull();
    expect(payProfileOf('PER_MILE', '')).toBeNull();
    expect(payProfileOf('PER_MILE', {})).toBeNull();
    expect(payProfileOf('PER_MILE', '0.60')).toEqual({ payModel: 'PER_MILE', payRate: 0.6 });
    expect(payProfileOf('FLAT_PER_LOAD', 0)).toEqual({ payModel: 'FLAT_PER_LOAD', payRate: 0 });
  });

  // Prisma returns a Decimal for every numeric column, and a Decimal is not a
  // JS number. Reading it as one silently hid every stored rate.
  it('reads a Prisma Decimal rate as a rate', () => {
    const decimal = { toNumber: () => 0.58, toString: () => '0.58' };
    expect(payProfileOf('PER_MILE', decimal)).toEqual({ payModel: 'PER_MILE', payRate: 0.58 });
    expect(payProfileOf('PER_MILE', { toString: () => '27' })).toEqual({ payModel: 'PER_MILE', payRate: 27 });
    expect(payProfileOf('PER_MILE', { toString: () => 'not a number' })).toBeNull();
  });

  it('describes each model the way a driver would say it', () => {
    expect(payRateLabel({ payModel: 'PER_MILE', payRate: 0.58 })).toBe('$0.58 / mi');
    expect(payRateLabel({ payModel: 'PERCENT_REVENUE', payRate: 27 })).toBe('27% of revenue');
    expect(payRateLabel({ payModel: 'FLAT_PER_LOAD', payRate: 350 })).toBe('$350.00 per load');
    expect(payRateLabel(null)).toMatch(/owner-operator/i);
  });
});

describe('per-load pricing', () => {
  it('pays per mile to the cent', () => {
    const line = statementLine({ payModel: 'PER_MILE', payRate: 0.58 }, load({ distanceMiles: 412.3 }));
    expect(line.baseCents).toBe(23913); // 412.3 × 0.58 = 239.134 → 239.13
    expect(line.basis).toBe('412.3 mi × $0.58/mi');
    expect(line.priced).toBe(true);
  });

  it('pays a percentage of revenue and shows the working', () => {
    const line = statementLine({ payModel: 'PERCENT_REVENUE', payRate: 27 }, load({ revenueBase: 2450 }));
    expect(line.baseCents).toBe(66150);
    expect(line.basis).toBe('$2450.00 × 27%');
  });

  it('pays a flat rate regardless of distance', () => {
    const line = statementLine({ payModel: 'FLAT_PER_LOAD', payRate: 350 }, load({ distanceMiles: null }));
    expect(line.baseCents).toBe(35000);
    expect(line.priced).toBe(true);
  });

  it('refuses to invent a price when the inputs are missing', () => {
    const noDistance = statementLine({ payModel: 'PER_MILE', payRate: 0.58 }, load({ distanceMiles: null }));
    expect(noDistance.baseCents).toBe(0);
    expect(noDistance.priced).toBe(false);
    expect(noDistance.basis).toBe('Distance unknown');

    const noRevenue = statementLine({ payModel: 'PERCENT_REVENUE', payRate: 27 }, load({ revenueBase: null }));
    expect(noRevenue.priced).toBe(false);
    expect(noRevenue.basis).toBe('Revenue unknown');

    const noProfile = statementLine(null, load());
    expect(noProfile.priced).toBe(false);
    expect(noProfile.basis).toBe('No pay profile');
  });

  it('adds detention at the tenant rate, and flags hours with no rate', () => {
    const paid = statementLine(
      { payModel: 'PER_MILE', payRate: 0.5 },
      load({ distanceMiles: 100, detentionHours: 2.5, detentionRate: 60 }),
    );
    expect(paid.detentionCents).toBe(15000);
    expect(paid.detentionBasis).toBe('2.5 h detention × $60.00/h');
    expect(paid.totalCents).toBe(20000);

    const unpaid = statementLine({ payModel: 'FLAT_PER_LOAD', payRate: 300 }, load({ detentionHours: 1.5 }));
    expect(unpaid.detentionHours).toBe(1.5);
    expect(unpaid.detentionCents).toBe(0);
    expect(unpaid.detentionBasis).toBe('1.5 h detention — no rate set');
  });
});

describe('statements', () => {
  const from = zonedTime(2026, 9, 7, TZ);
  const to = zonedTime(2026, 9, 14, TZ);

  it('totals a week without float drift', () => {
    const loads = Array.from({ length: 40 }, (_, i) =>
      load({ id: `l${i}`, distanceMiles: 187.4, revenueBase: 1200, deliveredAt: new Date(from.getTime() + i * 3600_000).toISOString() }),
    );
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'PER_MILE', payRate: 0.58 },
      loads, from, to, label: 'week',
    });
    expect(statement.totals.loads).toBe(40);
    // 187.4 × 0.58 = 108.692 → 108.69 each, ×40 = 4347.60 exactly.
    expect(statement.totals.payCents).toBe(434760);
    expect(statement.lines[0].basis).toBe('187.4 mi × $0.58/mi');
  });

  it('includes the last minute of the period and excludes the next one', () => {
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'FLAT_PER_LOAD', payRate: 100 },
      loads: [
        load({ id: 'sunday-night', deliveredAt: new Date(to.getTime() - 60_000).toISOString() }),
        load({ id: 'monday-morning', deliveredAt: to.toISOString() }),
        load({ id: 'early', deliveredAt: new Date(from.getTime() - 1).toISOString() }),
      ],
      from, to, label: 'week',
    });
    expect(statement.lines.map((l) => l.loadId)).toEqual(['sunday-night']);
  });

  it('sorts lines by delivery so the statement reads chronologically', () => {
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'FLAT_PER_LOAD', payRate: 100 },
      loads: [
        load({ id: 'third', deliveredAt: '2026-09-11T12:00:00.000Z' }),
        load({ id: 'first', deliveredAt: '2026-09-08T12:00:00.000Z' }),
        load({ id: 'second', deliveredAt: '2026-09-10T12:00:00.000Z' }),
      ],
      from, to, label: 'week',
    });
    expect(statement.lines.map((l) => l.loadId)).toEqual(['first', 'second', 'third']);
  });

  it('explains its gaps instead of hiding them', () => {
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'PER_MILE', payRate: 0.5 },
      loads: [load({ id: 'a', distanceMiles: null, detentionHours: 3 }), load({ id: 'b', distanceMiles: 100 })],
      from, to, label: 'week',
    });
    expect(statement.totals.unpricedLoads).toBe(1);
    expect(statement.totals.marginCents).toBe(1000 * 100 + 1000 * 100 - 5000);
    expect(statement.notes.join(' ')).toMatch(/could not be priced/);
    expect(statement.notes.join(' ')).toMatch(/with no hourly rate set/);
  });

  it('records an owner-operator as revenue with no pay owed', () => {
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Owner Op', profile: null,
      loads: [load({ revenueBase: 2450, detentionHours: 3, detentionRate: 60 })], from, to, label: 'week',
    });
    expect(statement.totals.totalPayCents).toBe(0);
    expect(statement.totals.marginCents).toBe(245000);
    expect(statement.payLabel).toMatch(/owner-operator/i);
    expect(statement.notes.join(' ')).toMatch(/No pay profile/);
    // Detention must not be paid again on top of the revenue they already keep.
    expect(statement.totals.detentionCents).toBe(0);
    expect(statement.lines[0].detentionHours).toBe(3);
    expect(statement.lines[0].detentionBasis).toBe('3.0 h detention — owner-operator');
    // The generic unpriced note would just restate the owner-operator note.
    expect(statement.notes.join(' ')).not.toMatch(/could not be priced/);
  });

  it('reports effective pay per mile across the period', () => {
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'PER_MILE', payRate: 0.6 },
      loads: [load({ id: 'a', distanceMiles: 100 }), load({ id: 'b', distanceMiles: 300, deliveredAt: '2026-09-09T12:00:00.000Z' })],
      from, to, label: 'week',
    });
    expect(statement.totals.miles).toBe(400);
    expect(statement.totals.effectivePayPerMileCents).toBe(60);
  });

  it('rolls a fleet week into one payable total', () => {
    const one = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'PER_MILE', payRate: 0.5 },
      loads: [load({ id: 'a', distanceMiles: 400 })], from, to, label: 'week',
    });
    const two = buildStatement({
      driverId: 'd2', driverName: 'Owner Op', profile: null,
      loads: [load({ id: 'b' })], from, to, label: 'week',
    });
    const rollup = rollupStatements([one, two]);
    expect(rollup.drivers).toBe(2);
    expect(rollup.payableDrivers).toBe(1);
    expect(rollup.totalPayCents).toBe(20000);
    expect(rollup.miles).toBe(600);
    expect(rollup.revenueCents).toBe(200000);
  });
});

describe('settlement periods', () => {
  it('starts the week on Monday in the driver home terminal', () => {
    // Wednesday 2026-09-09 18:00 UTC = 14:00 in Toronto.
    const period = settlementPeriod(new Date('2026-09-09T18:00:00.000Z'), TZ);
    expect(period.from.toISOString()).toBe('2026-09-07T04:00:00.000Z'); // Mon 00:00 EDT
    expect(period.to.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(period.label).toContain('Sep 7');
  });

  it('treats Sunday evening as part of the week that is ending', () => {
    // Sunday 2026-09-13 23:30 Toronto = 2026-09-14 03:30 UTC.
    const period = settlementPeriod(new Date('2026-09-14T03:30:00.000Z'), TZ);
    expect(period.from.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-09-14T04:00:00.000Z');
  });

  it('walks back a week at a time', () => {
    const now = new Date('2026-09-09T18:00:00.000Z');
    const last = settlementPeriod(now, TZ, 1);
    expect(last.from.toISOString()).toBe('2026-08-31T04:00:00.000Z');
    expect(last.to.toISOString()).toBe('2026-09-07T04:00:00.000Z');
  });

  it('handles the spring-forward week without losing a delivery', () => {
    // DST starts 2026-03-08 in Toronto: the week is 167 hours long.
    const period = settlementPeriod(new Date('2026-03-04T17:00:00.000Z'), TZ);
    expect(period.to.getTime() - period.from.getTime()).toBe(167 * 3600_000);
    const statement = buildStatement({
      driverId: 'd1', driverName: 'Maria Chen', profile: { payModel: 'FLAT_PER_LOAD', payRate: 100 },
      loads: [load({ id: 'sunday', deliveredAt: '2026-03-08T12:00:00.000Z' })],
      from: period.from, to: period.to, label: period.label,
    });
    expect(statement.totals.loads).toBe(1);
  });

  it('reads an explicit inclusive range from the query string', () => {
    const period = periodFromInputs('2026-09-01', '2026-09-07', TZ);
    expect(period).not.toBeNull();
    expect(period!.from.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(period!.to.toISOString()).toBe('2026-09-08T04:00:00.000Z');
    expect(periodFromInputs('nonsense', '2026-09-07', TZ)).toBeNull();
    expect(periodFromInputs('2026-09-07', '2026-09-01', TZ)).toBeNull();
    expect(periodFromInputs('', '', TZ)).toBeNull();
    // Same day on both ends is a real one-day range, not an error.
    const day = periodFromInputs('2026-09-07', '2026-09-07', TZ);
    expect(day!.to.getTime() - day!.from.getTime()).toBe(24 * 3600_000);
  });

  it('bounds year-to-date by the same timezone', () => {
    const ytd = yearToDatePeriod(new Date('2026-09-09T18:00:00.000Z'), TZ);
    expect(ytd.from.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(ytd.to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  // A dispatcher types this field by hand, and Intl throws on an unknown zone —
  // which would take out payroll maths and the HOS day boundary with it.
  it('falls back to the fleet default instead of throwing on a bad timezone', () => {
    expect(isValidTimezone('America/Toronto')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(safeTimezone('Mars/Olympus')).toBe(DEFAULT_TIMEZONE);
    expect(safeTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(safeTimezone('')).toBe(DEFAULT_TIMEZONE);
    expect(safeTimezone('America/Vancouver')).toBe('America/Vancouver');

    const period = settlementPeriod(new Date('2026-09-09T18:00:00.000Z'), 'Mars/Olympus');
    expect(period.from.toISOString()).toBe('2026-09-07T04:00:00.000Z');
  });
});
