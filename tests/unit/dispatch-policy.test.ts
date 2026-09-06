import {
  canTransition,
  assertTransition,
  canAdvance,
  LOAD_STATUS,
} from '../../src/modules/dispatch/dispatch.policy';

const ops = { isOps: true, driverId: null };
const linkedDriver = { isOps: false, driverId: 'driver-1' };
const otherDriver = { isOps: false, driverId: 'driver-2' };
const unlinkedDriver = { isOps: false, driverId: null };

describe('load status transitions', () => {
  it('requires assignment before a load can move to IN_TRANSIT/DELIVERED/INVOICED', () => {
    expect(canTransition('OPEN', 'ASSIGNED')).toBe(true);
    expect(canTransition('OPEN', 'IN_TRANSIT')).toBe(false);
    expect(canTransition('OPEN', 'DELIVERED')).toBe(false);
    expect(canTransition('OPEN', 'INVOICED')).toBe(false);
    expect(canTransition('OPEN', 'OPEN')).toBe(false);
  });

  it('walks the normal lifecycle and never leaves INVOICED', () => {
    expect(canTransition('ASSIGNED', 'IN_TRANSIT')).toBe(true);
    expect(canTransition('IN_TRANSIT', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'INVOICED')).toBe(true);
    expect(canTransition('INVOICED', 'DELIVERED')).toBe(false);
    expect(canTransition('INVOICED', 'OPEN')).toBe(false);
  });

  it('keeps ASSIGNED -> OPEN so a dispatcher can pull a mis-assignment', () => {
    expect(canTransition('ASSIGNED', 'OPEN')).toBe(true);
  });

  it('assertTransition throws on illegal moves', () => {
    expect(() => assertTransition('OPEN', 'DELIVERED')).toThrow(/cannot transition/);
    expect(() => assertTransition('ASSIGNED', 'DELIVERED')).not.toThrow();
  });
});

describe('canAdvance (role-aware dispatch guard)', () => {
  it('lets ops users advance any load, assigned or not', () => {
    expect(canAdvance(null, ops)).toBe(true);
    expect(canAdvance('driver-1', ops)).toBe(true);
  });

  it('lets the assigned driver advance their own load only', () => {
    expect(canAdvance('driver-1', linkedDriver)).toBe(true);
    expect(canAdvance('driver-2', linkedDriver)).toBe(false);
  });

  it('never lets an unlinked account act as ops', () => {
    // Regression: driverMayAdvance treated a null actorDriverId as ops.
    expect(canAdvance(null, unlinkedDriver)).toBe(false);
    expect(canAdvance('driver-1', unlinkedDriver)).toBe(false);
  });

  it('never lets a driver claim an unassigned load', () => {
    expect(canAdvance(null, linkedDriver)).toBe(false);
    expect(canAdvance(null, otherDriver)).toBe(false);
  });
});

// Keep the constant referenced so removing a status is a compile error here.
void LOAD_STATUS;
