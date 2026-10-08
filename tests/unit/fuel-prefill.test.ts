import {
  LITRES_PER_GAL,
  fuelJurisdictionInsight,
  mapLastStopToPrefill,
  mostCommonStopPrefill,
  type FuelStopRow,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/fuelPrefill';

describe('mapLastStopToPrefill', () => {
  it('returns null for an empty history', () => {
    expect(mapLastStopToPrefill(null)).toBeNull();
    expect(mapLastStopToPrefill(undefined)).toBeNull();
  });

  it('restores jurisdiction, currency and unit for a litres stop', () => {
    const last: FuelStopRow = {
      volumeLitres: '200',
      originalVolume: '200',
      originalVolumeUnit: 'L',
      transactionCurrency: 'USD',
      jurisdictionCode: 'ON',
    };
    const pre = mapLastStopToPrefill(last);
    expect(pre).toEqual({
      jurisdiction: 'ON',
      currency: 'USD',
      unit: 'L',
      volume: '',
      amount: '',
    });
  });

  it('restores gallons on a normal open but leaves volume blank (each fill differs)', () => {
    const last: FuelStopRow = {
      volumeLitres: '75.7082', // 20 US gallons
      originalVolume: '20',
      originalVolumeUnit: 'GAL',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'QC',
    };
    const pre = mapLastStopToPrefill(last);
    expect(pre?.unit).toBe('GAL');
    expect(pre?.volume).toBe('');
  });

  it('coerces unknown currencies to CAD', () => {
    const last: FuelStopRow = {
      volumeLitres: '100',
      originalVolume: '100',
      originalVolumeUnit: 'L',
      transactionCurrency: 'EUR',
      jurisdictionCode: 'QC',
    };
    expect(mapLastStopToPrefill(last)?.currency).toBe('CAD');
  });

  it('copies volume and amount for the repeat-last-stop chip', () => {
    const last: FuelStopRow = {
      volumeLitres: '250.5',
      originalVolume: '250.5',
      originalVolumeUnit: 'L',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'QC',
      amountTransaction: '330.75',
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.volume).toBe('250.5');
    expect(pre?.amount).toBe('330.8'); // round1
  });

  it('repeat chip converts a gallons stop to gallons and keeps the total', () => {
    const gal = 40;
    const last: FuelStopRow = {
      volumeLitres: String(gal * LITRES_PER_GAL),
      originalVolume: String(gal),
      originalVolumeUnit: 'GAL',
      transactionCurrency: 'USD',
      jurisdictionCode: 'NY',
      amountTransaction: '180.25',
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.unit).toBe('GAL');
    expect(Number(pre?.volume)).toBeCloseTo(gal, 1);
    expect(pre?.amount).toBe('180.3');
  });

  it('omits amount when the record has no total (normal prefill path)', () => {
    const last: FuelStopRow = {
      volumeLitres: '300',
      originalVolume: '300',
      originalVolumeUnit: 'L',
      transactionCurrency: 'CAD',
      jurisdictionCode: 'ON',
      amountTransaction: null,
    };
    const pre = mapLastStopToPrefill(last, true);
    expect(pre?.amount).toBe('');
  });
});

describe('mostCommonStopPrefill', () => {
  const stop = (jurisdictionCode: string, unit: 'L' | 'GAL' = 'L', volumeLitres = '100'): FuelStopRow => ({
    volumeLitres,
    originalVolume: volumeLitres,
    originalVolumeUnit: unit,
    transactionCurrency: 'CAD',
    jurisdictionCode,
  });

  it('returns null for an empty history', () => {
    expect(mostCommonStopPrefill([])).toBeNull();
    expect(mostCommonStopPrefill(null)).toBeNull();
  });

  it('uses the only stop when there is just one', () => {
    const pre = mostCommonStopPrefill([stop('ON')]);
    expect(pre?.jurisdiction).toBe('ON');
    expect(pre?.unit).toBe('L');
  });

  it('picks the most frequent jurisdiction, not the newest', () => {
    const stops = [stop('ON'), stop('QC'), stop('QC')]; // newest first
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('QC');
  });

  it('breaks ties toward the newest stop', () => {
    const stops = [stop('ON'), stop('QC')]; // 1 vs 1, ON is newest
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('ON');
  });

  it('separates combos by jurisdiction + unit (gallons are their own group)', () => {
    const stops = [stop('QC', 'GAL'), stop('QC', 'GAL'), stop('QC', 'L')];
    const pre = mostCommonStopPrefill(stops);
    expect(pre?.jurisdiction).toBe('QC');
    expect(pre?.unit).toBe('GAL');
  });
});

/**
 * The fuel-jurisdiction nudge.
 *
 * This is the one place the product makes a claim about a driver's money, so the
 * tests are mostly about *not* saying things: no pattern out of three
 * coincidences, no price across two currencies, no saving too small to matter,
 * and no comparison drawn between a purchase and itself.
 */
describe('fuelJurisdictionInsight', () => {
  /** 200 L for $256.80 is $1.284/L — the number the assertions lean on. */
  const stop = (over: Partial<FuelStopRow> = {}): FuelStopRow => ({
    volumeLitres: '200',
    originalVolume: '200',
    originalVolumeUnit: 'L',
    transactionCurrency: 'CAD',
    jurisdictionCode: 'QC',
    amountTransaction: '256.80',
    occurredAt: '2026-10-01T12:00:00.000Z',
    ...over,
  });

  it('says nothing when there is no history at all', () => {
    expect(fuelJurisdictionInsight(null)).toBeNull();
    expect(fuelJurisdictionInsight(undefined)).toBeNull();
    expect(fuelJurisdictionInsight([])).toBeNull();
  });

  it('says nothing about two fills, which is a coincidence', () => {
    expect(fuelJurisdictionInsight([stop(), stop()])).toBeNull();
    expect(
      fuelJurisdictionInsight([stop(), stop(), stop()], { minFills: 4 }),
    ).toBeNull();
  });

  it('says nothing when the litres are too few to be worth the ink', () => {
    // Three 50 L fills is 150 L, under the 250 L floor.
    const small = [stop({ volumeLitres: '50' }), stop({ volumeLitres: '50' }), stop({ volumeLitres: '50' })];
    expect(fuelJurisdictionInsight(small)).toBeNull();
    expect(fuelJurisdictionInsight([...small, stop({ volumeLitres: '150' })])).not.toBeNull();
  });

  it('reports the streak with its litres, its date and its average price', () => {
    const insight = fuelJurisdictionInsight([
      stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
    ]);
    expect(insight).toMatchObject({ jurisdiction: 'QC', fills: 3, litres: 600, currency: 'CAD' });
    expect(insight?.perLitre).toBeCloseTo(1.284, 4);
    expect(insight?.since).toBe('2026-09-05T12:00:00.000Z');
    // Nothing else in the file to compare against, so no claim about savings.
    expect(insight?.cheaper).toBeNull();
  });

  it('says nothing once the newest fill is somewhere else', () => {
    // The whole point is a habit, and one fill out of province is not a habit —
    // it is the driver already doing the thing the nudge is about.
    expect(fuelJurisdictionInsight([stop({ jurisdictionCode: 'ON' }), stop(), stop(), stop()])).toBeNull();
    expect(fuelJurisdictionInsight([stop(), stop({ jurisdictionCode: 'ON' }), stop()])).toBeNull();
  });

  it('quantifies the saving against a cheaper jurisdiction bought from before', () => {
    // 300 L at $363.60 is $1.212/L against the streak's $1.284: 7.2¢ on 600 L.
    const insight = fuelJurisdictionInsight([
      stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
      stop({
        jurisdictionCode: 'ON',
        volumeLitres: '300',
        amountTransaction: '363.60',
        occurredAt: '2026-08-01T12:00:00.000Z',
      }),
    ]);
    expect(insight?.cheaper).toMatchObject({ jurisdiction: 'ON', currency: 'CAD' });
    expect(insight?.cheaper?.perLitre).toBeCloseTo(1.212, 4);
    expect(insight?.cheaper?.save).toBeCloseTo(43.2, 2);
  });

  it('will not average two currencies into one price', () => {
    // A CAD fill and a USD fill in one streak have no single dollars-per-litre,
    // and a made-up one would be read as the driver's own money.
    const insight = fuelJurisdictionInsight([
      stop(),
      stop({ transactionCurrency: 'USD' }),
      stop(),
    ]);
    expect(insight).not.toBeNull();
    expect(insight?.perLitre).toBeNull();
    expect(insight?.currency).toBeNull();
    expect(insight?.cheaper).toBeNull();
  });

  it('ignores a difference too small to act on', () => {
    const insight = fuelJurisdictionInsight([
      stop(),
      stop(),
      stop(),
      // $384.00 for 300 L is $1.280/L — four tenths of a cent cheaper.
      stop({ jurisdictionCode: 'ON', volumeLitres: '300', amountTransaction: '384.00', occurredAt: '2026-08-01T12:00:00.000Z' }),
    ]);
    expect(insight?.cheaper).toBeNull();
  });

  it('ignores rows that carry no volume or no jurisdiction', () => {
    expect(
      fuelJurisdictionInsight([stop(), stop(), stop(), stop({ volumeLitres: '0' }), stop({ jurisdictionCode: '' })]),
    ).toMatchObject({ fills: 3, litres: 600 });
  });

  it('reads the streak from the newest fill even if handed the rows oldest first', () => {
    const oldestFirst = [
      stop({ jurisdictionCode: 'ON', occurredAt: '2026-08-01T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
      stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
    ];
    const insight = fuelJurisdictionInsight(oldestFirst);
    expect(insight).toMatchObject({ jurisdiction: 'QC', fills: 3 });
    expect(insight?.since).toBe('2026-09-05T12:00:00.000Z');
  });

  it('stops the streak at the window and compares against what is older', () => {
    // Beyond the window the rows are history, not habit — which is exactly the
    // second data point the saving needs.
    const rows = [
      stop({ occurredAt: '2026-10-05T12:00:00.000Z' }),
      stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
      stop({ occurredAt: '2026-09-01T12:00:00.000Z' }),
      stop({
        jurisdictionCode: 'ON',
        volumeLitres: '300',
        amountTransaction: '363.60',
        occurredAt: '2026-08-01T12:00:00.000Z',
      }),
    ];
    const insight = fuelJurisdictionInsight(rows, { window: 3 });
    expect(insight).toMatchObject({ fills: 3, litres: 600 });
    expect(insight?.cheaper?.jurisdiction).toBe('ON');
  });

  // ---- the tax half -------------------------------------------------------
  // The published IFTA table (CAD $/L) — a different number from the pump price,
  // and the only one the quarter is actually settled at.

  const RATES = {
    currency: 'CAD',
    volumeUnit: 'L',
    rates: { QC: '0.197', ON: '0.143', NY: '0.185', PA: '0.647' },
  };

  /** Three QC fills (600 L) plus an Ontario fill the same driver made. */
  const withOntario = [
    stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
    stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
    stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
    stop({ jurisdictionCode: 'ON', occurredAt: '2026-08-01T12:00:00.000Z' }),
  ];

  it('carries no tax at all when no rate table is handed over', () => {
    expect(fuelJurisdictionInsight(withOntario)?.tax).toBeNull();
    expect(fuelJurisdictionInsight(withOntario, { rates: null })?.tax).toBeNull();
  });

  it('quotes the published difference against a jurisdiction the driver also used', () => {
    const tax = fuelJurisdictionInsight(withOntario, { rates: RATES })?.tax;
    expect(tax).toMatchObject({ jurisdiction: 'QC', currency: 'CAD' });
    expect(tax?.perLitre).toBeCloseTo(0.197, 6);
    expect(tax?.lower).toMatchObject({ jurisdiction: 'ON' });
    expect(tax?.lower?.perLitre).toBeCloseTo(0.143, 6);
    expect(tax?.lower?.difference).toBeCloseTo(0.054, 6);
    // 5.4 cents a litre across the streak's 600 L.
    expect(tax?.lower?.save).toBeCloseTo(32.4, 2);
  });

  it('will not compare against a jurisdiction the driver never bought fuel in', () => {
    // The tank is all Quebec, so the driver's own history holds no second
    // jurisdiction to compare a rate with — cheaper codes in the table are
    // somebody else's route.
    const tax = fuelJurisdictionInsight([stop(), stop(), stop()], { rates: RATES })?.tax;
    expect(tax?.perLitre).toBeCloseTo(0.197, 6);
    expect(tax?.lower).toBeNull();
  });

  it('picks the lowest rate the driver actually fuelled under, not the first', () => {
    const tax = fuelJurisdictionInsight(
      [
        ...withOntario,
        stop({ jurisdictionCode: 'NY', occurredAt: '2026-07-01T12:00:00.000Z' }),
      ],
      { rates: RATES },
    )?.tax;
    // ON (0.143) beats NY (0.185) even though NY sits nearer the newest fill.
    expect(tax?.lower?.jurisdiction).toBe('ON');
  });

  it('ignores a rate difference too small to act on', () => {
    const tax = fuelJurisdictionInsight(withOntario, {
      rates: { ...RATES, rates: { ...RATES.rates, ON: '0.194' } },
    })?.tax;
    // Three tenths of a cent a litre is rounding, not a rate.
    expect(tax?.lower).toBeNull();
  });

  it('says nothing about tax when the streak jurisdiction is missing from the table', () => {
    const tax = fuelJurisdictionInsight(withOntario, {
      rates: { ...RATES, rates: { ON: '0.143' } },
    })?.tax;
    expect(tax).toBeNull();
  });

  it('quotes the tax even when the pump price has nothing to say', () => {
    // Ontario at $1.333/L is dearer than the streak, so there is no price
    // comparison to draw — but its published rate is still lower, and that half
    // of the story does not depend on the receipt.
    const insight = fuelJurisdictionInsight(
      [
        stop({ occurredAt: '2026-10-01T12:00:00.000Z' }),
        stop({ occurredAt: '2026-09-20T12:00:00.000Z' }),
        stop({ occurredAt: '2026-09-05T12:00:00.000Z' }),
        stop({
          jurisdictionCode: 'ON',
          volumeLitres: '300',
          amountTransaction: '399.90',
          occurredAt: '2026-08-01T12:00:00.000Z',
        }),
      ],
      { rates: RATES },
    );
    expect(insight?.cheaper).toBeNull();
    expect(insight?.tax?.lower).toMatchObject({ jurisdiction: 'ON' });
    expect(insight?.tax?.lower?.difference).toBeCloseTo(0.054, 6);
    expect(insight?.tax?.lower?.save).toBeCloseTo(32.4, 2);
  });

  it('never compares a jurisdiction with itself', () => {
    const tax = fuelJurisdictionInsight(
      [stop(), stop(), stop(), stop({ occurredAt: '2026-08-01T12:00:00.000Z' })],
      { rates: RATES },
    )?.tax;
    expect(tax?.lower).toBeNull();
  });
});