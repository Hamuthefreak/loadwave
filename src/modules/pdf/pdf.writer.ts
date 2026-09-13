/**
 * A small PDF writer.
 *
 * Loadwave ships paperwork customers hand to brokers and factoring companies,
 * so this has to produce real files — but a PDF for text, rules, boxes and a
 * signature image is a bounded problem, and the alternative is a dependency
 * that has to survive every `npm ci` on a small VM. The same reasoning built
 * the TOTP implementation rather than adding one.
 *
 * What it does: pages of text in Helvetica/Helvetica-Bold, lines, filled and
 * outlined rectangles, and embedded JPEG/PNG images. What it deliberately does
 * not: encryption, interactive forms, font embedding, or layers.
 *
 * Coordinates are **top-left origin and in points**, which is how a document
 * gets laid out. The bottom-left flip PDF itself expects happens here, once.
 */

import { pdfString, textWidth, wrapText, type PdfFontName } from './pdf.fonts';
import type { EmbeddableImage } from './pdf.images';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const GREY: Rgb = { r: 0.42, g: 0.45, b: 0.5 };
export const RULE_GREY: Rgb = { r: 0.8, g: 0.82, b: 0.85 };
export const ACCENT: Rgb = { r: 0.09, g: 0.36, b: 0.24 };

export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

export interface PdfOptions {
  size?: PageSizeName;
  /** Document title in the file's metadata. */
  title?: string;
  /** Author/organisation shown in the file's metadata. */
  author?: string;
  /** Injected so tests can pin the timestamp. */
  createdAt?: Date;
}

export interface TextStyle {
  size?: number;
  font?: PdfFontName;
  color?: Rgb;
}

export interface TextOptions extends TextStyle {
  /** Anchor the string at x, at x - width, or centred on x. */
  align?: 'left' | 'right' | 'center';
}

type Op =
  | { kind: 'text'; text: string; x: number; y: number; size: number; font: PdfFontName; color: Rgb }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: Rgb }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: Rgb;
      stroke?: Rgb;
      strokeWidth: number;
    }
  | { kind: 'image'; name: string; x: number; y: number; w: number; h: number };

interface Page {
  ops: Op[];
  images: Set<string>;
}

interface EmbeddedImage {
  name: string;
  asset: EmbeddableImage;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  // Avoid exponent notation and "-0", both of which a PDF parser rejects.
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return String(rounded);
}

/** `D:YYYYMMDDHHmmSS+00'00'` — the only date format PDF metadata accepts. */
function pdfDate(date: Date): string {
  const pad = (v: number): string => String(v).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private readonly pages: Page[] = [];
  private readonly images: EmbeddedImage[] = [];
  private readonly opts: PdfOptions;
  /** Which page new ops land on — moved by `stampPages` for footers. */
  private activeIndex = 0;

  constructor(opts: PdfOptions = {}) {
    const size = PAGE_SIZES[opts.size ?? 'letter'];
    this.width = size.width;
    this.height = size.height;
    this.opts = opts;
    this.pages.push({ ops: [], images: new Set() });
  }

  private get current(): Page {
    const page = this.pages[this.activeIndex];
    if (!page) throw new Error('no page');
    return page;
  }

  addPage(): void {
    this.pages.push({ ops: [], images: new Set() });
    this.activeIndex = this.pages.length - 1;
  }

  /**
   * Draw on every page once its content is final — the only way to write
   * "Page 2 of 3", since the total is unknown while the pages are being built.
   * The callback receives 1-based page numbers and draws on that page.
   */
  stampPages(render: (page: number, total: number) => void): void {
    const total = this.pages.length;
    const previous = this.activeIndex;
    for (let i = 0; i < total; i += 1) {
      this.activeIndex = i;
      render(i + 1, total);
    }
    this.activeIndex = previous;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Register an image; the returned name is stable and used by `image()`. */
  addImage(asset: EmbeddableImage): string {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, asset });
    return name;
  }

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    if (value === '') return;
    const size = options.size ?? 10;
    const font = options.font ?? 'regular';
    const color = options.color ?? BLACK;
    let left = x;
    if (options.align === 'right') left = x - textWidth(value, size, font);
    else if (options.align === 'center') left = x - textWidth(value, size, font) / 2;
    this.current.ops.push({ kind: 'text', text: value, x: left, y, size, font, color });
  }

  /** Width of a string in this document's metrics — for laying out columns. */
  measure(value: string, size = 10, font: PdfFontName = 'regular'): number {
    return textWidth(value, size, font);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb = RULE_GREY, width = 0.7): void {
    this.current.ops.push({ kind: 'line', x1, y1, x2, y2, width, color });
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    options: { fill?: Rgb; stroke?: Rgb; strokeWidth?: number } = {},
  ): void {
    this.current.ops.push({
      kind: 'rect',
      x,
      y,
      w,
      h,
      strokeWidth: options.strokeWidth ?? 0.7,
      ...(options.fill ? { fill: options.fill } : {}),
      ...(options.stroke ? { stroke: options.stroke } : {}),
    });
  }

  /** Draw an image, scaled to fit the box while preserving its aspect ratio. */
  image(name: string, x: number, y: number, maxW: number, maxH: number): { width: number; height: number } {
    const found = this.images.find((i) => i.name === name);
    const ratio = found ? found.asset.width / found.asset.height : 1;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    this.current.ops.push({ kind: 'image', name, x, y, w, h });
    this.current.images.add(name);
    return { width: w, height: h };
  }

  /**
   * Wrap a paragraph into the given width and draw it, returning the y to
   * continue from (so callers can stack blocks without guessing heights).
   */
  paragraph(
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    options: TextStyle & { leading?: number } = {},
  ): number {
    const size = options.size ?? 10;
    const leading = options.leading ?? size * 1.35;
    const lines = wrapText(value, maxWidth, size, options.font ?? 'regular');
    let cursor = y;
    for (const line of lines) {
      this.text(line, x, cursor, options);
      cursor += leading;
    }
    return cursor;
  }

  private contentFor(page: Page): Buffer {
    const parts: string[] = [];
    for (const op of page.ops) {
      switch (op.kind) {
        case 'text': {
          const c = op.color;
          parts.push(
            `BT /${op.font === 'bold' ? 'F2' : 'F1'} ${num(op.size)} Tf ` +
              `${num(c.r)} ${num(c.g)} ${num(c.b)} rg 1 0 0 1 ${num(op.x)} ${num(this.height - op.y)} Tm ` +
              `(${pdfString(op.text).toString('latin1')}) Tj ET`,
          );
          break;
        }
        case 'line': {
          const c = op.color;
          parts.push(
            `${num(op.width)} w ${num(c.r)} ${num(c.g)} ${num(c.b)} RG ` +
              `${num(op.x1)} ${num(this.height - op.y1)} m ${num(op.x2)} ${num(this.height - op.y2)} l S`,
          );
          break;
        }
        case 'rect': {
          const ops: string[] = [];
          if (op.fill) ops.push(`${num(op.fill.r)} ${num(op.fill.g)} ${num(op.fill.b)} rg`);
          if (op.stroke) ops.push(`${num(op.strokeWidth)} w ${num(op.stroke.r)} ${num(op.stroke.g)} ${num(op.stroke.b)} RG`);
          const paint = op.fill && op.stroke ? 'B' : op.fill ? 'f' : 'S';
          ops.push(
            `${num(op.x)} ${num(this.height - op.y - op.h)} ${num(op.w)} ${num(op.h)} re ${paint}`,
          );
          parts.push(ops.join(' '));
          break;
        }
        case 'image': {
          parts.push(
            `q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(this.height - op.y - op.h)} cm /${op.name} Do Q`,
          );
          break;
        }
      }
    }
    return Buffer.from(`${parts.join('\n')}\n`, 'latin1');
  }

  build(): Buffer {
    const fontCount = 2;
    const firstImageObject = 3 + fontCount; // 1 = catalog, 2 = pages
    const imageObjects = new Map<string, number>();
    this.images.forEach((img, index) => imageObjects.set(img.name, firstImageObject + index));
    const firstPageObject = firstImageObject + this.images.length;

    const chunks: Buffer[] = [];
    const offsets = new Map<number, number>();
    let length = 0;

    const header = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
    chunks.push(header);
    length += header.length;

    const push = (objectNumber: number, parts: (Buffer | string)[]): void => {
      const body = Buffer.concat([
        Buffer.from(`${objectNumber} 0 obj\n`, 'latin1'),
        ...parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)),
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      offsets.set(objectNumber, length);
      chunks.push(body);
      length += body.length;
    };

    const pageObjectNumbers = this.pages.map((_, i) => firstPageObject + i * 2);

    // 1 — catalog
    push(1, [`<< /Type /Catalog /Pages 2 0 R >>`]);

    // 2 — page tree
    push(2, [
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageObjectNumbers
        .map((n) => `${n} 0 R`)
        .join(' ')}] >>`,
    ]);

    // 3, 4 — the two built-in fonts
    push(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
    push(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);

    // images
    for (const img of this.images) {
      const objectNumber = imageObjects.get(img.name) as number;
      const a = img.asset;
      const dict: string[] = [
        '/Type /XObject',
        '/Subtype /Image',
        `/Width ${a.width}`,
        `/Height ${a.height}`,
        `/ColorSpace /${a.colorSpace}`,
        `/BitsPerComponent ${a.bitsPerComponent}`,
        `/Filter /${a.filter}`,
      ];
      if (a.filter === 'FlateDecode') {
        dict.push(
          `/DecodeParms << /Predictor 15 /Colors ${a.components} /BitsPerComponent ${a.bitsPerComponent} /Columns ${a.columns} >>`,
        );
      }
      dict.push(`/Length ${a.data.length}`);
      push(objectNumber, [`<< ${dict.join(' ')} >>\nstream\n`, a.data, '\nendstream']);
    }

    // pages + their content streams
    this.pages.forEach((page, index) => {
      const pageObject = pageObjectNumbers[index] as number;
      const contentObject = pageObject + 1;
      const xobjects = [...page.images]
        .map((name) => `/${name} ${imageObjects.get(name)} 0 R`)
        .join(' ');
      push(pageObject, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${
            xobjects ? ` /XObject << ${xobjects} >>` : ''
          } >> /Contents ${contentObject} 0 R >>`,
      ]);
      const content = this.contentFor(page);
      push(contentObject, [`<< /Length ${content.length} >>\nstream\n`, content, 'endstream']);
    });

    // trailer
    const size = firstPageObject + this.pages.length * 2;
    const infoObject = size;
    const created = this.opts.createdAt ?? new Date();
    push(infoObject, [
      `<< /Title (${pdfString(this.opts.title ?? 'Document').toString('latin1')}) ` +
        `/Author (${pdfString(this.opts.author ?? 'Loadwave').toString('latin1')}) ` +
        `/Producer (${pdfString('Loadwave').toString('latin1')}) ` +
        `/CreationDate (${pdfDate(created)}) >>`,
    ]);

    const total = infoObject + 1;
    const xrefOffset = length;
    const entries: string[] = ['0000000000 65535 f \n'];
    for (let n = 1; n < total; n += 1) {
      const offset = offsets.get(n) ?? 0;
      entries.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    const xref = Buffer.from(
      `xref\n0 ${total}\n${entries.join('')}trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1',
    );
    chunks.push(xref);
    return Buffer.concat(chunks);
  }
}
