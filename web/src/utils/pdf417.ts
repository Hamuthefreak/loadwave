/**
 * Read the PDF417 barcode out of a photo of the back of a licence.
 *
 * This runs entirely in the browser, which is the point: the licence photo never
 * leaves the driver's phone. Nothing is uploaded to decode it, there is no third
 * party to hand an identity document to, and it still works on a truck-stop
 * connection — or with none at all.
 *
 * The decoder is imported on demand, so its weight is paid only by the drivers
 * who actually scan something rather than by every page load — which is what
 * keeps a ~120 kB gzipped library off the dashboard of everyone who never taps
 * Scan.
 *
 * A failure is normal and expected — glare, a thumb over the barcode, a photo
 * taken from too far away — so this returns null rather than throwing, and the
 * caller falls back to typing. Rotations are tried because nobody holds a phone
 * square to the card, and PDF417 cannot be read sideways.
 */

/** Bigger than this is wasted work; much smaller and the bars blur together. */
const TARGET_LONG_EDGE = 1800;
const ROTATIONS = [0, 90, 180, 270];

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('not an image'));
      image.src = url;
    });
    return image;
  } finally {
    // The loaded element keeps its own reference to the decoded data.
    URL.revokeObjectURL(url);
  }
}

/** The photo, scaled to a sane size and turned to the given angle. */
export function rotateToCanvas(
  image: HTMLImageElement,
  rotation: number,
  targetLongEdge: number = TARGET_LONG_EDGE,
): HTMLCanvasElement {
  const swap = rotation === 90 || rotation === 270;
  const scale = targetLongEdge / Math.max(image.width, image.height);
  // Never upscale: a blurry photo does not get sharper, and the extra pixels
  // only make the detector slower.
  const factor = scale < 1 ? scale : 1;
  const drawnWidth = Math.max(1, Math.round(image.width * factor));
  const drawnHeight = Math.max(1, Math.round(image.height * factor));

  const canvas = document.createElement('canvas');
  canvas.width = swap ? drawnHeight : drawnWidth;
  canvas.height = swap ? drawnWidth : drawnHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // The bars need contrast against something: a transparent canvas composites
  // to black, which inverts the barcode and makes it unreadable.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -drawnWidth / 2, -drawnHeight / 2, drawnWidth, drawnHeight);
  ctx.restore();
  return canvas;
}

/**
 * The barcode text, or null when no rotation of the photo would read.
 * Never throws: a failed scan is a normal outcome, not a red box.
 */
export async function readPdf417FromImage(file: File): Promise<string | null> {
  try {
    const image = await loadImage(file);
    if (!image.width || !image.height) return null;

    // The PDF417 reader itself, not MultiFormatReader: a licence carries exactly
    // one format, so there is nothing to dispatch over and nothing to hint at.
    const {
      BinaryBitmap,
      DecodeHintType,
      HybridBinarizer,
      HTMLCanvasElementLuminanceSource,
      PDF417Reader,
    } = await import('@zxing/library');

    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new PDF417Reader();

    for (const rotation of ROTATIONS) {
      try {
        const source = new HTMLCanvasElementLuminanceSource(rotateToCanvas(image, rotation));
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const text = reader.decode(bitmap, hints).getText();
        if (text && text.trim().length > 0) return text;
      } catch {
        // This rotation found nothing; the next is 90° further round.
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}
