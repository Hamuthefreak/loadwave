import { d, type Decimal } from '../../utils/decimal';
import { GST_RATE, HST_RATES, QST_RATE, type TaxExemptReason } from './tax.constants';

export interface TaxableSupplyContext {
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  isInternational?: boolean;
  isContinuousInboundOutbound?: boolean;
  interliningPartner?: string | null;
}

export interface TaxDetermination {
  zeroRated: boolean;
  taxExemptReason: TaxExemptReason | null;
  gstRate: Decimal;
  hstRate: Decimal;
  qstRate: Decimal;
}

export interface TaxDeterminationJSON {
  zeroRated: boolean;
  taxExemptReason: TaxExemptReason | null;
  gstRate: string;
  hstRate: string;
  qstRate: string;
  totalRate: string;
}

export function toJson(det: TaxDetermination): TaxDeterminationJSON {
  return {
    zeroRated: det.zeroRated,
    taxExemptReason: det.taxExemptReason,
    gstRate: det.gstRate.toString(),
    hstRate: det.hstRate.toString(),
    qstRate: det.qstRate.toString(),
    totalRate: det.gstRate.plus(det.hstRate).plus(det.qstRate).toString(),
  };
}

/**
 * CRA / Revenu Québec place-of-supply rules for freight transportation.
 *
 * The supply of a freight transportation service is generally made where the
 * destination of the goods is located. Rules applied here:
 *
 * 1. Continuous inbound/outbound international movements are zero-rated.
 * 2. International (cross-border Canada<->U.S.) movements are zero-rated
 *    (taxable at 0%) with a documented reason.
 * 3. Interlining with a licensed partner keeps the international flow zero-rated.
 * 4. Domestic (within Canada):
 *    - Destination Quebec: GST 5% + QST 9.975% (two separately invoiced taxes).
 *    - Destination in an HST province: single HST rate.
 *    - Otherwise: GST 5% only.
 */
export function determineTax(input: TaxableSupplyContext): TaxDetermination {
  const originCountry = input.originCountry.toUpperCase();
  const destinationCountry = input.destinationCountry.toUpperCase();
  const destinationRegion = input.destinationRegion.toUpperCase();

  if (input.isContinuousInboundOutbound) {
    return zeroRated('CONTINUOUS_INBOUND');
  }
  // Interlining agreements keep the continuous international movement
  // zero-rated under both GST/HST and QST.
  if (input.interliningPartner) {
    return zeroRated('INTERLINING');
  }
  if (input.isInternational || originCountry !== destinationCountry) {
    return zeroRated('INTERNATIONAL_OUTBOUND');
  }
  if (destinationCountry !== 'CA') {
    return zeroRated('INTERNATIONAL_OUTBOUND');
  }

  // Domestic movement wholly within Canada.
  if (destinationRegion === 'QC') {
    return {
      zeroRated: false,
      taxExemptReason: null,
      gstRate: d(GST_RATE),
      hstRate: d(0),
      qstRate: d(QST_RATE),
    };
  }

  const hstRate = HST_RATES[destinationRegion];
  if (hstRate) {
    return {
      zeroRated: false,
      taxExemptReason: null,
      gstRate: d(0),
      hstRate: d(hstRate),
      qstRate: d(0),
    };
  }

  return {
    zeroRated: false,
    taxExemptReason: null,
    gstRate: d(GST_RATE),
    hstRate: d(0),
    qstRate: d(0),
  };
}

function zeroRated(reason: TaxExemptReason): TaxDetermination {
  return {
    zeroRated: true,
    taxExemptReason: reason,
    gstRate: d(0),
    hstRate: d(0),
    qstRate: d(0),
  };
}
