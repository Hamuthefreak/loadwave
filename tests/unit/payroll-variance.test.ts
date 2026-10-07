import {
  buildStatement,
  payProfileOf,
  type PayLoadInput,
  type Statement,
  type StatementLine,
} from '../../src/modules/settlements/settlement.policy';
import {
  LANE_BAND_PER_MILE_CENTS,
  MAX_LISTED_SHIFTS,
  MIN_LANE_SAMPLES,
  decompose,
  driverVariance,
  laneNorms,
  shiftFlags,
  trailingBasis,
  varianceHeadline,
} from '../../src/modules/settlements/variance.policy';

const PER_MILE = payProfileOf('PER_MILE', 0.58);
const FLAT = payProfileOf('FLAT_PER_LOAD', 250);
const WEEK_FROM = new Date('2026-09-07T04:00:00.000Z');

let seq = 0;

function load(over: Partial<PayLoadInput> = {}): PayLoadInput {
  seq += 1;
  const deliveredAt = new Date(WEEK_FROM.getTime() + 3_600_000);
  return {
    id: `load-${seq}`,
    reference: `L-${1000 + seq}`,
    originRegion: 'QC',
    destinationRegion: 'ON',
    deliveredAt,
    distanceMiles: 500,
    revenueBase: 3000,
    detentionHours: 0,
    detentionRate: null,
    ...over,
  };
}

/** A week of work shifted far enough back that it precedes the current week. */
function week(offsetWeeks: number, loads: PayLoadInput[], profile = PER_MILE): Statement {
  const from = new Date(WEEK_FROM.getTime() - offsetWeeks * 7 * 86_400_000);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  return buildStatement({
    driverId: 'd1',
    driverName: 'Maria Chen',
    profile,
    loads: loads.map((l) => ({
      ...l,
      deliveredAt: new Date(from.getTime() + 3_600_000),
    })),
    from,
    to,
    label: `week -${offsetWeeks}`,
  });
}

describe('decompose', () => {
  it('sums exactly to the change against the trailing average', () => {
    // The invariant an owner checks with a calculator. Any residual term or a
    // rounding slip breaks this, which is why it is asserted over several shapes
    // rather than one.
    const history = [
      week(1, [load(), load()]),
      week(2, [load(), load(), load(), load()]),
      week(3, [load({ detentionHours: 3, detentionRate: 75 })]),
      week(4, []),
    ];
    const shapes: PayLoadInput[][] = [
      [],
      [load()],
      [load(), load(), load()],
      [load({ distanceMiles: 900 }), load({ detentionHours: 4, detentionRate: 75 })],
      [load({ distanceMiles: null }), load()],
    ];

    for (const shape of shapes) {
      const current = week(0, shape);
      const basis = trailingBasis(history, 4);
      const parts = decompose(current, basis);
      expect(parts.volumeCents + parts.rateCents + parts.detentionCents).toBe(parts.totalCents);
      expect(parts.totalCents).toBe(
        current.totals.totalPayCents - basis.averageTotalPayCents,
      );
    }
  });

  it('separates a volume change from a rate change', () => {
    // Same rate, more loads: the whole movement should be volume, because the
    // loads themselves paid exactly what the driver's normal load pays.
    const history = [week(1, [load(), load()]), week(2, [load(), load()])];
    const basis = trailingBasis(history, 2);
    const current = week(0, [load(), load(), load(), load()]);
    const parts = decompose(current, basis);

    expect(basis.averageTotalPayCents).toBe(58_000);
    expect(parts.totalCents).toBe(116_000 - 58_000);
    expect(parts.volumeCents).toBe(parts.totalCents);
    expect(parts.rateCents).toBe(0);
    expect(parts.detentionCents).toBe(0);
  });

  it('attributes a rate change to rate, not volume', () => {
    const history = [week(1, [load(), load()]), week(2, [load(), load()])];
    const basis = trailingBasis(history, 2);
    // Same two loads, but the flat-per-load driver was paid more per load.
    const current = week(0, [load(), load()], FLAT);
    const parts = decompose(current, basis);

    expect(parts.volumeCents).toBe(0);
    expect(parts.rateCents).toBe(parts.totalCents);
    expect(parts.totalCents).toBe(50_000 - 58_000);
  });

  it('does not invent a volume effect with no history', () => {
    const current = week(0, [load(), load()]);
    const parts = decompose(current, trailingBasis([], 4));
    expect(parts.volumeCents).toBe(0);
    expect(parts.rateCents).toBe(current.totals.payCents);
    expect(parts.detentionCents).toBe(current.totals.detentionCents);
    expect(parts.totalCents).toBe(current.totals.totalPayCents);
  });
});

describe('trailingBasis', () => {
  it('averages over the weeks the driver actually worked', () => {
    // A week off must not be treated as a week of zero pay: that would make the
    // next normal week look like a windfall and mislead whoever reads it.
    const history = [week(1, [load()]), week(2, []), week(3, [load()]), week(4, [])];
    const basis = trailingBasis(history, 4);
    expect(basis.activeWeeks).toBe(2);
    expect(basis.averagePayPerLoadCents).toBe(29_000);
    // The average total still spans every week asked for, so the delta is honest.
    expect(basis.averageTotalPayCents).toBe(14_500);
  });

  it('reports a detention hour rate only when detention was actually paid', () => {
    const paid = [week(1, [load({ detentionHours: 2, detentionRate: 50 })])];
    expect(trailingBasis(paid, 1).detentionPerHourCents).toBe(5_000);

    const unpaid = [week(1, [load({ detentionHours: 2 })])];
    expect(trailingBasis(unpaid, 1).detentionPerHourCents).toBeNull();
  });

  it('has no pay-per-load basis without any worked week', () => {
    const basis = trailingBasis([week(1, []), week(2, [])], 2);
    expect(basis.activeWeeks).toBe(0);
    expect(basis.averagePayPerLoadCents).toBeNull();
    expect(basis.averagePayPerMileCents).toBeNull();
  });
});

describe('laneNorms', () => {
  it('ignores a lane run only once', () => {
    // One prior load is an anecdote, not a norm.
    const lines: StatementLine[] = week(1, [load()]).lines;
    expect(MIN_LANE_SAMPLES).toBe(2);
    expect(laneNorms(lines).size).toBe(0);
    expect(laneNorms(week(1, [load(), load()]).lines).get('QC → ON')?.perMileCents).toBe(58);
  });

  it('ignores a lane whose loads could not be priced', () => {
    const lines = week(1, [load({ distanceMiles: null }), load({ distanceMiles: null })]).lines;
    expect(laneNorms(lines).size).toBe(0);
  });
});

describe('shiftFlags', () => {
  it('flags a load worked for nothing when the distance never arrived', () => {
    const current = week(0, [load({ distanceMiles: null, id: 'lost' })]);
    const shifts = shiftFlags(current.lines, [], trailingBasis([], 4));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.reason).toBe('NO_DISTANCE');
    expect(shifts[0]?.direction).toBe('DOWN');
    // Nothing to estimate from, so the impact is zero rather than made up.
    expect(shifts[0]?.impactCents).toBe(0);
    expect(shifts[0]?.estimated).toBe(false);
  });

  it('values an unpriceable load from the driver own history, and says so', () => {
    const past = [week(1, [load(), load()]), week(2, [load(), load()])];
    const basis = trailingBasis(past, 2);
    const current = week(0, [load({ distanceMiles: null, id: 'lost' })]);
    const shifts = shiftFlags(current.lines, past.flatMap((s) => s.lines), basis);
    expect(shifts[0]?.impactCents).toBe(basis.averagePayPerLoadCents);
    expect(shifts[0]?.estimated).toBe(true);
    expect(shifts[0]?.detail).toMatch(/average/);
  });

  it('flags waiting hours that were logged with no rate on the load', () => {
    const past = [week(1, [load({ detentionHours: 2, detentionRate: 60 }), load({ detentionHours: 2, detentionRate: 60 })])];
    const basis = trailingBasis(past, 1);
    const current = week(0, [load({ id: 'waited', detentionHours: 3 })]);
    const shifts = shiftFlags(current.lines, past.flatMap((s) => s.lines), basis);
    const shift = shifts.find((s) => s.reason === 'DETENTION_UNPAID');
    expect(shift).toBeDefined();
    expect(shift?.impactCents).toBe(3 * 6_000);
    expect(shift?.estimated).toBe(true);
  });

  it('measures a lane only against a real trailing rate, and only beyond the band', () => {
    const past = [week(1, [load({ distanceMiles: 500 }), load({ distanceMiles: 500 })])];
    const historyLines = past.flatMap((s) => s.lines);
    const basis = trailingBasis(past, 1);

    // The same lane at the same rate: nothing to say.
    const same = week(0, [load({ distanceMiles: 500 })]);
    expect(shiftFlags(same.lines, historyLines, basis)).toHaveLength(0);

    // A cheaper rate on that lane: flagged, with the impact in cents.
    const thin = week(0, [load({ distanceMiles: 500 }), load({ distanceMiles: 500, id: 'thin' })], payProfileOf('FLAT_PER_LOAD', 200));
    const flagged = shiftFlags(thin.lines, historyLines, basis);
    const lane = flagged.filter((s) => s.reason === 'LANE_BELOW');
    expect(lane.length).toBeGreaterThan(0);
    for (const s of lane) {
      const perMile = s.payPerMileCents as number;
      expect(Math.abs(perMile - (s.laneAveragePerMileCents as number))).toBeGreaterThanOrEqual(
        LANE_BAND_PER_MILE_CENTS,
      );
      expect(s.impactCents).toBe(
        Math.abs(Math.round((perMile - (s.laneAveragePerMileCents as number)) * 500)),
      );
      expect(s.estimated).toBe(false);
    }
  });

  it('flags a lane on the way up as well as the way down', () => {
    const past = [week(1, [load({ distanceMiles: 500 }), load({ distanceMiles: 500 })])];
    const basis = trailingBasis(past, 1);
    const rich = week(0, [load({ distanceMiles: 500 })], payProfileOf('FLAT_PER_LOAD', 500));
    const shifts = shiftFlags(rich.lines, past.flatMap((s) => s.lines), basis);
    expect(shifts[0]?.reason).toBe('LANE_ABOVE');
    expect(shifts[0]?.direction).toBe('UP');
  });

  it('ranks by how much the load moved the week and reports what it left out', () => {
    const past = [week(1, [load(), load()]), week(2, [load(), load()])];
    const basis = trailingBasis(past, 2);
    const many = week(0, [
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
      load({ distanceMiles: null }),
    ]);
    const shifts = shiftFlags(many.lines, past.flatMap((s) => s.lines), basis);
    expect(shifts.length).toBe(9);
    const impacts = shifts.map((s) => s.impactCents);
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts);

    const row = driverVariance({ current: many, history: past, weeks: 2 });
    expect(row.shifts).toHaveLength(MAX_LISTED_SHIFTS);
    expect(row.shiftsOmitted).toBe(9 - MAX_LISTED_SHIFTS);
  });
});

describe('driverVariance', () => {
  const past = [
    week(1, [load(), load()]),
    week(2, [load(), load()]),
    week(3, [load(), load()]),
    week(4, [load(), load()]),
  ];

  it('reports a percentage against the trailing average', () => {
    const current = week(0, [load(), load(), load()]);
    const row = driverVariance({ current, history: past, weeks: 4 });
    expect(row.basis.averageTotalPayCents).toBe(58_000);
    expect(row.components.totalCents).toBe(87_000 - 58_000);
    expect(row.percentChange).toBe(50);
    expect(varianceHeadline(row)).toBe('$290.00 up (50.0%) on the trailing 4 weeks.');
  });

  it('will not express a percentage with nothing to divide by', () => {
    const row = driverVariance({ current: week(0, [load()]), history: [], weeks: 4 });
    expect(row.percentChange).toBeNull();
    expect(varianceHeadline(row)).toMatch(/First week with a comparison/);
  });

  it('will not express a percentage against a basis too small to mean one', () => {
    // One short week behind a normal one reads as "+1612%", which is true and
    // useless. The money change is still reported; the percentage is not claimed.
    const tiny = [week(1, [load({ distanceMiles: 70 })])];
    const current = week(0, [load(), load(), load()]);
    const row = driverVariance({ current, history: tiny, weeks: 1 });
    expect(row.basis.averageTotalPayCents).toBe(4_060);
    expect(row.components.totalCents).toBe(87_000 - 4_060);
    expect(row.percentChange).toBeNull();
    expect(varianceHeadline(row)).toBe('$829.40 up on the trailing week.');

    // The same change against a real basis does carry a percentage.
    const real = [week(1, [load(), load(), load()])];
    expect(driverVariance({ current, history: real, weeks: 1 }).percentChange).toBe(0);
  });

  it('calls a quiet week in line rather than a change', () => {
    const row = driverVariance({ current: week(0, [load(), load()]), history: past, weeks: 4 });
    expect(row.components.totalCents).toBe(0);
    expect(varianceHeadline(row)).toBe('In line with the trailing weeks.');
  });

  it('carries the arithmetic for the current week alongside the basis', () => {
    const row = driverVariance({ current: week(0, [load(), load()]), history: past, weeks: 4 });
    expect(row.current.loads).toBe(2);
    expect(row.current.payPerLoadCents).toBe(29_000);
    expect(row.current.payPerMileCents).toBe(58);
    expect(row.basis.weeks_detail).toHaveLength(4);
  });
});
