/**
 * Text metrics and encoding for the built-in PDF fonts.
 *
 * PDF's standard 14 fonts are not embedded, so the reader supplies the face —
 * but the *writer* still has to know each glyph's width to align a money column
 * or wrap an address. These tables are the Adobe AFM widths (per 1000 units at
 * size 1) for Helvetica and Helvetica-Bold across printable ASCII, which is
 * enough for every document we produce.
 */

export type PdfFontName = 'regular' | 'bold';

/** ASCII 32..126, in order. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const DEFAULT_WIDTH = 556;

function widthOf(ch: string, font: PdfFontName): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 32 || code > 126) return DEFAULT_WIDTH;
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  return table[code - 32] ?? DEFAULT_WIDTH;
}

/** Width of a string in points at the given size. */
export function textWidth(text: string, size: number, font: PdfFontName = 'regular'): number {
  let total = 0;
  // Measured through the same substitution the encoder applies. A character
  // that prints as several glyphs ("→" prints as "->") has to be measured as
  // those glyphs, or a right-aligned column overflows by exactly the
  // difference between what we measured and what the reader draws.
  for (const ch of text) {
    for (const mapped of PUNCTUATION[ch] ?? ch) total += widthOf(mapped, font);
  }
  return (total * size) / 1000;
}

/**
 * Common Unicode punctuation that a document will contain (our own copy uses
 * curly quotes and dashes) mapped onto WinAnsi codepoints, so a generated
 * invoice never prints question marks where an apostrophe belongs.
 */
const PUNCTUATION: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': ',',
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2022': '\u00b7',
  '\u2026': '...',
  '\u00a0': ' ',
  '\u2032': "'",
  '\u2033': '"',
  '\u2212': '-',
  '\u00ad': '-',
  // Lanes are written "QC → ON" throughout the app, and the built-in fonts have
  // no arrow: without this the statement prints "QC ? ON", which reads like a
  // missing value on a document that goes to a driver and a payroll file.
  '\u2192': '->',
  '\u2190': '<-',
  '\u2194': '<->',
};

/**
 * Encode text for a PDF literal string as WinAnsi bytes.
 *
 * WinAnsiEncoding is Latin-1 plus a few high slots, and the built-in fonts have
 * no glyph outside it. Characters that survive as Latin-1 (é, ô, ü — Québec
 * addresses are full of them) are kept; everything else is transliterated or
 * replaced, because a reader shows garbage rather than falling back.
 */
export function toWinAnsi(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const mapped = PUNCTUATION[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0) ?? 63;
      if (code === 10 || code === 13) {
        out.push(32);
      } else if (code >= 32 && code <= 126) {
        out.push(code);
      } else if (code >= 160 && code <= 255) {
        out.push(code);
      } else {
        out.push(63); // '?'
      }
    }
  }
  return Buffer.from(out);
}

/**
 * Escape a WinAnsi-encoded string for a PDF literal `( )` string: backslash and
 * both parentheses must be escaped, and a non-printable byte is written in
 * octal. Length is preserved so the byte offsets in the xref table stay right.
 */
export function escapeLiteral(encoded: Buffer): Buffer {
  const out: number[] = [];
  for (const byte of encoded) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out.push(0x5c, byte);
    } else if (byte < 32 || byte > 126) {
      out.push(0x5c, 0x30 + ((byte >> 6) & 7), 0x30 + ((byte >> 3) & 7), 0x30 + (byte & 7));
    } else {
      out.push(byte);
    }
  }
  return Buffer.from(out);
}

/** WinAnsi bytes ready to sit inside a `( ... )` PDF string. */
export function pdfString(text: string): Buffer {
  return escapeLiteral(toWinAnsi(text));
}

/**
 * Greedy word wrap against the real font metrics. Words longer than the line
 * are hard-split rather than overflowing the margin, because a commodity or a
 * company name can be one very long token.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: PdfFontName = 'regular',
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, font) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (textWidth(word, size, font) <= maxWidth) {
        current = word;
        continue;
      }
      // Hard-split a token that cannot fit on a line by itself.
      let piece = '';
      for (const ch of word) {
        if (textWidth(piece + ch, size, font) > maxWidth && piece) {
          lines.push(piece);
          piece = ch;
        } else {
          piece += ch;
        }
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines;
}
