/**
 * What is on the back of a North American licence.
 *
 * Every CDL and ID card in the US and Canada carries a PDF417 barcode with the
 * holder's details in it, exactly as the jurisdiction printed them — the AAMVA
 * DL/ID Card Design Standard, Annex D. Reading it beats reading the front of the
 * card with OCR: there is nothing to misread (no smudged 3 versus 8), it works
 * in a dim cab, and it costs nothing per scan.
 *
 * This module is the parsing half — pure, no camera, no library — so the part
 * with the actual logic in it is unit-tested against a payload from the standard
 * rather than eyeballed on a live licence.
 *
 * What it deliberately does not do is *trust* the result. A barcode can be a
 * forgery, a scanner can return a truncated read, and a jurisdiction can encode
 * something in a way this parser has not seen. So the fields it produces only
 * ever prefill a form: the driver checks them, and the office confirms the
 * document. Nothing here reaches compliance on its own.
 *
 * Layout, as encoded:
 *
 *   @\n\x1e\rANSI 636000100102DL00410278ZV03190008DLDAQT64235789\nDCSSAMPLE\n...
 *   └─ compliance  └─ IIN  └─ version  └─ subfile designators └─ elements
 *      indicator      │      └ jurisdiction + entry count
 *                     └ six digits
 *
 * Elements are three-letter codes — DAQ licence number, DBA expiry, DCS family
 * name — separated by newlines. Some encoders repeat the two-letter subfile type
 * (`DL`) in front of the first element of a subfile, so the parser tolerates
 * that rather than assuming one shape.
 */

/** Elements this parser reads. Everything else is ignored on purpose. */
const FIELD = {
  licenceNumber: 'DAQ',
  expiry: 'DBA',
  familyName: 'DCS',
  firstName: 'DAC',
  middleName: 'DAD',
  birthDate: 'DBB',
  issueDate: 'DBD',
  jurisdiction: 'DAJ',
  country: 'DCG',
} as const;

export interface AamvaName {
  family: string | null;
  first: string | null;
  middle: string | null;
}

export interface AamvaFields {
  /** Licence expiry, ISO date, or null when it could not be read. */
  expiresAt: string | null;
  /** Date of birth, kept only to sanity-check that this is the right card. */
  birthDate: string | null;
  licenceNumber: string | null;
  name: AamvaName;
  /** Two-letter jurisdiction code, e.g. QC or VA. */
  jurisdiction: string | null;
  /** Whether the card was issued by a US or Canadian jurisdiction. */
  country: string | null;
}

export interface AamvaParseResult {
  ok: boolean;
  /** Why it failed, in words a driver could be shown. */
  reason: string | null;
  fields: AamvaFields;
  /** True when the read carried no expiry — the one field we actually need. */
  missingExpiry: boolean;
}

const EMPTY: AamvaFields = {
  expiresAt: null,
  birthDate: null,
  licenceNumber: null,
  name: { family: null, first: null, middle: null },
  jurisdiction: null,
  country: null,
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  return day >= 1 && day <= limit;
}

const iso = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * An eight-digit AAMVA date, which comes in one of two orders depending on the
 * jurisdiction and the standard version: MMDDCCYY or CCYYMMDD. There is no flag
 * for which one it is, so the digits are read as a date both ways and the
 * interpretation that is not a real calendar date is discarded.
 *
 * That is not a guess in practice: "12102024" cannot be a CCYYMMDD date (year
 * 1210) and "20241210" cannot be MMDDCCYY (month 20), so exactly one reading
 * survives for any real date. When both survive, the card is old enough to be
 * ambiguous and this says so rather than picking.
 */
export function parseAamvaDate(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').trim();
  if (!/^\d{8}$/.test(digits)) return null;

  const asMonthFirst = isValidYmd(
    Number(digits.slice(4, 8)),
    Number(digits.slice(0, 2)),
    Number(digits.slice(2, 4)),
  );
  const asYearFirst = isValidYmd(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)),
    Number(digits.slice(6, 8)),
  );

  if (asMonthFirst && !asYearFirst) {
    return iso(Number(digits.slice(4, 8)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
  }
  if (asYearFirst && !asMonthFirst) {
    return iso(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  }
  // Both or neither: an ambiguous read is worth more unsaid than wrong.
  return null;
}

/**
 * The element values in a payload, keyed by their three-letter code.
 *
 * Later entries win, which matches how the format works in practice: a
 * jurisdiction subfile at the end of the payload can repeat a field to override
 * the common one.
 */
export function aamvaElements(raw: string): Map<string, string> {
  const elements = new Map<string, string>();
  if (!raw) return elements;

  // Drop the compliance indicator and the whole file header: the six-digit
  // issuer number, the standard version, the jurisdiction version and the entry
  // count, which is twelve digits in total.
  let body = raw;
  const header = /(?:ANSI|AAMVA)[^A-Za-z]{0,4}\d{6}\d{0,6}/.exec(raw.slice(0, 48));
  if (header) body = raw.slice(header.index + header[0].length);

  // Subfile designators: the two-letter type followed by a four-digit offset and
  // a four-digit length, one per subfile, repeated before the element stream.
  // Any leftover header digits go first, so a short or unusual header does not
  // swallow the first element.
  body = body.replace(/^\d+/, '').replace(/^(?:(?:DL|ID|Z[A-Z])\d{8})+/, '');

  for (const token of body.split(/[\n\r\u001e]+/)) {
    const line = token.trim();
    if (!line) continue;
    // The optional prefix is the subfile type some encoders repeat in front of
    // the first element of a subfile; the regex backtracks off it when the token
    // really does start with an element code.
    const match = /^(?:DL|ID|Z[A-Z])?([A-Z]{3})([\s\S]*)$/.exec(line);
    if (!match) continue;
    const [, code, value] = match;
    if (code) elements.set(code, (value ?? '').trim());
  }
  return elements;
}

/** Parse a decoded barcode payload into the fields a renewal form needs. */
export function parseAamva(raw: string | null | undefined): AamvaParseResult {
  const text = (raw ?? '').trim();
  if (!text) {
    return { ok: false, reason: 'The barcode came back empty.', fields: EMPTY, missingExpiry: true };
  }
  if (!/(?:ANSI|AAMVA)/.test(text.slice(0, 60)) && !/DA[ABCJQS]/.test(text)) {
    return {
      ok: false,
      reason: 'That does not look like a licence barcode.',
      fields: EMPTY,
      missingExpiry: true,
    };
  }

  const el = aamvaElements(text);
  const clean = (code: string): string | null => {
    const value = el.get(code);
    if (value == null) return null;
    // Names and numbers occasionally carry a trailing filler character.
    const trimmed = value.replace(/[\u0000-\u001f]+/g, '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const expiresAt = parseAamvaDate(el.get(FIELD.expiry));
  const fields: AamvaFields = {
    expiresAt,
    birthDate: parseAamvaDate(el.get(FIELD.birthDate)),
    licenceNumber: clean(FIELD.licenceNumber),
    name: {
      family: clean(FIELD.familyName),
      first: clean(FIELD.firstName),
      middle: clean(FIELD.middleName),
    },
    jurisdiction: clean(FIELD.jurisdiction),
    country: clean(FIELD.country),
  };

  return {
    ok: true,
    reason: null,
    fields,
    missingExpiry: expiresAt === null,
  };
}

/** True when the barcode is worth asking for on this kind of document. */
export function kindHasBarcode(kind: string): boolean {
  return kind.toUpperCase() === 'CDL';
}

/** One line describing what came off the card, for the driver to check. */
export function describeAamva(result: AamvaParseResult): string {
  if (!result.ok) return result.reason ?? 'That barcode could not be read.';
  const parts: string[] = [];
  const name = [result.fields.name.first, result.fields.name.family].filter(Boolean).join(' ');
  if (name) parts.push(name);
  if (result.fields.licenceNumber) parts.push(`licence ${result.fields.licenceNumber}`);
  if (result.fields.jurisdiction) parts.push(result.fields.jurisdiction);
  if (result.fields.expiresAt) parts.push(`expires ${result.fields.expiresAt}`);
  return parts.length > 0 ? parts.join(' · ') : 'The barcode carried no readable fields.';
}
