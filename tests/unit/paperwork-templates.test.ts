/**
 * The rate confirmation, invoice and delivery packet.
 *
 * These documents leave the building — a broker signs the rate con and a
 * factoring company funds against the packet — so the tests read the generated
 * bytes back with a small independent extractor rather than trusting the
 * writer's own bookkeeping. If the encoder ever corrupts an octal escape or
 * drops a page footer, the text that a reader sees changes and this fails.
 */
import {
  authorityLabel,
  buildDeliveryPacket,
  buildInvoice,
  buildRateConfirmation,
  dateOf,
  distanceOf,
  moneyOf,
  referenceOf,
  weightOf,
} from '../../src/modules/documents/pdf.templates';
import { toEmbeddableImage } from '../../src/modules/pdf/pdf.images';

/** Pull the text a reader would show, straight out of the content streams. */
function extractText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const pieces: string[] = [];
  const pattern = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const body = match[1] as string;
    pieces.push(
      body
        .replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)))
        .replace(/\\([\\()])/g, '$1'),
    );
  }
  // Replace the per-object newlines with spaces so assertions can look for a
  // phrase rather than guessing where the writer broke lines.
  return pieces.join('\n');
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page /g) ?? []).length;
}

/**
 * Every rectangle in the file, in PDF coordinates. Text extraction cannot see
 * where a box was drawn, and "are these two boxes the same size, on the same
 * row" is exactly the kind of thing that regresses quietly.
 */
function rects(pdf: Buffer): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g;
  const raw = pdf.toString('latin1');
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    out.push({ x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) });
  }
  return out;
}

/** The half-width boxes (party pairs and signature blocks). */
function halfWidthBoxes(pdf: Buffer): Array<{ x: number; y: number; w: number; h: number }> {
  return rects(pdf).filter((r) => Math.abs(r.w - 250) < 0.5);
}

function jpegAsset() {
  const sof = Buffer.alloc(17);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(60, 5);
  sof.writeUInt16BE(200, 7);
  sof.writeUInt8(3, 9);
  const asset = toEmbeddableImage(Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]), 'image/jpeg');
  if (!asset.ok) throw new Error('jpeg fixture rejected');
  return asset;
}

const ISSUED = new Date(Date.UTC(2026, 8, 12, 14, 30));

const CARRIER = {
  name: 'Northline Trucking',
  mc: 'MC548616',
  usdot: 'USDOT548616',
  jurisdiction: 'QC',
  note: null,
};

const ROUTE = [
  { kind: 'PICKUP', label: 'Montréal, QC, CA', scheduled: 'Sep 14, 2026 08:00' },
  { kind: 'DELIVERY', label: 'Toronto, ON, CA', scheduled: 'Sep 15, 2026 16:00' },
];

describe('reference and label formatting', () => {
  it('does not double the MC prefix a carrier typed in themselves', () => {
    // The regression: the header read "MC MC548616" on a real generated rate con.
    expect(authorityLabel('MC', 'MC548616')).toBe('MC 548616');
    expect(authorityLabel('MC', 'MC 548616')).toBe('MC 548616');
    expect(authorityLabel('USDOT', 'usdot-1234')).toBe('USDOT -1234');
    expect(authorityLabel('MC', '548616')).toBe('MC 548616');
  });

  it('builds a short quotable reference from a uuid', () => {
    expect(referenceOf('RC', '00cb6ef3-8f6b-4bea-9268-b55289af3a68')).toBe('RC-00CB6EF3');
  });

  it('formats money with the currency named, not guessed', () => {
    expect(moneyOf('950', 'CAD')).toBe('CA$950.00');
    expect(moneyOf(1073.5, 'USD')).toBe('US$1,073.50');
    expect(moneyOf('-240.5', 'CAD')).toBe('-CA$240.50');
    expect(moneyOf(null, 'CAD')).toBe('—');
  });

  it('states units in both systems and admits when a value is missing', () => {
    expect(weightOf('18000')).toBe('18,000 kg (39,683 lb)');
    expect(distanceOf('420')).toBe('420 km (261 mi)');
    expect(weightOf(null)).toBe('Not specified');
    expect(distanceOf('0')).toBe('Not specified');
  });

  it('renders dates deterministically, in UTC', () => {
    expect(dateOf(ISSUED)).toBe('Sep 12, 2026');
    expect(dateOf(null)).toBe('—');
  });
});

describe('rate confirmation', () => {
  const pdf = () =>
    buildRateConfirmation({
      reference: 'RC-00CB6EF3',
      issuedAt: ISSUED,
      carrier: CARRIER,
      broker: { name: 'Maple Freight Brokers', mc: null, usdot: null, note: null },
      stops: ROUTE,
      details: [
        ['Equipment', 'Reefer'],
        ['Weight', '18,000 kg (39,683 lb)'],
      ],
      rateRows: [{ label: 'Linehaul', amount: 'CA$950.00' }],
      totalLabel: 'Total linehaul (CAD)',
      total: 'CA$950.00',
      detention: 'CA$75.00 per hour after free time',
      terms: ['This rate confirmation records the agreed rate and route for load RC-00CB6EF3.'],
      carrierSignature: null,
      brokerSignature: null,
    });

  it('carries the parties, the lane and the agreed rate', () => {
    const text = extractText(pdf());
    expect(text).toContain('RATE CONFIRMATION');
    expect(text).toContain('RC-00CB6EF3');
    expect(text).toContain('Northline Trucking');
    expect(text).toContain('Maple Freight Brokers');
    expect(text).toContain('Montréal, QC, CA');
    expect(text).toContain('Toronto, ON, CA');
    expect(text).toContain('CA$950.00');
    expect(text).toContain('Total linehaul (CAD)');
    expect(text).toContain('Detention: CA$75.00 per hour after free time');
  });

  it('never prints a doubled authority number', () => {
    const text = extractText(pdf());
    expect(text).toContain('MC 548616');
    expect(text).not.toContain('MC MC548616');
  });

  it('draws the carrier and broker boxes at the same height', () => {
    // A tall carrier box beside a short "not assigned" broker box leaves a
    // ragged edge down the middle of a document a broker signs.
    const boxes = halfWidthBoxes(pdf());
    const partyRow = boxes.filter((r) => Math.abs(r.y - (boxes[0]?.y ?? 0)) < 0.5);
    expect(partyRow).toHaveLength(2);
    expect(partyRow[0]?.h).toBe(partyRow[1]?.h);
    expect(Math.abs((partyRow[0]?.x ?? 0) - (partyRow[1]?.x ?? 0))).toBeGreaterThan(200);
  });

  it('offers both signature blocks, unsigned when nobody has signed', () => {
    const text = extractText(pdf());
    expect(text).toContain('CARRIER ACCEPTANCE');
    expect(text).toContain('BROKER ACCEPTANCE');
    expect(text).toContain('Not signed');
  });

  it('shows the drawn signature and who signed when there is one', () => {
    const signed = buildRateConfirmation({
      reference: 'RC-00CB6EF3',
      issuedAt: ISSUED,
      carrier: CARRIER,
      broker: { name: 'Maple Freight Brokers', note: null },
      stops: ROUTE,
      details: [],
      rateRows: [{ label: 'Linehaul', amount: 'CA$950.00' }],
      totalLabel: 'Total linehaul',
      total: 'CA$950.00',
      detention: null,
      terms: ['Terms.'],
      carrierSignature: null,
      brokerSignature: {
        role: 'BROKER',
        signerName: 'R. Okafor',
        signedAt: ISSUED,
        asset: jpegAsset(),
      },
    });
    const text = extractText(signed);
    expect(text).toContain('R. Okafor');
    expect(text).toContain('Signed Sep 12, 2026 14:30');
    // The signature is an embedded JPEG, not a placeholder.
    expect(signed.toString('latin1')).toContain('/Filter /DCTDecode');
  });

  it('numbers its single page', () => {
    expect(extractText(pdf())).toContain('Page 1 of 1');
  });
});

describe('invoice', () => {
  const base = {
    invoiceNumber: 'INV-80DB9E43',
    issuedAt: ISSUED,
    issuer: CARRIER,
    billTo: { name: 'Northline Logistics Inc', note: 'Billed party on record' },
    currency: 'CAD',
    lines: [{ description: 'Freight charges — load LD-00CB6EF3', amount: 'CA$950.00' }],
    subtotal: 'CA$950.00',
    taxLines: [{ label: 'HST 13%', amount: 'CA$123.50' }],
    total: 'CA$1,073.50',
    issueDate: 'Sep 12, 2026',
    dueDate: 'Oct 12, 2026',
    paymentTerms: 'Net 30 days',
    status: 'OUTSTANDING',
    paidNote: null,
    loadRef: 'LD-00CB6EF3',
    notes: ['Make payment to Northline Trucking, quoting invoice number INV-80DB9E43.'],
  };

  it('carries the amounts, the tax line and the terms', () => {
    const text = extractText(buildInvoice(base));
    expect(text).toContain('INVOICE');
    expect(text).toContain('INV-80DB9E43');
    expect(text).toContain('Northline Logistics Inc');
    expect(text).toContain('CA$950.00');
    expect(text).toContain('HST 13%');
    expect(text).toContain('CA$1,073.50');
    expect(text).toContain('Net 30 days');
    expect(text).toContain('Oct 12, 2026');
    expect(text).toContain('OUTSTANDING');
    expect(text).toContain('LD-00CB6EF3');
  });

  it('says plainly when the invoice is settled', () => {
    const text = extractText(
      buildInvoice({
        ...base,
        status: 'PAID',
        paidNote: 'Paid in full on Sep 30, 2026 — CA$1,073.50. No balance remains on this invoice.',
      }),
    );
    expect(text).toContain('PAID');
    expect(text).toContain('No balance remains on this invoice');
  });

  it('leaves out a charge that was never applied', () => {
    // The service drops zero-value tax rows; nothing here should invent one.
    const text = extractText(buildInvoice({ ...base, taxLines: [] }));
    expect(text).not.toContain('GST');
    expect(text).toContain('CA$1,073.50');
  });
});

describe('delivery packet', () => {
  const packetInput = {
    reference: 'POD-00CB6EF3',
    generatedAt: ISSUED,
    carrier: CARRIER,
    broker: { name: 'Maple Freight Brokers', note: null },
    stops: ROUTE,
    details: [['Equipment', 'Reefer']] as Array<[string, string]>,
    rateRows: [{ label: 'Linehaul', amount: 'CA$950.00' }],
    totalLabel: 'Total linehaul (CAD)',
    total: 'CA$950.00',
    signatures: [
      { role: 'RECEIVER', signerName: 'Dana Whitfield', signedAt: ISSUED, asset: jpegAsset() },
    ],
    attachments: [] as Array<{
      kind: string;
      fileName: string;
      uploadedAt: Date;
      asset: ReturnType<typeof jpegAsset> | null;
      reason?: string | null;
    }>,
    terms: ['This delivery packet records the agreed rate and route for load POD-00CB6EF3.'],
  };

  it('lists what is inside and who signed for the freight', () => {
    const text = extractText(buildDeliveryPacket(packetInput));
    expect(text).toContain('DELIVERY PACKET');
    expect(text).toContain('POD-00CB6EF3');
    // The writer transliterates the em dash to ASCII, so the document reads "-".
    expect(text).toContain('Proof of delivery - 1 signature captured');
    expect(text).toContain('No attachments');
    expect(text).toContain('Dana Whitfield');
    expect(text).toContain('Signed Sep 12, 2026 14:30');
    expect(text).toContain('Montréal, QC, CA');
  });

  it('says so instead of faking a signature when none was captured', () => {
    const text = extractText(buildDeliveryPacket({ ...packetInput, signatures: [] }));
    expect(text).toContain('Proof of delivery - not signed');
    expect(text).toContain('No signature was captured on this load');
  });

  it('lays two captured signatures on one row, not stacked down the left', () => {
    const pdf = buildDeliveryPacket({
      ...packetInput,
      signatures: [
        { role: 'RECEIVER', signerName: 'Dana Whitfield', signedAt: ISSUED, asset: jpegAsset() },
        { role: 'CARRIER', signerName: 'Maria Chen', signedAt: ISSUED, asset: jpegAsset() },
      ],
    });
    const boxes = halfWidthBoxes(pdf).filter((r) => Math.abs(r.h - 96) < 0.5);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.y).toBe(boxes[1]?.y);
    expect(Math.abs((boxes[0]?.x ?? 0) - (boxes[1]?.x ?? 0))).toBeGreaterThan(200);
    // Both drawn signatures are embedded, one per box.
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
  });

  it('embeds a photo attachment and gives it a page of its own', () => {
    const pdf = buildDeliveryPacket({
      ...packetInput,
      attachments: [
        { kind: 'POD', fileName: 'dock-receipt.jpg', uploadedAt: ISSUED, asset: jpegAsset(), reason: null },
      ],
    });
    const text = extractText(pdf);
    expect(text).toContain('dock-receipt.jpg');
    expect(pageCount(pdf)).toBe(2);
    // Signature + attachment = two embedded images.
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
  });

  it('names an attachment it cannot embed rather than dropping it', () => {
    const pdf = buildDeliveryPacket({
      ...packetInput,
      attachments: [
        {
          kind: 'BOL',
          fileName: 'signed-bol.heic',
          uploadedAt: ISSUED,
          asset: null,
          reason: 'unsupported image format (image/heic)',
        },
      ],
    });
    const text = extractText(pdf);
    expect(text).toContain('signed-bol.heic');
    expect(text).toContain('unsupported image format');
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
  });

  it('numbers every page of a multi-page packet', () => {
    const pdf = buildDeliveryPacket({
      ...packetInput,
      attachments: [
        { kind: 'POD', fileName: 'one.jpg', uploadedAt: ISSUED, asset: jpegAsset(), reason: null },
        { kind: 'BOL', fileName: 'two.jpg', uploadedAt: ISSUED, asset: jpegAsset(), reason: null },
      ],
    });
    const text = extractText(pdf);
    const total = pageCount(pdf);
    expect(total).toBeGreaterThanOrEqual(2);
    for (let page = 1; page <= total; page += 1) {
      expect(text).toContain(`Page ${page} of ${total}`);
    }
  });
});
