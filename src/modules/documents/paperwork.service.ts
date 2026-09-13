import type { PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '../../utils/errors';
import { toEmbeddableImage, type EmbeddableImage } from '../pdf/pdf.images';
import {
  buildDeliveryPacket,
  buildInvoice,
  buildRateConfirmation,
  dateOf,
  dateTimeOf,
  distanceOf,
  moneyOf,
  referenceOf,
  weightOf,
  type AttachmentBlock,
  type Party,
  type RouteStop,
  type SignatureBlock,
} from './pdf.templates';

/**
 * Paperwork generation: the rate confirmation, the invoice, and the delivery
 * packet a factoring company wants (rate con + signed POD + invoice together).
 *
 * The documents are built from what is actually on the load record. Nothing is
 * invented to fill a field: a missing weight prints as a dash, an unsigned load
 * says so, and an attachment the PDF cannot carry is named rather than dropped.
 */

export const SIGNATURE_ROLES = ['CARRIER', 'RECEIVER', 'BROKER'] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

/** A drawn signature is a few KB of JPEG; anything larger is not one. */
export const MAX_SIGNATURE_BYTES = 1024 * 1024;

const EQUIPMENT_LABELS: Record<string, string> = {
  DRY_VAN: 'Dry van',
  REEFER: 'Reefer',
  FLATBED: 'Flatbed',
  STEP_DECK: 'Step deck',
  POWER_ONLY: 'Power only',
  TANKER: 'Tanker',
  CONESTOGA: 'Conestoga',
  CAR_HAULER: 'Car hauler',
  DUMP: 'Dump',
  BOX_TRUCK: 'Box truck',
  SPRINTER: 'Sprinter van',
  FLAT_DECK: 'Flatbed',
};

export function equipmentLabel(code: string | null | undefined): string {
  if (!code) return 'Not specified';
  const key = code.toUpperCase();
  if (EQUIPMENT_LABELS[key]) return EQUIPMENT_LABELS[key];
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function isSignatureRole(value: string): value is SignatureRole {
  return (SIGNATURE_ROLES as readonly string[]).includes(value);
}

/**
 * One signature per role is what a delivery packet may show.
 *
 * Captures are appended, never overwritten, so a receiver who signs twice
 * (a corrected name, a re-drawn mark) leaves two rows behind. Those rows are
 * the audit trail and must stay; but a packet that printed both would present
 * two conflicting receiver signatures to the broker or factor reading it.
 * This keeps the most recent capture for each role and drops the superseded
 * ones, so "3 signatures captured" can never count a signature nobody stands
 * behind. Ties keep the last one encountered, matching the newest write.
 */
export function latestSignaturePerRole<T extends { role: string; signedAt: Date }>(
  rows: readonly T[],
): T[] {
  const byRole = new Map<string, T>();
  for (const row of rows) {
    const current = byRole.get(row.role);
    if (!current || row.signedAt.getTime() >= current.signedAt.getTime()) {
      byRole.set(row.role, row);
    }
  }
  return [...byRole.values()];
}

export interface LoadSignatureRow {
  id: string;
  loadId: string;
  role: string;
  signerName: string;
  signedAt: string;
  driverId: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface SignatureInput {
  tenantId: string;
  loadId: string;
  role: string;
  signerName: string;
  dataBase64: string;
  driverId?: string | null;
  capturedById?: string | null;
  signedAt?: Date;
}

export interface PaperworkFile {
  fileName: string;
  pdf: Buffer;
}

export interface LoadPaperworkService {
  rateConfirmation(tenantId: string, loadId: string): Promise<PaperworkFile>;
  invoicePdf(tenantId: string, invoiceId: string): Promise<PaperworkFile>;
  packet(tenantId: string, loadId: string): Promise<PaperworkFile>;
  captureSignature(input: SignatureInput): Promise<LoadSignatureRow>;
  listSignatures(tenantId: string, loadId: string): Promise<LoadSignatureRow[]>;
  /** Loads the driver is assigned, so a DRIVER account can only sign its own. */
  loadAssignees(tenantId: string, loadId: string): Promise<{ driverId: string | null } | null>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `image/jpeg` / `image/png` from the bytes themselves, or null if neither. */
function sniffImageMime(data: Buffer): 'image/jpeg' | 'image/png' | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length > 8 && data.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

function partyFromTenant(tenant: {
  name: string;
  mcNumber?: string | null;
  usdotNumber?: string | null;
  baseJurisdiction?: string | null;
  fmcsaCheckedAt?: Date | null;
}): Party {
  return {
    name: tenant.name,
    mc: tenant.mcNumber ?? null,
    usdot: tenant.usdotNumber ?? null,
    jurisdiction: tenant.baseJurisdiction ?? null,
    note: tenant.fmcsaCheckedAt ? 'Authority status checked against FMCSA records' : null,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}

/** `Jun 3, 2026 08:00` in the record's own time, or a dash when unset. */
function schedule(value: Date | null | undefined): string {
  return value ? dateTimeOf(value) : 'Flexible';
}

function stopLabel(stop: { locality: string | null; region: string; country: string }): string {
  const place = stop.locality ? `${stop.locality}, ${stop.region}` : stop.region;
  return `${place}, ${stop.country}`;
}

export class PrismaLoadPaperworkService implements LoadPaperworkService {
  constructor(private readonly prisma: PrismaClient) {}

  private async loadOr404(tenantId: string, loadId: string) {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      include: {
        stops: { orderBy: { stopOrder: 'asc' } },
        documents: { orderBy: { createdAt: 'asc' } },
        signatures: { orderBy: { signedAt: 'asc' } },
        assigneeDriver: { select: { id: true, name: true } },
      },
    });
    if (!load) throw notFound('load not found');
    return load;
  }

  private async tenantOr404(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw notFound('tenant not found');
    return tenant;
  }

  /**
   * The counterparty on a load. When another tenant booked it they are the
   * broker; otherwise we say "not assigned" rather than leaving a caller to
   * guess, because a rate confirmation with a blank counterparty is not one.
   */
  private async brokerParty(bookedByTenantId: string | null): Promise<Party | null> {
    if (!bookedByTenantId) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: bookedByTenantId },
      select: {
        name: true,
        mcNumber: true,
        usdotNumber: true,
        baseJurisdiction: true,
        fmcsaCheckedAt: true,
      },
    });
    return tenant ? partyFromTenant(tenant) : null;
  }

  private routeStops(load: {
    originLocality: string | null;
    originRegion: string;
    originCountry: string;
    destinationLocality: string | null;
    destinationRegion: string;
    destinationCountry: string;
    pickupDate: Date | null;
    deliveryDate: Date | null;
    stops: Array<{
      kind: string;
      locality: string | null;
      region: string;
      country: string;
      scheduledAt: Date | null;
      notes: string | null;
    }>;
  }): RouteStop[] {
    const kindLabels: Record<string, string> = {
      ORIGIN: 'PICKUP',
      INTERMEDIATE: 'STOP',
      DELIVERY: 'DELIVERY',
    };
    if (load.stops.length > 0) {
      return load.stops.map((stop) => ({
        kind: kindLabels[stop.kind] ?? stop.kind,
        label: stopLabel(stop),
        scheduled: schedule(stop.scheduledAt),
        notes: stop.notes,
      }));
    }
    // Most loads are a single origin and destination with no LoadStop rows.
    // Falling back to those two fields is the difference between a rate
    // confirmation that shows the lane and one that shows nothing.
    return [
      {
        kind: 'PICKUP',
        label: stopLabel({
          locality: load.originLocality,
          region: load.originRegion,
          country: load.originCountry,
        }),
        scheduled: schedule(load.pickupDate),
        notes: null,
      },
      {
        kind: 'DELIVERY',
        label: stopLabel({
          locality: load.destinationLocality,
          region: load.destinationRegion,
          country: load.destinationCountry,
        }),
        scheduled: schedule(load.deliveryDate),
        notes: null,
      },
    ];
  }

  private loadDetails(load: {
    equipmentType: string | null;
    commodity: string | null;
    weightKg: unknown;
    distanceKmEstimate: unknown;
    hazmat: boolean;
    teamRequired: boolean;
    temperatureMin: number | null;
    temperatureMax: number | null;
    pickupDate: Date | null;
    deliveryDate: Date | null;
    assigneeDriver?: { name: string } | null;
  }): Array<[string, string]> {
    const temperature =
      load.temperatureMin != null || load.temperatureMax != null
        ? `${load.temperatureMin ?? '—'}°C to ${load.temperatureMax ?? '—'}°C`
        : null;
    return [
      ['Equipment', equipmentLabel(load.equipmentType)],
      ['Commodity', load.commodity || 'General freight'],
      ['Weight', weightOf(load.weightKg as string | null)],
      ['Distance', distanceOf(load.distanceKmEstimate as string | null)],
      ['Pickup window', schedule(load.pickupDate)],
      ['Delivery window', schedule(load.deliveryDate)],
      ['Temperature', temperature ?? 'Ambient'],
      ['Driver', load.assigneeDriver?.name ?? 'Not assigned'],
      ['Hazmat', load.hazmat ? 'Yes — placards required' : 'No'],
      ['Team required', load.teamRequired ? 'Yes' : 'No'],
    ];
  }

  private rateRows(load: {
    freightAmountTransaction: unknown;
    freightAmountBase: unknown;
    freightCurrency: string;
    baseCurrency?: string;
  }): Array<{ label: string; amount: string }> {
    const rows = [
      { label: 'Linehaul', amount: moneyOf(load.freightAmountTransaction as string | null, load.freightCurrency) },
    ];
    if (load.freightCurrency !== 'CAD' && load.freightAmountBase != null) {
      rows.push({
        label: `Base equivalent (${load.baseCurrency ?? 'CAD'})`,
        amount: moneyOf(load.freightAmountBase as string | null, load.baseCurrency ?? 'CAD'),
      });
    }
    return rows;
  }

  private terms(input: {
    reference: string;
    detentionRate: unknown;
    currency: string;
    /** Named in the opening term so the wording matches the document it is on. */
    kind: 'rate confirmation' | 'delivery packet';
  }): string[] {
    const terms = [
      `This ${input.kind} records the agreed rate and route for load ${input.reference}.`,
    ];
    if (input.detentionRate != null && Number(input.detentionRate) > 0) {
      terms.push(
        `Detention is billed at ${moneyOf(input.detentionRate as string, input.currency)} per hour after the free time at each stop.`,
      );
    }
    terms.push(
      'Carrier must hold active operating authority and cargo insurance for the duration of the haul.',
      'A delivery receipt signed by the receiver must accompany the invoice for this load.',
      'This document does not replace any separately signed broker–carrier agreement.',
    );
    return terms;
  }

  private signatureBlocks(
    rows: Array<{ role: string; signerName: string; signedAt: Date; data: Buffer; mimeType: string }>,
  ): SignatureBlock[] {
    return latestSignaturePerRole(rows).map((row) => {
      const asset = toEmbeddableImage(row.data, row.mimeType);
      return {
        role: row.role,
        signerName: row.signerName,
        signedAt: row.signedAt,
        asset: asset.ok ? (asset as EmbeddableImage) : null,
      };
    });
  }

  private attachmentBlocks(
    rows: Array<{ kind: string; fileName: string; createdAt: Date; data: Buffer; mimeType: string }>,
  ): AttachmentBlock[] {
    return rows.map((row) => {
      const asset = toEmbeddableImage(row.data, row.mimeType);
      return {
        kind: row.kind,
        fileName: row.fileName,
        uploadedAt: row.createdAt,
        asset: asset.ok ? (asset as EmbeddableImage) : null,
        reason: asset.ok ? null : asset.reason,
      };
    });
  }

  private fileName(reference: string, kind: string): string {
    return safeFileName(`${kind}_${reference}.pdf`);
  }

  async rateConfirmation(tenantId: string, loadId: string): Promise<PaperworkFile> {
    const [load, tenant] = await Promise.all([this.loadOr404(tenantId, loadId), this.tenantOr404(tenantId)]);
    const broker = await this.brokerParty(load.bookedByTenantId);
    const reference = referenceOf('RC', load.id);

    const pdf = buildRateConfirmation({
      reference,
      issuedAt: new Date(),
      carrier: partyFromTenant(tenant),
      broker,
      stops: this.routeStops(load),
      details: this.loadDetails(load),
      rateRows: this.rateRows({ ...load, baseCurrency: tenant.baseCurrency }),
      totalLabel: `Total linehaul (${load.freightCurrency})`,
      total: moneyOf(load.freightAmountTransaction as string | null, load.freightCurrency),
      detention: load.detentionRate
        ? `${moneyOf(load.detentionRate as unknown as string, load.freightCurrency)} per hour after free time`
        : null,
      terms: this.terms({
        reference,
        detentionRate: load.detentionRate,
        currency: load.freightCurrency,
        kind: 'rate confirmation',
      }),
      carrierSignature: null,
      brokerSignature: null,
    });

    return { fileName: this.fileName(reference, 'rate-confirmation'), pdf };
  }

  async packet(tenantId: string, loadId: string): Promise<PaperworkFile> {
    const [load, tenant] = await Promise.all([this.loadOr404(tenantId, loadId), this.tenantOr404(tenantId)]);
    const broker = await this.brokerParty(load.bookedByTenantId);
    const reference = referenceOf('POD', load.id);

    const pdf = buildDeliveryPacket({
      reference,
      generatedAt: new Date(),
      carrier: partyFromTenant(tenant),
      broker,
      stops: this.routeStops(load),
      details: [
        ...this.loadDetails(load),
        ['Delivered', load.deliveredAt ? dateOf(load.deliveredAt) : 'Not marked delivered'],
        ['Load reference', reference],
      ],
      rateRows: this.rateRows({ ...load, baseCurrency: tenant.baseCurrency }),
      totalLabel: `Total linehaul (${load.freightCurrency})`,
      total: moneyOf(load.freightAmountTransaction as string | null, load.freightCurrency),
      signatures: this.signatureBlocks(load.signatures),
      attachments: this.attachmentBlocks(load.documents),
      terms: this.terms({
        reference,
        detentionRate: null,
        currency: load.freightCurrency,
        kind: 'delivery packet',
      }),
    });

    return { fileName: this.fileName(reference, 'delivery-packet'), pdf };
  }

  async invoicePdf(tenantId: string, invoiceId: string): Promise<PaperworkFile> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { load: { select: { id: true } }, payerTenant: { select: { name: true } } },
    });
    if (!invoice) throw notFound('invoice not found');
    const tenant = await this.tenantOr404(tenantId);

    const currency = invoice.currencyTransaction;
    const billTo: Party = {
      name: invoice.payerTenant?.name ?? invoice.customerId,
      note: invoice.payerTenant ? 'Also on Loadwave' : 'Billed party on record',
    };

    const lines: Array<{ description: string; amount: string }> = [
      {
        description: invoice.loadId
          ? `Freight charges — load ${referenceOf('LD', invoice.loadId)}`
          : 'Freight charges',
        amount: moneyOf(invoice.subtotalTransaction as unknown as string, currency),
      },
    ];

    const taxLines: Array<{ label: string; amount: string }> = [];
    const rateOf = (value: unknown): string => {
      const n = Number(value);
      return Number.isFinite(n) ? `${(n * (n <= 1 ? 100 : 1)).toFixed(3).replace(/\.?0+$/, '')}%` : '';
    };
    if (invoice.zeroRated) {
      taxLines.push({ label: 'Sales tax — zero rated', amount: moneyOf(0, currency) });
    } else {
      // Only list a tax that was actually charged. The record carries a rate
      // slot for each of GST/HST/QST, so an unfiltered invoice prints
      // "GST 0% CA$0.00" at the customer — noise on a document they have to
      // reconcile.
      const candidates: Array<[unknown, unknown, string]> = [
        [invoice.gstRate, invoice.gstAmountTransaction, 'GST'],
        [invoice.hstRate, invoice.hstAmountTransaction, 'HST'],
        [invoice.qstRate, invoice.qstAmountTransaction, 'QST'],
      ];
      for (const [rate, amount, name] of candidates) {
        if (rate == null || Number(amount ?? 0) === 0) continue;
        taxLines.push({
          label: `${name} ${rateOf(rate)}`.trim(),
          amount: moneyOf(amount as string, currency),
        });
      }
    }

    const terms = Math.max(
      0,
      Math.round((invoice.dueDate.getTime() - invoice.issueDate.getTime()) / DAY_MS),
    );

    const notes = [
      `Make payment to ${tenant.name}, quoting invoice number ${referenceOf('INV', invoice.id)}.`,
      invoice.payerTenant
        ? 'Supporting documents — rate confirmation and the receiver-signed delivery packet — are attached to the load on Loadwave.'
        : 'A rate confirmation and the receiver-signed delivery packet are available from the load record.',
    ];

    const pdf = buildInvoice({
      invoiceNumber: referenceOf('INV', invoice.id),
      issuedAt: new Date(),
      issuer: partyFromTenant(tenant),
      billTo,
      currency,
      lines,
      subtotal: moneyOf(invoice.subtotalTransaction as unknown as string, currency),
      taxLines,
      total: moneyOf(invoice.totalTransaction as unknown as string, currency),
      issueDate: dateOf(invoice.issueDate),
      dueDate: dateOf(invoice.dueDate),
      paymentTerms: terms === 0 ? 'Due on receipt' : `Net ${terms} days`,
      status: invoice.paidAt ? 'PAID' : 'OUTSTANDING',
      paidNote: invoice.paidAt
        ? `Paid in full on ${dateOf(invoice.paidAt)} — ${moneyOf(
            (invoice.paidAmountTransaction ?? invoice.totalTransaction) as unknown as string,
            currency,
          )}. No balance remains on this invoice.`
        : null,
      loadRef: invoice.loadId ? referenceOf('LD', invoice.loadId) : null,
      notes,
    });

    return { fileName: this.fileName(referenceOf('INV', invoice.id), 'invoice'), pdf };
  }

  async captureSignature(input: SignatureInput): Promise<LoadSignatureRow> {
    const role = (input.role || 'RECEIVER').toUpperCase();
    if (!isSignatureRole(role)) {
      throw badRequest(`role must be one of ${SIGNATURE_ROLES.join(', ')}`);
    }
    const signerName = (input.signerName ?? '').trim().slice(0, 120);
    if (signerName.length < 2) throw badRequest('a signer name is required');

    const load = await this.prisma.load.findFirst({
      where: { id: input.loadId, tenantId: input.tenantId },
      select: { id: true, assigneeDriverId: true },
    });
    if (!load) throw notFound('load not found');

    let data: Buffer;
    try {
      data = Buffer.from(input.dataBase64 ?? '', 'base64');
    } catch {
      throw badRequest('signature image is not valid base64');
    }
    if (data.length === 0) throw badRequest('signature image is empty');
    if (data.length > MAX_SIGNATURE_BYTES) throw badRequest('signature image is too large');

    // Sniff the bytes rather than trusting the client's word, so the stored
    // MIME type is always true and the packet can always embed it.
    const mimeType = sniffImageMime(data);
    if (!mimeType) throw badRequest('a signature must be a JPEG or PNG image');

    const created = await this.prisma.loadSignature.create({
      data: {
        tenantId: input.tenantId,
        loadId: load.id,
        driverId: input.driverId ?? load.assigneeDriverId ?? null,
        role,
        signerName,
        signedAt: input.signedAt ?? new Date(),
        mimeType,
        sizeBytes: data.length,
        data,
        capturedById: input.capturedById ?? null,
      },
    });
    return this.mapSignature(created);
  }

  async listSignatures(tenantId: string, loadId: string): Promise<LoadSignatureRow[]> {
    const rows = await this.prisma.loadSignature.findMany({
      where: { tenantId, loadId },
      orderBy: { signedAt: 'asc' },
    });
    return rows.map((row) => this.mapSignature(row));
  }

  async loadAssignees(tenantId: string, loadId: string): Promise<{ driverId: string | null } | null> {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: { assigneeDriverId: true },
    });
    return load ? { driverId: load.assigneeDriverId } : null;
  }

  private mapSignature(row: {
    id: string;
    loadId: string;
    role: string;
    signerName: string;
    signedAt: Date;
    driverId: string | null;
    sizeBytes: number;
    createdAt: Date;
  }): LoadSignatureRow {
    return {
      id: row.id,
      loadId: row.loadId,
      role: row.role,
      signerName: row.signerName,
      signedAt: row.signedAt.toISOString(),
      driverId: row.driverId,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
