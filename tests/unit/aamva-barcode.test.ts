import bwipjs from 'bwip-js';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  PDF417Reader,
  RGBLuminanceSource,
} from '@zxing/library';
import {
  aamvaElements,
  parseAamva,
  // The root tsc program (Node16 resolution) flags this CJS→ESM import as
  // TS1479. ts-jest compiles it fine and would call the directive "unused",
  // so that diagnostic is ignored in jest.config.json — while `npm run
  // typecheck` still enforces @ts-expect-error correctness everywhere else.
  // @ts-expect-error — cross-package ESM import from the web workspace
} from '../../web/src/utils/aamva';

/**
 * The barcode half of the licence scan, end to end.
 *
 * `aamva.test.ts` checks the parser against a payload copied out of the
 * standard. That leaves the interesting question open: does a *generated*
 * PDF417 of that payload survive the reader the app actually ships, and come
 * back as the fields a renewal form needs? So this file encodes a symbol with
 * bwip-js, renders its module map into pixels, and reads it back with the same
 * reader and the same hint `web/src/utils/pdf417.ts` uses in the browser.
 *
 * What it cannot cover is the camera half — a phone photo of a plastic card,
 * decoded through a canvas. There is no canvas in this test environment, so
 * that path is exercised in a real browser instead; here the photo is a
 * clean rendering of the symbol, which is the best case that path has to beat.
 */

/** A payload of the shape a Canadian province writes: dates year-first. */
const ONTARIO_CDL = [
  '@',
  '\u001e\rANSI 636015080002DL00340291DLDAQB1234567',
  'DCSMARTIN',
  'DACJOSEPHINE',
  'DBB19860412',
  'DBA20271130',
  'DAJON',
].join('\n');

/** And one of the shape a US state writes: dates month-first. */
const VIRGINIA_CDL = [
  '@',
  '\u001e\rANSI 636000100102DL00410278ZV03190008DLDAQT64235789',
  'DCSSAMPLE',
  'DACMICHAEL',
  'DADJOHN',
  'DBD06062019',
  'DBB06061986',
  'DBA12102024',
  'DAJVA',
  'DCGUSA',
].join('\n');

/** What `bwipjs.raw()` hands back for a matrix symbol. */
interface ModuleMap {
  /** One entry per module, black or white, row by row. */
  pixs: number[];
  /** Modules per row. */
  pixx: number;
}

interface Rendered {
  pixels: Int32Array;
  width: number;
  height: number;
}

/**
 * The symbol as pixels.
 *
 * bwip-js returns the *modules*, not a picture: `pixs` has one entry per module
 * with `pixx` of them to a row, and the caller is expected to draw it. So draw
 * it the way the standard describes a PDF417 is printed — three modules of
 * height per row, and a quiet zone of a few modules around the whole thing —
 * at whatever scale a camera would see. Without the quiet zone a reader has no
 * way to find the edges of the symbol, which is why a real card has one.
 */
function renderMap(map: ModuleMap, { scale = 3, rowHeight = 3, quiet = 4 } = {}): Rendered {
  const rows = map.pixs.length / map.pixx;
  const width = (map.pixx + quiet * 2) * scale;
  const height = (rows * rowHeight + quiet * 2) * scale;
  const pixels = new Int32Array(width * height).fill(0xffffffff);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < map.pixx; x++) {
      if (!map.pixs[y * map.pixx + x]) continue;
      const left = (x + quiet) * scale;
      const top = (y * rowHeight + quiet) * scale;
      for (let dy = 0; dy < rowHeight * scale; dy++) {
        const rowStart = (top + dy) * width;
        for (let dx = 0; dx < scale; dx++) {
          pixels[rowStart + left + dx] = 0xff000000;
        }
      }
    }
  }
  return { pixels, width, height };
}

/** The symbol for a payload, rendered: the "photo" these tests read. */
function symbolFor(text: string): Rendered {
  const [map] = bwipjs.raw({ bcid: 'pdf417', text, scale: 3 }) as unknown as ModuleMap[];
  return renderMap(map as ModuleMap);
}

/**
 * Read a barcode back out of an image.
 *
 * The reader and the hint are the ones in `web/src/utils/pdf417.ts`. They are
 * repeated here rather than imported because that module decodes a canvas, and
 * there is no canvas in this process.
 */
function readBarcode({ pixels, width, height }: Rendered): string {
  const source = new RGBLuminanceSource(pixels, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new PDF417Reader().decode(bitmap, hints).getText();
}

describe('a generated licence barcode', () => {
  it('comes back byte for byte, header and compliance indicator included', () => {
    // Not just "some text": the parser's header handling — skip the compliance
    // indicator, skip the 12-digit file header, skip the subfile designators —
    // only earns its keep if those bytes are really there to skip.
    expect(readBarcode(symbolFor(ONTARIO_CDL))).toBe(ONTARIO_CDL);

    const elements = aamvaElements(readBarcode(symbolFor(VIRGINIA_CDL)));
    expect(elements.get('DBA')).toBe('12102024');
    // The subfile designators (DL00410278, ZV03190008) survived the round trip
    // as bytes and were still not mistaken for elements.
    expect([...elements.keys()].some((code) => /^\d|^DL\d/.test(code))).toBe(false);
  });

  it('fills in the expiry and the licence number a renewal form needs', () => {
    const result = parseAamva(readBarcode(symbolFor(ONTARIO_CDL)));
    expect(result.ok).toBe(true);
    expect(result.missingExpiry).toBe(false);
    expect(result.fields.expiresAt).toBe('2027-11-30');
    expect(result.fields.licenceNumber).toBe('B1234567');
    expect(result.fields.name).toEqual({ family: 'MARTIN', first: 'JOSEPHINE', middle: null });
    expect(result.fields.jurisdiction).toBe('ON');
  });

  it('reads a jurisdiction that prints the date the other way round', () => {
    const result = parseAamva(readBarcode(symbolFor(VIRGINIA_CDL)));
    expect(result.fields.expiresAt).toBe('2024-12-10');
    expect(result.fields.birthDate).toBe('1986-06-06');
    expect(result.fields.licenceNumber).toBe('T64235789');
    expect(result.fields.name.family).toBe('SAMPLE');
    expect(result.fields.country).toBe('USA');
  });

  it('survives a photo taken from further away than it should have been', () => {
    // A driver who fills the frame with the whole card, barcode four modules to
    // the pixel: the reader has to still find it, because re-shooting is not the
    // failure mode anyone has patience for at a fuel stop.
    const [map] = bwipjs.raw({ bcid: 'pdf417', text: ONTARIO_CDL, scale: 3 }) as unknown as ModuleMap[];
    const far = renderMap(map as ModuleMap, { scale: 1, rowHeight: 2, quiet: 2 });
    expect(parseAamva(readBarcode(far)).fields.expiresAt).toBe('2027-11-30');
  });

  it('gives up quietly on a photo with no barcode in it', () => {
    // readPdf417FromImage() turns this throw into a null, and the sheet then
    // says so and leaves the date alone. What must not happen is a wrong read.
    const blank = { pixels: new Int32Array(320 * 200).fill(0xffffffff), width: 320, height: 200 };
    const warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => readBarcode(blank)).toThrow();
    warned.mockRestore();
  });
});
