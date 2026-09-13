/**
 * Turning an uploaded proof-of-delivery photo into something a PDF can embed.
 *
 * No image library is involved, and none is needed for the two formats that
 * matter: a JPEG embeds as its own bytes (DCTDecode is JPEG), and a PNG's
 * zlib-compressed pixels embed as FlateDecode *with the PNG predictor* — the
 * format's own filter, so there is no unfiltering step to get wrong.
 *
 * Formats PDF cannot carry directly (WebP, HEIC, alpha-channel PNGs, a PDF
 * inside a PDF) come back as `ok: false` with a reason, so the packet can say
 * plainly which attachments it could not include rather than dropping them.
 */

export interface EmbeddableImage {
  ok: true;
  width: number;
  height: number;
  /** DCTDecode = JPEG bytes; FLATE = predictor-encoded samples. */
  filter: 'DCTDecode' | 'FlateDecode';
  data: Buffer;
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  components: number;
  bitsPerComponent: number;
  /** Predictor parameters for FLATE images. */
  columns: number;
}

export interface UnembeddableImage {
  ok: false;
  reason: string;
}

export type ImageAsset = EmbeddableImage | UnembeddableImage;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG SOF markers carry the frame size; C4/C8/CC are not frame headers. */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(data: Buffer): ImageAsset {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return { ok: false, reason: 'not a JPEG' };
  }
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1; // resynchronise past padding rather than giving up
      continue;
    }
    const marker = data[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (JPEG_SOF.has(marker)) {
      if (offset + 9 >= data.length) break;
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      const components = data[offset + 9] ?? 3;
      const colorSpace =
        components === 1 ? 'DeviceGray' : components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      if (!width || !height) return { ok: false, reason: 'JPEG has no frame size' };
      return {
        ok: true,
        width,
        height,
        filter: 'DCTDecode',
        data,
        colorSpace,
        components,
        bitsPerComponent: 8,
        columns: width,
      };
    }
    offset += 2 + length;
  }
  return { ok: false, reason: 'JPEG frame header not found' };
}

function parsePng(data: Buffer): ImageAsset {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not a PNG' };
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > data.length) break;

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] ?? 8;
      colorType = body[9] ?? 2;
      interlace = body[12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!width || !height) return { ok: false, reason: 'PNG has no size header' };
  if (idat.length === 0) return { ok: false, reason: 'PNG has no pixel data' };
  // Adam7 interlacing reorders the scanlines, which the PNG predictor assumes
  // are sequential; embedding it would produce a shredded image.
  if (interlace === 1) return { ok: false, reason: 'interlaced PNG' };

  let colorSpace: EmbeddableImage['colorSpace'];
  let components: number;
  switch (colorType) {
    case 0:
      colorSpace = 'DeviceGray';
      components = 1;
      break;
    case 2:
      colorSpace = 'DeviceRGB';
      components = 3;
      break;
    case 3:
      // Palette images need an /Indexed colour space and a lookup stream of
      // their own; POD photos are truecolour or JPEG, so this is reported
      // rather than half-supported.
      return { ok: false, reason: 'palette PNG' };
    case 4:
      return { ok: false, reason: 'PNG with an alpha channel' };
    case 6:
      return { ok: false, reason: 'PNG with an alpha channel' };
    default:
      return { ok: false, reason: `unsupported PNG colour type ${colorType}` };
  }

  return {
    ok: true,
    width,
    height,
    filter: 'FlateDecode',
    data: Buffer.concat(idat),
    colorSpace,
    components,
    bitsPerComponent: bitDepth,
    columns: width,
  };
}

/** Decode an uploaded image (by MIME type and sniffed magic) into a PDF asset. */
export function toEmbeddableImage(data: Buffer, mimeType: string | null | undefined): ImageAsset {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();

  // Sniff rather than trust the metadata: a row can predate the MIME whitelist.
  if (data.length > 1 && data[0] === 0xff && data[1] === 0xd8) return parseJpeg(data);
  if (data.length > 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return parsePng(data);

  if (mime.startsWith('image/')) return { ok: false, reason: `unsupported image format (${mime})` };
  if (mime === 'application/pdf') return { ok: false, reason: 'a PDF attachment' };
  return { ok: false, reason: 'not an image' };
}
