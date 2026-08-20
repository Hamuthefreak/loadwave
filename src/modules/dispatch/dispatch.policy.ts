import { badRequest } from '../../utils/errors';

/** Load lifecycle used by dispatch workflow. */
export const LOAD_STATUS = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  INVOICED: 'INVOICED',
} as const;

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED'],
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

/**
 * Dispatch guard: a load may only be assigned by ADMIN/DISPATCHER. A DRIVER
 * user may advance a load only if it is assigned to their linked driver.
 */
export function driverMayAdvance(loadAssigneeDriverId: string | null, actorDriverId: string | null): boolean {
  if (!actorDriverId) return true; // admin/dispatcher: any transition allowed
  if (!loadAssigneeDriverId) return false; // unassigned load, driver cannot claim
  return loadAssigneeDriverId === actorDriverId;
}