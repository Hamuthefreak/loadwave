import { useSyncExternalStore } from 'react';

export type Duty = 'ACTIVE' | 'OFF_DUTY' | 'SUSPENDED' | null;

let duty: Duty = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Write the driver's duty status. Every subscriber (sidebar, bottom nav, FAB) updates at once. */
export function setDuty(next: Duty): void {
  if (next === duty) return;
  duty = next;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Duty {
  return duty;
}

/** React hook over the shared duty status. */
export function useDuty(): Duty {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}