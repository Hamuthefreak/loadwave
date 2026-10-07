import {
  aamvaElements,
  describeAamva,
  kindHasBarcode,
  parseAamva,
  parseAamvaDate,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/aamva';

/**
 * A real payload, of the exact shape the AAMVA standard documents: a Virginia
 * CDL with two subfiles. It is here rather than invented because the point of
 * the parser is to cope with what a jurisdiction actually printed.
 */
const VIRGINIA_CDL = [
  '@',
  '\u001e\rANSI 636000100102DL00410278ZV03190008DLDAQT64235789',
  'DCSSAMPLE',
  'DDEN',
  'DACMICHAEL',
  'DDFN',
  'DADJOHN',
  'DDGN',
  'DCUJR',
  'DCAD',
  'DCBK',
  'DCDPH',
  'DBD06062019',
  'DBB06061986',
  'DBA12102024',
  'DBC1',
  'DAU068 in',
  'DAYBRO',
  'DAG2300 WEST BROAD STREET',
  'DAIRICHMOND',
  'DAJVA',
  'DAK232690000 ',
  'DCGUSA',
  'DDD1',
  '\rZVZVA01\r',
].join('\n');

/** The same card from a state that encodes dates year-first. */
const YEAR_FIRST = [
  '\rANSI 636015080002DL00340291DLDAQB1234567',
  'DCSMARTIN',
  'DACJOSEPHINE',
  'DBB19860412',
  'DBA20271130',
  'DAJON',
].join('\n');

describe('parseAamvaDate', () => {
  it('reads a month-first date', () => {
    expect(parseAamvaDate('12102024')).toBe('2024-12-10');
    expect(parseAamvaDate('06061986')).toBe('1986-06-06');
  });

  it('reads a year-first date', () => {
    expect(parseAamvaDate('20271130')).toBe('2027-11-30');
    expect(parseAamvaDate('19860412')).toBe('1986-04-12');
  });

  it('reads the date the card printed, in either order', () => {
    // The disambiguation is safe rather than lucky: a year-first reading is only
    // valid when the first four digits are a real year, which makes the
    // month-first reading see a month of 19, 20 or 21 and fail. The two orders
    // can therefore only ever agree on the same date, never disagree.
    const cases: Array<[string, string]> = [
      ['01012024', '2024-01-01'],
      ['12311999', '1999-12-31'],
      ['06061986', '1986-06-06'],
      ['20240101', '2024-01-01'],
      ['19991231', '1999-12-31'],
      ['19860606', '1986-06-06'],
      ['20240229', '2024-02-29'],
    ];
    for (const [printed, expected] of cases) {
      expect(parseAamvaDate(printed)).toBe(expected);
    }
  });

  it('refuses anything that is not a date', () => {
    expect(parseAamvaDate('13132024')).toBeNull();
    expect(parseAamvaDate('02302023')).toBeNull();
    expect(parseAamvaDate('121024')).toBeNull();
    expect(parseAamvaDate('')).toBeNull();
    expect(parseAamvaDate(null)).toBeNull();
    expect(parseAamvaDate('DBA12102024')).toBeNull();
  });

  it('knows February in a leap year', () => {
    expect(parseAamvaDate('02292024')).toBe('2024-02-29');
    expect(parseAamvaDate('02292023')).toBeNull();
  });
});

describe('aamvaElements', () => {
  it('reads the elements out of a real payload', () => {
    const el = aamvaElements(VIRGINIA_CDL);
    expect(el.get('DAQ')).toBe('T64235789');
    expect(el.get('DCS')).toBe('SAMPLE');
    expect(el.get('DAC')).toBe('MICHAEL');
    expect(el.get('DBA')).toBe('12102024');
    expect(el.get('DAJ')).toBe('VA');
    expect(el.get('DAG')).toBe('2300 WEST BROAD STREET');
    expect(el.get('ZVA')).toBe('01');
  });

  it('does not mistake the subfile designators for elements', () => {
    const el = aamvaElements(VIRGINIA_CDL);
    // DL00410278 / ZV03190008 are offsets and lengths, not values.
    expect(el.get('DLD')).toBeUndefined();
    expect([...el.keys()].some((k) => /^\d/.test(k))).toBe(false);
  });

  it('copes with a payload that has no header at all', () => {
    const el = aamvaElements('DLDAQT64235789\nDCSSAMPLE\nDBA12102024');
    expect(el.get('DAQ')).toBe('T64235789');
    expect(el.get('DBA')).toBe('12102024');
  });

  it('copes with the subfile type repeated before the first element', () => {
    // Some encoders emit `DL` + `DAQ...`; others emit `DAQ...` on its own.
    expect(aamvaElements('ANSI 636000100102DLDAQT1\nDBB06061986').get('DAQ')).toBe('T1');
    expect(aamvaElements('ANSI 636000100102DAQT1\nDBB06061986').get('DAQ')).toBe('T1');
  });

  it('returns nothing for an empty payload', () => {
    expect(aamvaElements('').size).toBe(0);
  });
});

describe('parseAamva', () => {
  it('pulls the fields a renewal needs off a real licence', () => {
    const result = parseAamva(VIRGINIA_CDL);
    expect(result.ok).toBe(true);
    expect(result.missingExpiry).toBe(false);
    expect(result.fields).toEqual({
      expiresAt: '2024-12-10',
      birthDate: '1986-06-06',
      licenceNumber: 'T64235789',
      name: { family: 'SAMPLE', first: 'MICHAEL', middle: 'JOHN' },
      jurisdiction: 'VA',
      country: 'USA',
    });
  });

  it('reads a jurisdiction that writes dates the other way round', () => {
    const result = parseAamva(YEAR_FIRST);
    expect(result.ok).toBe(true);
    expect(result.fields.expiresAt).toBe('2027-11-30');
    expect(result.fields.birthDate).toBe('1986-04-12');
    expect(result.fields.jurisdiction).toBe('ON');
    expect(result.fields.licenceNumber).toBe('B1234567');
  });

  it('rejects a QR code payload that happens to be scanned', () => {
    const result = parseAamva('https://example.com/renew?ref=12345');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not look like a licence barcode/);
    expect(result.fields.expiresAt).toBeNull();
  });

  it('rejects an empty read', () => {
    const result = parseAamva('   ');
    expect(result.ok).toBe(false);
  });

  it('says so when a barcode has no readable expiry', () => {
    // The one field the renewal actually needs, so its absence is flagged
    // rather than silently leaving a blank date in the form.
    const result = parseAamva('ANSI 636000100102DLDAQT1\nDCSONLYNAME');
    expect(result.ok).toBe(true);
    expect(result.missingExpiry).toBe(true);
    expect(result.fields.licenceNumber).toBe('T1');
    expect(result.fields.name.family).toBe('ONLYNAME');
  });

  it('describes what it read, so the driver can check it', () => {
    expect(describeAamva(parseAamva(VIRGINIA_CDL))).toBe(
      'MICHAEL SAMPLE · licence T64235789 · VA · expires 2024-12-10',
    );
    expect(describeAamva(parseAamva('nonsense'))).toMatch(/does not look like/);
  });
});

describe('kindHasBarcode', () => {
  it('is only true for the licence', () => {
    // A medical examiner's certificate has no barcode; offering to scan one
    // would be a dead end for the one document drivers renew most often.
    expect(kindHasBarcode('CDL')).toBe(true);
    expect(kindHasBarcode('cdl')).toBe(true);
    expect(kindHasBarcode('MEDICAL_CARD')).toBe(false);
    expect(kindHasBarcode('MVR')).toBe(false);
  });
});
