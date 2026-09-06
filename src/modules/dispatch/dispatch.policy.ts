import { badRequest } from '../../utils/errors';

/** Load lifecycle used by dispatch workflow. */
export const LOAD_STATUS = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  INVOICED: 'INVOICED',
} as const;

// A load must be assigned before it can move: nothing may skip straight from
// OPEN to IN_TRANSIT/DELIVERED/INVOICED. INVOICED is terminal.
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_TRANSIT', 'DELIVERED', 'INVOICED', 'OPEN'],
  IN_TRANSIT: ['DELIVERED', 'INVOICED'],
  DELIVERED: ['INVOICED'],
  INVOICED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw badRequest(`cannot transition load from ${from} to ${to}`);
  }
}

export interface StatusActor {
  /** True when the caller holds an ops role (ADMIN/DISPATCHER). */
  isOps: boolean;
  /** The caller's linked driver id — null for ops users and unlinked accounts. */
  driverId: string | null;
}

/**
 * Dispatch guard: only ops users (ADMIN/DISPATCHER) may advance a load, or a
 * DRIVER whose linked driver record is the load's assignee. An unlinked
 * account is never treated as ops — that was a privilege hole before.
 */
export function canAdvance(loadAssigneeDriverId: string | null, actor: StatusActor): boolean {
  if (actor.isOps) return true;
  if (!actor.driverId) return false; // unlinked driver account: cannot touch any load
  if (!loadAssigneeDriverId) return false; // unassigned load, driver cannot claim it
  return loadAssigneeDriverId === actor.driverId;
}