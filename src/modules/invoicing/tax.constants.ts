/** Canadian federal GST (goods & services tax). */
export const GST_RATE = '0.05';

/** Quebec QST (Quebec sales tax) as at today. */
export const QST_RATE = '0.09975';

/**
 * HST is a single combined rate that replaces GST+PST in participating
 * provinces. Per CRA, harmonized rates (GST/HST) are:
 * - NB, NL, NS, PE: 15%
 * - ON: 13%
 * Provinces that do not harmonize use GST only (5%) — see GST_ONLY_PROVINCES.
 */
export const HST_RATES: Record<string, string> = {
  ON: '0.13',
  NB: '0.15',
  NL: '0.15',
  NS: '0.15',
  PE: '0.15',
};

export const GST_ONLY_PROVINCES: readonly string[] = ['AB', 'BC', 'MB', 'NT', 'NU', 'SK', 'YT'];

export type TaxExemptReason = 'INTERNATIONAL_OUTBOUND' | 'CONTINUOUS_INBOUND' | 'INTERLINING' | 'OTHER';
