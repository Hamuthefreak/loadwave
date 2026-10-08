import type { TrustSignals } from '../../components/TrustBadges';

export interface BoardLoad {
  id: string;
  tenantId: string;
  postedByTenantName: string;
  postedByMcNumber: string | null;
  postedByUsdotNumber: string | null;
  // Note: there is no `postedByVerified`. Authority state lives in
  // postedByTrust below, so the badge and the trust chips cannot disagree.
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
  /**
   * What the truck actually earns. `grossPerMile` is the loaded leg — the number
   * every other board shows — and `netPerMile` is the same money spread over the
   * empty kilometres to the pickup. Both are null when the server could not work
   * them out, and the card then shows the plain rate rather than a guess.
   */
  grossPerMile?: number | null;
  deadheadKm?: number | null;
  netPerMile?: number | null;
  /** Where the deadhead was measured from: the active trip's delivery or the last fix. */
  positionSource?: 'ACTIVE_LOAD' | 'LAST_POSITION' | null;
  positionPlace?: string | null;
  positionAt?: string | null;
  /** Loads picking up near this one's delivery, best first. */
  topRoundTrips?: RoundTrip[];
  /** Trust signals from the posting carrier. */
  postedByRatingAvg?: number | null;
  postedByRatingCount?: number;
  /** Authority age, insurance on file, payment record and reports. */
  postedByTrust?: TrustSignals | null;
}

/** A backhaul: a load that picks up close to where this one delivers. */
export interface RoundTrip {
  id: string;
  originRegion: string;
  destinationRegion: string;
  originLocality: string | null;
  destinationLocality: string | null;
  equipmentType: string | null;
  freightCurrency: string;
  distanceKmEstimate: number;
  /** Empty kilometres between this load's delivery and that load's pickup. */
  deadheadKm: number;
  grossPerMile: number | null;
  /** That leg's rate over loaded plus empty kilometres. */
  netPerMile: number | null;
  /** True when its trailer matches ours; ranked first, never required. */
  sameEquipment: boolean;
  pickupDate: string | null;
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