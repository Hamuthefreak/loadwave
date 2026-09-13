/**
 * The documents a carrier actually has to hand over: a rate confirmation, an
 * invoice, and a delivery packet with the receiver's signature on it.
 *
 * Which one matters where: a broker wants the rate con before the truck rolls,
 * a factoring company wants rate con + signed POD + invoice as one file, and an
 * invoice on its own is what a customer pays against. So the packet exists as a
 * first-class document rather than three separate downloads.
 *
 * Everything here is a pure function of prepared input: no database, no clock,
 * no locale. Money and dates are formatted by hand so the same record always
 * produces the same bytes, whatever server it runs on.
 */

import { PdfDocument, ACCENT, GREY, RULE_GREY, type Rgb } from '../pdf/pdf.writer';
import { wrapText } from '../pdf/pdf.fonts';
import type { EmbeddableImage } from '../pdf/pdf.images';

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const HEAD_FILL: Rgb = { r: 0.96, g: 0.97, b: 0.96 };
const BOX_FILL: Rgb = { r: 0.985, g: 0.985, b: 0.98 };

const MARGIN = 48;
const CONTENT_WIDTH = 612 - MARGIN * 2;
const BOTTOM = 736;
const TOP = 108;

// ---------------------------------------------------------------------------
// Formatting — deterministic on purpose (no Intl, no locale, no local timezone)
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Sep 12, 2026`. */
export function dateOf(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** `Sep 12, 2026 14:30`. */
export function dateTimeOf(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${dateOf(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `CA$1,234.56` — grouped, two decimals, currency named rather than guessed. */
export function moneyOf(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  const symbol = currency === 'USD' ? 'US$' : currency === 'CAD' ? 'CA$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${groupThousands(whole as string)}.${fraction}`;
}

/** What a field prints as when the record simply does not hold it. */
export const NOT_SPECIFIED = 'Not specified';

function approx(metric: number, factor: number, unit: string): string {
  return `${groupThousands(String(Math.round(metric * factor)))} ${unit}`;
}

/**
 * `MC548616` and `MC 548616` must both print as "MC 548616". Carriers store
 * their number either way, and "MC MC548616" on a rate confirmation reads like
 * a data error to the broker holding it.
 */
export function authorityLabel(kind: 'MC' | 'USDOT', raw: string): string {
  const stripped = raw.trim().replace(new RegExp(`^${kind}\\s*`, 'i'), '').trim();
  return stripped ? `${kind} ${stripped}` : kind;
}

export function weightOf(kg: string | number | null | undefined): string {
  const value = kg === null || kg === undefined || kg === '' ? Number.NaN : Number(kg);
  if (!Number.isFinite(value) || value <= 0) return NOT_SPECIFIED;
  return `${groupThousands(String(Math.round(value)))} kg (${approx(value, 2.20462, 'lb')})`;
}

export function distanceOf(km: string | number | null | undefined): string {
  const value = km === null || km === undefined || km === '' ? Number.NaN : Number(km);
  if (!Number.isFinite(value) || value <= 0) return NOT_SPECIFIED;
  return `${groupThousands(String(Math.round(value)))} km (${approx(value, 0.621371, 'mi')})`;
}

/** `RC-3F9A21` — a short, stable, human-quotable reference from a UUID. */
export function referenceOf(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface Party {
  name: string;
  mc?: string | null;
  usdot?: string | null;
  jurisdiction?: string | null;
  /** Extra line, e.g. "Authority checked against FMCSA records". */
  note?: string | null;
}

export interface RouteStop {
  /** PICKUP | DELIVERY | STOP */
  kind: string;
  label: string;
  scheduled?: string | null;
  notes?: string | null;
}

export interface SignatureBlock {
  role: string;
  signerName: string;
  signedAt: Date | string;
  /** Parsed image, or null when it could not be embedded. */
  asset: EmbeddableImage | null;
}

export interface AttachmentBlock {
  kind: string;
  fileName: string;
  uploadedAt: Date | string;
  asset: EmbeddableImage | null;
  /** Why an attachment is listed but not shown. */
  reason?: string | null;
}

export interface RateConfirmationInput {
  reference: string;
  issuedAt: Date;
  carrier: Party;
  broker: Party | null;
  stops: RouteStop[];
  details: Array<[string, string]>;
  rateRows: Array<{ label: string; amount: string }>;
  totalLabel: string;
  total: string;
  detention: string | null;
  terms: string[];
  carrierSignature: SignatureBlock | null;
  brokerSignature: SignatureBlock | null;
}

export interface InvoiceInput {
  invoiceNumber: string;
  issuedAt: Date;
  issuer: Party;
  billTo: Party;
  currency: string;
  lines: Array<{ description: string; amount: string }>;
  subtotal: string;
  taxLines: Array<{ label: string; amount: string }>;
  total: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  status: string;
  paidNote: string | null;
  loadRef: string | null;
  notes: string[];
}

export interface PacketInput {
  reference: string;
  generatedAt: Date;
  carrier: Party;
  broker: Party | null;
  stops: RouteStop[];
  details: Array<[string, string]>;
  rateRows: Array<{ label: string; amount: string }>;
  totalLabel: string;
  total: string;
  signatures: SignatureBlock[];
  attachments: AttachmentBlock[];
  terms: string[];
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

class Layout {
  y = TOP;

  constructor(private readonly doc: PdfDocument) {}

  /** Start a new page if the block would not fit on this one. */
  need(height: number): void {
    if (this.y + height > BOTTOM) {
      this.doc.addPage();
      this.y = TOP;
    }
  }

  space(height: number): void {
    this.y += height;
  }
}

function drawHeader(
  doc: PdfDocument,
  opts: { left: Party; title: string; subtitle: string; issuedAt: Date },
): void {
  doc.text(opts.left.name, MARGIN, 62, { size: 14, font: 'bold' });
  doc.text(opts.title, 612 - MARGIN, 60, { size: 13, font: 'bold', align: 'right', color: ACCENT });
  doc.text(opts.subtitle, 612 - MARGIN, 74, { size: 9, align: 'right', color: GREY });

  const idParts = [
    opts.left.mc ? authorityLabel('MC', opts.left.mc) : null,
    opts.left.usdot ? authorityLabel('USDOT', opts.left.usdot) : null,
    opts.left.jurisdiction ? `Base ${opts.left.jurisdiction}` : null,
  ].filter(Boolean);
  doc.text(idParts.join('   ·   ') || 'Issued by this carrier', MARGIN, 78, { size: 8.5, color: GREY });
  doc.line(MARGIN, 90, 612 - MARGIN, 90, ACCENT, 1.2);
  doc.text(`Issued ${dateTimeOf(opts.issuedAt)}`, MARGIN, 100, { size: 8, color: GREY });
}

function drawFooter(doc: PdfDocument, reference: string, generatedAt: Date): void {
  doc.stampPages((page, total) => {
    const y = 756;
    doc.line(MARGIN, y - 8, 612 - MARGIN, y - 8, RULE_GREY, 0.6);
    doc.text(
      `${reference}   ·   Generated by Loadwave ${dateOf(generatedAt)}`,
      MARGIN,
      y,
      { size: 7.5, color: GREY },
    );
    doc.text(`Page ${page} of ${total}`, 612 - MARGIN, y, { size: 7.5, color: GREY, align: 'right' });
  });
}

function sectionHeading(doc: PdfDocument, layout: Layout, text: string, keepWith = 0): void {
  // `keepWith` keeps a heading attached to the block it introduces, so a
  // contract never leaves "TERMS & NOTES" stranded at the foot of a page.
  layout.need(34 + keepWith);
  doc.text(text.toUpperCase(), MARGIN, layout.y, { size: 8.5, font: 'bold', color: ACCENT });
  layout.y += 6;
  doc.line(MARGIN, layout.y, 612 - MARGIN, layout.y, RULE_GREY, 0.6);
  layout.y += 14;
}

/** The authority detail lines a party box prints under its name. */
function partyLines(party: Party | null): string[] {
  if (!party) return [];
  const lines: string[] = [];
  if (party.mc) lines.push(authorityLabel('MC', party.mc));
  if (party.usdot) lines.push(authorityLabel('USDOT', party.usdot));
  if (party.jurisdiction) lines.push(`Base jurisdiction ${party.jurisdiction}`);
  if (party.note) lines.push(party.note);
  return lines;
}

/** Height of a party box with no authority lines under the name. */
export const PARTY_BOX_MIN_HEIGHT = 40;

/**
 * Both boxes in a pair are drawn at the same height — the taller one wins.
 * A carrier with full authority next to an empty "not assigned" broker box
 * otherwise leaves a ragged edge down the middle of a document a broker signs.
 */
export function partyBoxHeight(party: Party | null): number {
  return PARTY_BOX_MIN_HEIGHT + partyLines(party).length * 11;
}

/** A bordered two-column party box. */
function partyBox(
  doc: PdfDocument,
  layout: Layout,
  x: number,
  width: number,
  heading: string,
  party: Party | null,
  height: number,
): void {
  const lines = partyLines(party);
  layout.need(height + 10);
  doc.rect(x, layout.y, width, height, { fill: BOX_FILL, stroke: RULE_GREY });
  doc.text(heading.toUpperCase(), x + 10, layout.y + 15, { size: 7.5, font: 'bold', color: GREY });
  doc.text(party?.name ?? 'Not assigned', x + 10, layout.y + 30, { size: 10, font: 'bold' });
  let lineY = layout.y + 43;
  for (const line of lines) {
    doc.text(line, x + 10, lineY, { size: 8, color: GREY });
    lineY += 11;
  }
}

/**
 * Draw the two party boxes side by side at a matched height and advance past
 * them. Returns nothing; the layout cursor ends up below the pair.
 */
function partyPair(
  doc: PdfDocument,
  layout: Layout,
  left: { heading: string; party: Party | null },
  right: { heading: string; party: Party | null },
): void {
  const half = (CONTENT_WIDTH - 16) / 2;
  const height = Math.max(partyBoxHeight(left.party), partyBoxHeight(right.party));
  partyBox(doc, layout, MARGIN, half, left.heading, left.party, height);
  partyBox(doc, layout, MARGIN + half + 16, half, right.heading, right.party, height);
  layout.y += height + 20;
}

/** Label/value grid, two per row. */
function detailGrid(
  doc: PdfDocument,
  layout: Layout,
  details: Array<[string, string]>,
): void {
  const columnWidth = CONTENT_WIDTH / 2;
  for (let i = 0; i < details.length; i += 2) {
    layout.need(30);
    const row = details.slice(i, i + 2);
    row.forEach(([label, value], index) => {
      const x = MARGIN + index * columnWidth;
      doc.text(label.toUpperCase(), x, layout.y, { size: 7.5, color: GREY });
      const lines = fitLines(doc, value, columnWidth - 16, 9.5);
      let lineY = layout.y + 13;
      for (const line of lines) {
        doc.text(line, x, lineY, { size: 9.5 });
        lineY += 11.5;
      }
    });
    layout.y += 30;
  }
}

/** Trim a value to the lines that fit, so a long field cannot bleed into the next. */
function fitLines(doc: PdfDocument, value: string, width: number, size: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (doc.measure(candidate, size) <= width) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === 1) break;
    }
  }
  if (current && lines.length < 2) lines.push(current);
  return lines.length ? lines : ['—'];
}

function routeTable(doc: PdfDocument, layout: Layout, stops: RouteStop[]): void {
  for (const stop of stops) {
    layout.need(26);
    const badge = stop.kind.toUpperCase();
    const badgeWidth = doc.measure(badge, 7.5, 'bold') + 12;
    doc.rect(MARGIN, layout.y - 8, badgeWidth, 12, { fill: HEAD_FILL, stroke: RULE_GREY, strokeWidth: 0.5 });
    doc.text(badge, MARGIN + 6, layout.y, { size: 7.5, font: 'bold', color: ACCENT });
    doc.text(stop.label, MARGIN + badgeWidth + 10, layout.y, { size: 9.5 });
    doc.text(stop.scheduled ?? 'Flexible', 612 - MARGIN, layout.y, { size: 9, color: GREY, align: 'right' });
    layout.y += 14;
    if (stop.notes) {
      doc.text(stop.notes, MARGIN + badgeWidth + 10, layout.y, { size: 8, color: GREY });
      layout.y += 11;
    }
    layout.y += 6;
  }
}

function amountTable(
  doc: PdfDocument,
  layout: Layout,
  rows: Array<{ label: string; amount: string }>,
  total: { label: string; amount: string },
  emphasis = true,
): void {
  const rightEdge = 612 - MARGIN;
  for (const row of rows) {
    layout.need(16);
    doc.text(row.label, MARGIN, layout.y, { size: 9.5 });
    doc.text(row.amount, rightEdge, layout.y, { size: 9.5, align: 'right' });
    layout.y += 15;
  }
  layout.need(26);
  doc.line(MARGIN, layout.y - 4, rightEdge, layout.y - 4, RULE_GREY, 0.6);
  layout.y += 12;
  doc.text(total.label, MARGIN, layout.y, { size: 10.5, font: 'bold' });
  doc.text(total.amount, rightEdge, layout.y, {
    size: 12,
    font: 'bold',
    align: 'right',
    color: emphasis ? ACCENT : BLACK,
  });
  layout.y += 22;
}

/** Height the whole term list will take, so it can be kept on one page. */
function measureTerms(terms: string[]): number {
  let height = 0;
  for (const term of terms) {
    const lines = wrapText(term, CONTENT_WIDTH - 14, 8.5).length;
    height += lines * 11 + 3;
  }
  return height;
}

function termList(doc: PdfDocument, layout: Layout, terms: string[]): void {
  for (const [index, term] of terms.entries()) {
    layout.need(24);
    doc.text(`${index + 1}.`, MARGIN, layout.y, { size: 8.5, color: GREY });
    layout.y = doc.paragraph(term, MARGIN + 14, layout.y, CONTENT_WIDTH - 14, {
      size: 8.5,
      leading: 11,
    });
    layout.y += 3;
  }
}

/** A signature box: the drawn signature if we have one, otherwise a blank rule. */
function signatureBox(
  doc: PdfDocument,
  layout: Layout,
  x: number,
  width: number,
  role: string,
  signature: SignatureBlock | null,
): void {
  const height = 96;
  layout.need(height + 10);
  doc.rect(x, layout.y, width, height, { fill: BOX_FILL, stroke: RULE_GREY });
  doc.text(role.toUpperCase(), x + 10, layout.y + 15, { size: 7.5, font: 'bold', color: GREY });

  const sigTop = layout.y + 24;
  const sigWidth = width - 20;
  const sigHeight = 40;
  if (signature?.asset) {
    const name = doc.addImage(signature.asset);
    doc.image(name, x + 10, sigTop, sigWidth, sigHeight);
  } else {
    doc.text('Not signed', x + 10, sigTop + 22, { size: 9, color: GREY });
  }

  const lineY = layout.y + 70;
  doc.line(x + 10, lineY, x + width - 10, lineY, BLACK, 0.7);
  doc.text(signature?.signerName ?? 'Signature', x + 10, lineY + 11, { size: 8.5 });
  doc.text(
    signature ? `Signed ${dateTimeOf(signature.signedAt)}` : 'Date',
    x + width - 10,
    lineY + 11,
    { size: 8, color: GREY, align: 'right' },
  );
}

function noteBox(doc: PdfDocument, layout: Layout, text: string): void {
  // Measure first, then draw: the box has to be sized before its outline is
  // painted, or the fill covers the text.
  const lines = wrapText(text, CONTENT_WIDTH - 20, 8.5);
  const height = 16 + lines.length * 11;
  layout.need(height + 10);
  doc.rect(MARGIN, layout.y, CONTENT_WIDTH, height, { fill: HEAD_FILL, stroke: RULE_GREY });
  let lineY = layout.y + 16;
  for (const line of lines) {
    doc.text(line, MARGIN + 10, lineY, { size: 8.5 });
    lineY += 11;
  }
  layout.y += height + 10;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function buildRateConfirmation(input: RateConfirmationInput): Buffer {
  const doc = new PdfDocument({ title: `Rate confirmation ${input.reference}`, createdAt: input.issuedAt });
  const layout = new Layout(doc);

  drawHeader(doc, {
    left: input.carrier,
    title: 'RATE CONFIRMATION',
    subtitle: input.reference,
    issuedAt: input.issuedAt,
  });

  partyPair(
    doc,
    layout,
    { heading: 'Carrier', party: input.carrier },
    { heading: 'Broker / customer', party: input.broker },
  );

  sectionHeading(doc, layout, 'Load');
  detailGrid(doc, layout, input.details);

  sectionHeading(doc, layout, 'Route');
  routeTable(doc, layout, input.stops);

  sectionHeading(doc, layout, 'Rate');
  amountTable(doc, layout, input.rateRows, { label: input.totalLabel, amount: input.total });
  if (input.detention) {
    doc.text(`Detention: ${input.detention}`, MARGIN, layout.y, { size: 8.5, color: GREY });
    layout.y += 16;
  }

  sectionHeading(doc, layout, 'Terms & notes', measureTerms(input.terms));
  termList(doc, layout, input.terms);

  sectionHeading(doc, layout, 'Signatures', 116);
  const sigWidth = (CONTENT_WIDTH - 16) / 2;
  const sigStart = layout.y;
  signatureBox(doc, layout, MARGIN, sigWidth, 'Carrier acceptance', input.carrierSignature);
  signatureBox(doc, layout, MARGIN + sigWidth + 16, sigWidth, 'Broker acceptance', input.brokerSignature);
  layout.y = sigStart + 106;

  drawFooter(doc, input.reference, input.issuedAt);
  return doc.build();
}

export function buildInvoice(input: InvoiceInput): Buffer {
  const doc = new PdfDocument({ title: `Invoice ${input.invoiceNumber}`, createdAt: input.issuedAt });
  const layout = new Layout(doc);

  drawHeader(doc, {
    left: input.issuer,
    title: 'INVOICE',
    subtitle: input.invoiceNumber,
    issuedAt: input.issuedAt,
  });

  partyPair(
    doc,
    layout,
    { heading: 'From', party: input.issuer },
    { heading: 'Bill to', party: input.billTo },
  );

  sectionHeading(doc, layout, 'Invoice details');
  detailGrid(doc, layout, [
    ['Invoice number', input.invoiceNumber],
    ['Status', input.status],
    ['Issue date', input.issueDate],
    ['Due date', input.dueDate],
    ['Payment terms', input.paymentTerms],
    ['Currency', input.currency],
    ...(input.loadRef ? ([['Load reference', input.loadRef]] as Array<[string, string]>) : []),
  ]);

  sectionHeading(doc, layout, 'Charges');
  const rightEdge = 612 - MARGIN;
  // Header row for the table, then one line per charge.
  layout.need(22);
  doc.rect(MARGIN, layout.y - 11, CONTENT_WIDTH, 18, { fill: HEAD_FILL });
  doc.text('Description', MARGIN + 6, layout.y, { size: 8, font: 'bold', color: GREY });
  doc.text('Amount', rightEdge - 6, layout.y, { size: 8, font: 'bold', color: GREY, align: 'right' });
  layout.y += 16;

  for (const line of input.lines) {
    layout.need(28);
    const labelLines = doc.paragraph(line.description, MARGIN + 6, layout.y, CONTENT_WIDTH - 140, {
      size: 9.5,
      leading: 11.5,
    });
    doc.text(line.amount, rightEdge - 6, layout.y, { size: 9.5, align: 'right' });
    layout.y = Math.max(labelLines, layout.y + 14) + 6;
  }

  layout.need(20);
  doc.line(MARGIN, layout.y - 6, rightEdge, layout.y - 6, RULE_GREY, 0.6);
  layout.y += 10;

  for (const tax of input.taxLines) {
    layout.need(16);
    doc.text(tax.label, MARGIN + 6, layout.y, { size: 9, color: GREY });
    doc.text(tax.amount, rightEdge - 6, layout.y, { size: 9, align: 'right' });
    layout.y += 14;
  }

  layout.need(30);
  doc.line(MARGIN + CONTENT_WIDTH / 2, layout.y - 4, rightEdge, layout.y - 4, BLACK, 0.7);
  layout.y += 12;
  doc.text('Subtotal', MARGIN + 6, layout.y, { size: 9.5 });
  doc.text(input.subtotal, rightEdge - 6, layout.y, { size: 9.5, align: 'right' });
  layout.y += 18;
  doc.text('Total due', MARGIN + 6, layout.y, { size: 11.5, font: 'bold' });
  doc.text(input.total, rightEdge - 6, layout.y, { size: 13, font: 'bold', align: 'right', color: ACCENT });
  layout.y += 26;

  if (input.paidNote) noteBox(doc, layout, input.paidNote);
  if (input.notes.length) {
    sectionHeading(doc, layout, 'Payment & notes');
    termList(doc, layout, input.notes);
  }

  drawFooter(doc, input.invoiceNumber, input.issuedAt);
  return doc.build();
}

export interface SettlementStatementInput {
  statementNumber: string;
  issuedAt: Date;
  carrier: Party;
  driver: Party;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  /** "$0.58 / mi" or "Owner-operator — keeps the revenue". */
  payLabel: string;
  lines: Array<{
    deliveredAt: string;
    reference: string;
    lane: string;
    /** How the pay was worked out, printed under the lane. */
    basis: string;
    detentionBasis: string | null;
    amount: string;
  }>;
  totals: Array<{ label: string; amount: string }>;
  totalLabel: string;
  total: string;
  notes: string[];
  /** Queries the driver has raised that the office has not answered yet. */
  openQueries: string[];
  signoff: string;
  driverSignature: SignatureBlock | null;
  carrierSignature: SignatureBlock | null;
}

/** One pay line: when and what, the working beside it, the money on the right. */
function payLineTable(doc: PdfDocument, layout: Layout, lines: SettlementStatementInput['lines']): void {
  const rightEdge = 612 - MARGIN;
  if (lines.length === 0) {
    layout.need(24);
    doc.text('No loads were delivered in this period.', MARGIN, layout.y, { size: 9.5, color: GREY });
    layout.y += 22;
    return;
  }

  layout.need(22);
  doc.rect(MARGIN, layout.y - 11, CONTENT_WIDTH, 18, { fill: HEAD_FILL });
  doc.text('Load', MARGIN + 6, layout.y, { size: 8, font: 'bold', color: GREY });
  doc.text('Pay basis', MARGIN + 210, layout.y, { size: 8, font: 'bold', color: GREY });
  doc.text('Amount', rightEdge - 6, layout.y, { size: 8, font: 'bold', color: GREY, align: 'right' });
  layout.y += 16;

  for (const line of lines) {
    layout.need(34);
    const top = layout.y;
    doc.text(`${dateOf(line.deliveredAt)} · ${line.reference}`, MARGIN + 6, top, { size: 9, font: 'bold' });
    doc.text(line.lane, MARGIN + 6, top + 12, { size: 8.5, color: GREY });
    // The working, so the driver can check the arithmetic instead of the total.
    const basis = doc.paragraph(line.basis, MARGIN + 210, top, CONTENT_WIDTH - 290, { size: 8.5, leading: 11 });
    const detention = line.detentionBasis
      ? doc.paragraph(line.detentionBasis, MARGIN + 210, basis, CONTENT_WIDTH - 290, { size: 8, leading: 10.5, color: GREY })
      : basis;
    doc.text(line.amount, rightEdge - 6, top, { size: 9.5, align: 'right' });
    layout.y = Math.max(detention, top + 22) + 8;
    // Drawn after the row has advanced, so the rule never lands alone on the
    // next page ahead of its own row.
    doc.line(MARGIN, layout.y - 5, rightEdge, layout.y - 5, RULE_GREY, 0.4);
  }
  layout.space(4);
}

/**
 * A driver's settlement statement for one pay period.
 *
 * This is the sheet payroll files and the sheet a driver is handed. It shows the
 * arithmetic behind every line — the same basis string the app shows — because a
 * statement a driver cannot check is a statement they have to take on faith, and
 * the first thing anyone does with a pay slip is try to reproduce it.
 *
 * Open pay queries are printed above the signature rather than hidden: a sheet
 * that asserts agreement while a question is unanswered is the kind of document
 * that ends up in a labour complaint.
 */
export function buildSettlementStatement(input: SettlementStatementInput): Buffer {
  const doc = new PdfDocument({
    title: `Settlement statement ${input.statementNumber}`,
    createdAt: input.issuedAt,
  });
  const layout = new Layout(doc);

  drawHeader(doc, {
    left: input.carrier,
    title: 'SETTLEMENT STATEMENT',
    subtitle: input.statementNumber,
    issuedAt: input.issuedAt,
  });

  partyPair(
    doc,
    layout,
    { heading: 'Carrier', party: input.carrier },
    { heading: 'Driver', party: input.driver },
  );

  sectionHeading(doc, layout, 'Pay period');
  detailGrid(doc, layout, [
    ['Period', input.periodLabel],
    ['From', input.periodFrom],
    ['To', input.periodTo],
    ['Pay model', input.payLabel],
    ['Statement', input.statementNumber],
    ['Issued', dateOf(input.issuedAt)],
  ]);

  sectionHeading(doc, layout, 'Pay by load', 60);
  payLineTable(doc, layout, input.lines);

  amountTable(doc, layout, input.totals, { label: input.totalLabel, amount: input.total });

  if (input.notes.length) {
    sectionHeading(doc, layout, 'Notes on this period', measureTerms(input.notes));
    termList(doc, layout, input.notes);
  }

  if (input.openQueries.length) {
    sectionHeading(doc, layout, 'Open pay queries', 40);
    noteBox(
      doc,
      layout,
      `Unanswered at the time this statement was issued: ${input.openQueries.join(' · ')}. The figures above are not final until these are settled.`,
    );
  }

  sectionHeading(doc, layout, 'Driver acknowledgement', 130);
  // Measured rather than flowed, so the signature boxes below never start on
  // top of the paragraph that introduces them.
  const signoffLines = wrapText(input.signoff, CONTENT_WIDTH, 8.5);
  signoffLines.forEach((text, index) => {
    doc.text(text, MARGIN, layout.y + index * 11, { size: 8.5 });
  });
  layout.y += signoffLines.length * 11 + 10;

  layout.need(106);
  const sigWidth = (CONTENT_WIDTH - 16) / 2;
  const sigTop = layout.y;
  signatureBox(doc, layout, MARGIN, sigWidth, 'Driver', input.driverSignature);
  signatureBox(doc, layout, MARGIN + sigWidth + 16, sigWidth, 'Carrier', input.carrierSignature);
  layout.y = sigTop + 106;

  const terms = [
    'Loads and pay are derived from the delivered loads on file; correcting a delivery date or a rate re-prices the period.',
    'Detention is paid at the rate recorded on the load, for closed timer entries only.',
    'Questions about a line must be raised in the app so the answer is written down with the load it refers to.',
  ];
  sectionHeading(doc, layout, 'How this statement was worked out', measureTerms(terms));
  termList(doc, layout, terms);

  drawFooter(doc, input.statementNumber, input.issuedAt);
  return doc.build();
}

export function buildDeliveryPacket(input: PacketInput): Buffer {
  const doc = new PdfDocument({
    title: `Delivery packet ${input.reference}`,
    createdAt: input.generatedAt,
  });
  const layout = new Layout(doc);

  drawHeader(doc, {
    left: input.carrier,
    title: 'DELIVERY PACKET',
    subtitle: input.reference,
    issuedAt: input.generatedAt,
  });

  partyPair(
    doc,
    layout,
    { heading: 'Carrier', party: input.carrier },
    { heading: 'Broker / customer', party: input.broker },
  );

  // What is inside, before the detail — so a factor can see the packet is
  // complete at a glance.
  sectionHeading(doc, layout, 'Contents');
  const contents: string[] = [
    `Load summary (${input.reference})`,
    input.signatures.length
      ? `Proof of delivery — ${input.signatures.length} signature${
          input.signatures.length === 1 ? '' : 's'
        } captured`
      : 'Proof of delivery — not signed',
    input.attachments.length === 0
      ? 'No attachments'
      : `${input.attachments.length} attachment${input.attachments.length === 1 ? '' : 's'}`,
  ];
  for (const item of contents) {
    layout.need(14);
    doc.text(`· ${item}`, MARGIN + 4, layout.y, { size: 9 });
    layout.y += 13;
  }
  layout.space(8);

  sectionHeading(doc, layout, 'Load summary');
  detailGrid(doc, layout, input.details);

  sectionHeading(doc, layout, 'Route');
  routeTable(doc, layout, input.stops);

  sectionHeading(doc, layout, 'Agreed rate');
  amountTable(doc, layout, input.rateRows, { label: input.totalLabel, amount: input.total }, false);

  sectionHeading(doc, layout, 'Proof of delivery', 140);
  if (input.signatures.length === 0) {
    noteBox(
      doc,
      layout,
      'No signature was captured on this load. Attach the receiver-signed bill of lading below, or capture a signature from the trip screen.',
    );
  } else {
    // Two signatures to a row, the way a paper delivery receipt is laid out.
    // Stacking them down the left half leaves the right half blank and makes a
    // complete packet look unfinished.
    const boxWidth = (CONTENT_WIDTH - 16) / 2;
    for (let i = 0; i < input.signatures.length; i += 2) {
      const row = input.signatures.slice(i, i + 2);
      layout.need(106);
      const rowTop = layout.y;
      row.forEach((signature, index) => {
        signatureBox(doc, layout, MARGIN + index * (boxWidth + 16), boxWidth, signature.role, signature);
      });
      layout.y = rowTop + 106;
    }
  }

  sectionHeading(doc, layout, 'Terms & notes', measureTerms(input.terms));
  termList(doc, layout, input.terms);

  // One page per attachment photo, so a signed BOL is legible rather than a
  // thumbnail, and anything that could not be embedded is named rather than
  // silently dropped.
  if (input.attachments.length) {
    doc.addPage();
    const attachmentLayout = new Layout(doc);
    sectionHeading(doc, attachmentLayout, 'Attachments');
    for (const attachment of input.attachments) {
      attachmentLayout.need(30);
      doc.text(`${attachment.kind} · ${attachment.fileName}`, MARGIN, attachmentLayout.y, { size: 9.5, font: 'bold' });
      doc.text(dateTimeOf(attachment.uploadedAt), 612 - MARGIN, attachmentLayout.y, {
        size: 8.5,
        color: GREY,
        align: 'right',
      });
      attachmentLayout.y += 16;

      if (!attachment.asset) {
        doc.text(
          `Included separately — ${attachment.reason ?? 'format not embeddable in a PDF'}. Download the original from the load's documents.`,
          MARGIN,
          attachmentLayout.y,
          { size: 8.5, color: GREY },
        );
        attachmentLayout.y += 22;
        continue;
      }

      const name = doc.addImage(attachment.asset);
      const maxHeight = BOTTOM - attachmentLayout.y - 10;
      if (maxHeight < 120) {
        doc.addPage();
        attachmentLayout.y = TOP;
      }
      const drawn = doc.image(name, MARGIN, attachmentLayout.y, CONTENT_WIDTH, BOTTOM - attachmentLayout.y - 10);
      attachmentLayout.y += drawn.height + 18;
    }
  }

  drawFooter(doc, input.reference, input.generatedAt);
  return doc.build();
}
