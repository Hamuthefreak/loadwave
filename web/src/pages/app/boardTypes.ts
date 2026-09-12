import type { TrustSignals } from '../../components/TrustBadges';

export interface BoardLoad {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  postedByMcNumber: string | null;
  postedByUsdotNumber: string | null;
  externalLoadboardId: string | null;
  originCountry: string;
  originRegion: string;
  destinationCountry: string;
  destinationRegion: string;
  distanceKmEstimate: string | null;
  equipmentType: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  freightCurrency: string;
  freightAmountTransaction: string | null;
  freightAmountBase: string | null;
  isInternational: boolean;
  status: string;
  marketplaceStatus: 'PRIVATE' | 'PUBLIC' | 'BOOKED';
  bookedByTenantId: string | null;
  bookedAt: string | null;
  createdAt: string;
  /** Lane benchmark from the marketplace (rate-my-lane). */
  laneAvgPerMile?: number | null;
  laneSamples?: number;
  /** Trust signals from the posting carrier. */
  postedByRatingAvg?: number | null;
  postedByRatingCount?: number;
  postedByVerified?: boolean;
  /** Authority age, insurance on file, payment record and reports. */
  postedByTrust?: TrustSignals | null;
}

export interface TruckRow {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  equipmentType: string;
  trailerType: string | null;
  locationCountry: string;
  locationRegion: string;
  availableFrom: string;
  availableTo: string | null;
  rateCurrency: string;
  rateAmount: string | null;
  notes: string | null;
  status: string;
  bookedByTenantId: string | null;
  bookedAt: string | null;
  createdAt: string;
  /** Authority, insurance, payment record and reports. */
  postedByTrust?: TrustSignals | null;
}

export type ClickedLoad = 'load' | 'truck';