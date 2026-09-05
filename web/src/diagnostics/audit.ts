export interface AuditRoute {
  path: string;
  name: string;
  /** CSS selector that must be present for the route to count as rendered. */
  marker?: string;
  /** Substring that must appear in the body text. */
  text?: string;
  /** /app/* routes redirect to /signin when unauthenticated — treated as expected. */
  protected?: boolean;
  /** Route that should redirect here (e.g. the catch-all 404 → '/'). */
  expectRedirect?: string;
}

export const AUDIT_ROUTES: AuditRoute[] = [
  { path: '/', name: 'Home', marker: '.ld-h1' },
  { path: '/carrier', name: 'For Carriers', marker: '.ld-feature-grid' },
  { path: '/broker', name: 'For Brokers', marker: '.ld-feature-grid' },
  { path: '/shipper', name: 'For Shippers', marker: '.ld-feature-grid' },
  { path: '/pricing', name: 'Pricing', marker: '.ld-plan-card' },
  { path: '/faq', name: 'FAQ', marker: '.ld-faq-item' },
  { path: '/signin', name: 'Sign in', marker: '.ld-auth-card' },
  { path: '/app/dashboard', name: 'Dashboard', marker: 'h1', protected: true },
  { path: '/app/board', name: 'Search Loads', marker: 'h1', protected: true },
  { path: '/app/trucks', name: 'Search Trucks', marker: 'h1', protected: true },
  { path: '/app/myloads', name: 'My Loads', marker: 'h1', protected: true },
  { path: '/app/network', name: 'Private Network', marker: 'h1', protected: true },
  { path: '/app/tools', name: 'Tools & Rates', marker: 'h1', protected: true },
  { path: '/app/ifta', name: 'Fuel & IFTA', marker: 'h1', protected: true },
  { path: '/app/fleet', name: 'Fleet', marker: 'h1', protected: true },
  { path: '/app/drivers', name: 'Drivers', marker: 'h1', protected: true },
  { path: '/__nope__', name: 'Catch-all 404', expectRedirect: '/' },
];

export interface StepResult {
  path: string;
  name: string;
  ok: boolean;
  errors: string[];
  markerFound: boolean;
  redirectedTo?: string;
  elapsedMs: number;
  note?: string;
}

export interface AuditState {
  running: boolean;
  currentPath: string | null;
  steps: StepResult[];
  startedAt: number | null;
}

let state: AuditState = { running: false, currentPath: null, steps: [], startedAt: null };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function setAudit(partial: Partial<AuditState>): void {
  state = { ...state, ...partial };
  emit();
}

export function getAudit(): AuditState {
  return state;
}

export function subscribeAudit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startAudit(): void {
  setAudit({ running: true, steps: [], startedAt: Date.now(), currentPath: null });
}

export function stopAudit(): void {
  setAudit({ running: false, startedAt: null, currentPath: null });
}

export function setCurrentPath(path: string | null): void {
  setAudit({ currentPath: path });
}

export function pushStep(step: StepResult): void {
  setAudit({ steps: [...state.steps, step] });
}
