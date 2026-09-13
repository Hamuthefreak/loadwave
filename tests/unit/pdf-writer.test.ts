/**
 * The PDF writer.
 *
 * A malformed PDF is not a cosmetic bug: the whole point of these files is that
 * a factoring company or a broker can open them. So these tests do not just
 * look for a header — they walk the cross-reference table the way a reader
 * does and check that every entry points at the object it claims to.
 */
import { PdfDocument, PAGE_SIZES } from '../../src/modules/pdf/pdf.writer';
import { pdfString, textWidth, toWinAnsi, wrapText } from '../../src/modules/pdf/pdf.fonts';
import { toEmbeddableImage } from '../../src/modules/pdf/pdf.images';

const AT = new Date(Date.UTC(2026, 8, 12, 10, 30, 0));

/** Read the trailing xref table exactly as a PDF reader would. */
function readXref(pdf: Buffer): { offsets: Array<{ number: number; offset: number }>; size: number } {
  const text = pdf.toString('latin1');
  const startIdx = text.lastIndexOf('startxref');
  expect(startIdx).toBeGreaterThan(-1);
  const offset = Number(text.slice(startIdx + 'startxref'.length).trim().split(/\s/)[0]);
  expect(Number.isFinite(offset)).toBe(true);

  expect(text.slice(offset, offset + 4)).toBe('xref');
  const head = /^xref\n(\d+) (\d+)\n/.exec(text.slice(offset, offset + 40));
  expect(head).not.toBeNull();
  const first = Number(head?.[1]);
  const count = Number(head?.[2]);
  expect(first).toBe(0);

  const tableStart = offset + head![0].length;
  const offsets: Array<{ number: number; offset: number }> = [];
  for (let i = 1; i < count; i += 1) {
    const entry = text.slice(tableStart + i * 20, tableStart + i * 20 + 20);
    expect(entry).toHaveLength(20);
    expect(entry.endsWith(' n \n')).toBe(true);
    offsets.push({ number: i, offset: Number(entry.slice(0, 10)) });
  }
  return { offsets, size: count };
}

describe('PdfDocument structure', () => {
  it('writes a header, a trailer and a complete cross-reference table', () => {
    const doc = new PdfDocument({ title: 'Rate confirmation', createdAt: AT });
    doc.text('Hello', 40, 60);
    const pdf = doc.build();

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);

    const { offsets, size } = readXref(pdf);
    expect(offsets.length).toBe(size - 1);
    expect(size).toBeGreaterThanOrEqual(6);

    // Every xref entry must land exactly on "<n> 0 obj".
    for (const { number, offset } of offsets) {
      expect(pdf.subarray(offset, offset + `${number} 0 obj`.length).toString('latin1')).toBe(
        `${number} 0 obj`,
      );
    }
  });

  it('declares a page tree whose count matches the pages written', () => {
    const doc = new PdfDocument({ createdAt: AT });
    doc.text('Page one', 40, 60);
    doc.addPage();
    doc.text('Page two', 40, 60);
    const pdf = doc.build();
    const text = pdf.toString('latin1');

    expect(doc.pageCount).toBe(2);
    expect(text).toContain('/Type /Pages /Count 2');
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(2);
  });

  it('lays out with a top-left origin, flipping only inside the writer', () => {
    const doc = new PdfDocument({ size: 'letter', createdAt: AT });
    doc.text('top', 40, 100);
    const text = doc.build().toString('latin1');
    // Letter is 792pt tall, so y=100 from the top is 692 from the bottom.
    expect(text).toContain('1 0 0 1 40 692 Tm');
    expect(PAGE_SIZES.letter.height).toBe(792);
  });

  it('escapes parentheses and backslashes so they cannot break the content stream', () => {
    const doc = new PdfDocument({ createdAt: AT });
    doc.text('ACME (Ontario) \\ Co', 40, 60);
    const text = doc.build().toString('latin1');
    expect(text).toContain('(ACME \\(Ontario\\) \\\\ Co) Tj');
  });

  it('keeps accented characters out of the question-mark graveyard', () => {
    const doc = new PdfDocument({ createdAt: AT });
    doc.text('Québec → Montréal', 40, 60);
    const text = doc.build().toString('latin1');
    // é is WinAnsi 0xE9, written as the octal escape \351 so the content
    // stream stays 7-bit ASCII. The arrow has no glyph in WinAnsi, so it is
    // transliterated to "->" rather than dropped: lanes are written "QC → ON"
    // throughout the app, and on a settlement statement "QC ? ON" reads like a
    // missing value.
    expect(text).toContain('Qu\\351bec -> Montr\\351al');
  });

  it('right-aligns against the real font metrics', () => {
    const doc = new PdfDocument({ createdAt: AT });
    doc.text('12,345.67', 500, 60, { align: 'right' });
    const text = doc.build().toString('latin1');
    const match = /1 0 0 1 (\d+(?:\.\d+)?) 732 Tm/.exec(text);
    expect(match).not.toBeNull();
    const x = Number(match?.[1]);
    // The string must end at the requested right edge.
    expect(x + textWidth('12,345.67', 10)).toBeCloseTo(500, 1);
  });

  it('draws a filled rectangle with the top-left y converted correctly', () => {
    const doc = new PdfDocument({ createdAt: AT });
    doc.rect(40, 100, 200, 20, { fill: { r: 0.9, g: 0.9, b: 0.9 } });
    const text = doc.build().toString('latin1');
    expect(text).toContain('40 672 200 20 re f');
  });
});

describe('PdfDocument images', () => {
  it('embeds a JPEG as a DCTDecode XObject referenced by the page', () => {
    const jpeg = jpegFixture(120, 80, 3);
    const asset = toEmbeddableImage(jpeg, 'image/jpeg');
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;

    const doc = new PdfDocument({ createdAt: AT });
    const name = doc.addImage(asset);
    const drawn = doc.image(name, 40, 100, 200, 300);
    const text = doc.build().toString('latin1');

    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 120 /Height 80');
    expect(text).toContain('/XObject << /Im1 5 0 R >>');
    expect(text).toContain('/Im1 Do');
    // Aspect ratio preserved inside the box.
    expect(drawn.width).toBeCloseTo(200, 1);
    expect(drawn.height).toBeCloseTo(200 * (80 / 120), 1);
  });

  it('caps a tall image to the box height instead of overflowing the page', () => {
    const jpeg = jpegFixture(80, 400, 3);
    const asset = toEmbeddableImage(jpeg, 'image/jpeg');
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;
    const doc = new PdfDocument({ createdAt: AT });
    const drawn = doc.image(doc.addImage(asset), 40, 100, 300, 150);
    expect(drawn.height).toBeLessThanOrEqual(150);
  });

  it('only lists the images a page actually uses', () => {
    const asset = toEmbeddableImage(jpegFixture(10, 10, 3), 'image/jpeg');
    if (!asset.ok) throw new Error('fixture failed');
    const doc = new PdfDocument({ createdAt: AT });
    const name = doc.addImage(asset);
    doc.image(name, 10, 10, 50, 50);
    doc.addPage();
    doc.text('no image here', 10, 10);
    const text = doc.build().toString('latin1');

    const pages = text.split('/Type /Page ').slice(1);
    expect(pages[0]).toContain('/XObject << /Im1');
    expect(pages[1]).not.toContain('/XObject');
  });
});

describe('image assets', () => {
  it('reads the frame size out of a JPEG SOF marker', () => {
    const asset = toEmbeddableImage(jpegFixture(640, 480, 3), 'image/jpeg');
    expect(asset).toMatchObject({ ok: true, width: 640, height: 480, filter: 'DCTDecode' });
  });

  it('treats a greyscale JPEG as DeviceGray rather than a broken RGB one', () => {
    const asset = toEmbeddableImage(jpegFixture(64, 64, 1), 'image/jpeg');
    expect(asset).toMatchObject({ ok: true, colorSpace: 'DeviceGray', components: 1 });
  });

  it('reads a PNG header and hands the pixels to the PNG predictor', () => {
    const asset = toEmbeddableImage(pngFixture(300, 200, 2), 'image/png');
    expect(asset).toMatchObject({
      ok: true,
      width: 300,
      height: 200,
      filter: 'FlateDecode',
      colorSpace: 'DeviceRGB',
      components: 3,
      columns: 300,
    });
  });

  it('reports what it cannot embed instead of writing a broken image', () => {
    // Alpha PNG: PDF would need an SMask built from the unfiltered samples.
    expect(toEmbeddableImage(pngFixture(10, 10, 6), 'image/png')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('alpha'),
    });
    expect(toEmbeddableImage(Buffer.from('%PDF-1.4 fake'), 'application/pdf')).toMatchObject({
      ok: false,
      reason: 'a PDF attachment',
    });
    expect(toEmbeddableImage(Buffer.from('nonsense'), 'text/plain')).toMatchObject({
      ok: false,
    });
  });

  it('sniffs the bytes, so a mislabelled upload still embeds', () => {
    // A PNG uploaded with the wrong MIME type is still a PNG.
    const asset = toEmbeddableImage(pngFixture(20, 10, 2), 'application/octet-stream');
    expect(asset.ok).toBe(true);
  });

  it('rejects a JPEG that is only a signature with no frame header', () => {
    expect(toEmbeddableImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toMatchObject({
      ok: false,
    });
  });
});

describe('text encoding and metrics', () => {
  it('maps typographic punctuation onto WinAnsi rather than dropping it', () => {
    expect(toWinAnsi('\u2019').toString('latin1')).toBe("'");
    expect(toWinAnsi('\u2014').toString('latin1')).toBe('-');
    expect(toWinAnsi('a\u00a0b').toString('latin1')).toBe('a b');
  });

  it('escapes a literal string for the PDF syntax', () => {
    expect(pdfString('a(b)c\\d').toString('latin1')).toBe('a\\(b\\)c\\\\d');
  });

  it('measures text proportionally, not per character', () => {
    // Helvetica "i" is 222/1000 and "W" is 944/1000, so this is a real check.
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('WWWW', 10));
    expect(textWidth('', 10)).toBe(0);
  });

  it('wraps to the available width and never exceeds it', () => {
    const lines = wrapText('Freight from Montréal to Toronto via Highway 401', 120, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(120);
  });

  it('hard-splits a token that cannot fit on a line of its own', () => {
    const lines = wrapText('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 40, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(40);
  });

  it('keeps explicit line breaks', () => {
    expect(wrapText('line one\nline two', 500, 10)).toEqual(['line one', 'line two']);
  });
});

/** A syntactically valid JPEG: SOI, one SOF0 frame header, EOI. */
function jpegFixture(width: number, height: number, components: number): Buffer {
  const sof = Buffer.alloc(8 + 3 * components);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(sof.length, 2);
  sof.writeUInt8(8, 4); // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(components, 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

/** A PNG header with a real IHDR and one IDAT chunk (CRCs left as zeros). */
function pngFixture(width: number, height: number, colorType: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(colorType, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12); // not interlaced
  const chunk = (type: string, body: Buffer): Buffer =>
    Buffer.concat([
      (() => {
        const l = Buffer.alloc(4);
        l.writeUInt32BE(body.length, 0);
        return l;
      })(),
      Buffer.from(type, 'ascii'),
      body,
      Buffer.alloc(4),
    ]);
  const idatBody = Buffer.from([0x78, 0x9c, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatBody),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
