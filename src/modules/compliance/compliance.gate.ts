/**
 * The seam between dispatch and the compliance vault.
 *
 * Dispatch has to be told "no" before a driver or a unit with a lapsed document
 * goes on a load — but the load service must not import the vault to ask. The
 * interface lives here, the vault implements it, and the load service depends on
 * the shape rather than the implementation. That also means the gate can be
 * stubbed in a test without a database, and that a deployment with the vault
 * switched off still dispatches.
 *
 * The gate returns *decisions*, not booleans: which documents blocked, and which
 * merely deserve a warning, so the dispatcher sees the reason and not just a
 * refusal.
 */

import type { ComplianceFlag } from './compliance.policy';

export interface AssignmentComplianceReport {
  /** Lapsed documents. The assignment is refused unless it is overridden. */
  blocks: ComplianceFlag[];
  /** Expiring soon, or required paperwork with nothing on file. Advisory. */
  warnings: ComplianceFlag[];
}

export interface ComplianceOverrideInput {
  tenantId: string;
  loadId: string;
  driverId: string | null;
  assetId: string | null;
  /** Exactly what was overridden — snapshotted by the gate before it is stored. */
  blocks: ComplianceFlag[];
  reason: string;
  actorId: string | null;
  /** The overrider's name, so the record makes sense without a user lookup. */
  actorName: string | null;
}

export interface AssignmentComplianceGate {
  checkAssignment(
    tenantId: string,
    driverId: string | null,
    assetId: string | null,
  ): Promise<AssignmentComplianceReport>;

  /**
   * Records that a blocked assignment was made deliberately. Called once per
   * override, never to unlock the gate for later assignments: yesterday's
   * decision to run a truck on a lapsed inspection is not today's.
   */
  recordOverride(input: ComplianceOverrideInput): Promise<void>;
}

export function emptyReport(): AssignmentComplianceReport {
  return { blocks: [], warnings: [] };
}
