/**
 * FMCSA carrier records — pure parsing and interpretation, no network.
 *
 * The public FMCSA lookup (QCMobile) returns a loosely-typed payload whose
 * wrapper shape varies by endpoint: `content.carrier`, `content[0].carrier`,
 * and a bare `carrier` all occur in the wild. Everything that reads that
 * payload lives here so it can be tested against the shapes that actually
 * happen, instead of being asserted to work because one happy path parsed.
 *
 * What we take from FMCSA is deliberately narrow: whether the carrier is
 * *allowed to operate*. FMCSA does not return a reliable authority grant date
 * in this endpoint, so authority *age* stays self-declared — mixing a guessed
 * date into a "verified" badge is exactly the dishonesty this module exists
 * to remove.
 */

/** How long a successful check is trusted before it is shown as stale. */
export const FMCSA_FRESH_DAYS = 90;

export type FmcsaStatus = 'ACTIVE' | 'NOT_ALLOWED' | 'INACTIVE' | 'UNKNOWN';

export interface FmcsaCarrier {
  dotNumber: string;
  legalName: string | null;
  dbaName: string | null;
  mcNumber: string | null;
  status: FmcsaStatus;
  /** Raw upstream markers, kept for support and debugging. */
  allowedToOperate: string | null;
  statusCode: string | null;
}

export type FmcsaLookupResult =
  | { ok: true; carrier: FmcsaCarrier }
  | { ok: false; reason: 'DISABLED' | 'NOT_FOUND' | 'UPSTREAM_ERROR'; detail?: string };

/** USDOT numbers are digits, sometimes written "USDOT 1234567". */
export function normalizeDot(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  // Strip a leading zero run, keep at least one digit.
  const trimmed = digits.replace(/^0+/, '') || '0';
  return trimmed.length > 9 ? null : trimmed;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  // Scalar only: coercing an object or array would yield the literal
  // "[object Object]", which would then be stored as if it were a real value.
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return null;
  }
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Dig the carrier object out of any of the wrappers FMCSA uses. Returns null
 * when the payload has no usable carrier, which the client reports as
 * NOT_FOUND rather than inventing a carrier with empty fields.
 */
export function extractCarrier(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;

  const candidates: unknown[] = [root.content, root.carrier, root];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const found = extractCarrierEntry(entry);
        if (found) return found;
      }
      continue;
    }
    const found = extractCarrierEntry(candidate);
    if (found) return found;
  }
  return null;
}

function extractCarrierEntry(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  // `{ carrier: {...} }` wrapper
  if (obj.carrier && typeof obj.carrier === 'object' && !Array.isArray(obj.carrier)) {
    return obj.carrier as Record<string, unknown>;
  }
  // Already a carrier object: it has to look like one.
  if ('dotNumber' in obj || 'legalName' in obj || 'allowedToOperate' in obj) return obj;
  return null;
}

/**
 * FMCSA's own flags, translated. `allowedToOperate: "N"` is the strongest
 * negative signal the public data carries, so it wins over everything.
 */
export function deriveStatus(input: {
  allowedToOperate?: unknown;
  statusCode?: unknown;
}): FmcsaStatus {
  const allowed = str(input.allowedToOperate)?.toUpperCase() ?? null;
  const code = str(input.statusCode)?.toUpperCase() ?? null;

  if (allowed === 'N') return 'NOT_ALLOWED';
  if (code === 'I' || code === 'INACTIVE') return 'INACTIVE';
  if (allowed === 'Y') return 'ACTIVE';
  // An FMCSA record with no operating flag tells us nothing we can stand behind.
  return 'UNKNOWN';
}

/** Normalize the mcNumber field, which arrives as a string, a number, or an array of docket objects. */
export function normalizeMcNumber(value: unknown): string | null {
  const direct = str(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        const found = str((entry as Record<string, unknown>).mcNumber);
        if (found) return found;
        continue;
      }
      const asStr = str(entry);
      if (asStr) return asStr;
    }
  }
  return null;
}

/** Map a raw FMCSA payload into the narrow shape we store. */
export function mapCarrier(payload: unknown): FmcsaCarrier | null {
  const carrier = extractCarrier(payload);
  if (!carrier) return null;

  const dot = normalizeDot(str(carrier.dotNumber));
  if (!dot) return null;

  return {
    dotNumber: dot,
    legalName: str(carrier.legalName),
    dbaName: str(carrier.dbaName),
    mcNumber: normalizeMcNumber(carrier.mcNumber),
    status: deriveStatus({
      allowedToOperate: carrier.allowedToOperate,
      statusCode: carrier.statusCode,
    }),
    allowedToOperate: str(carrier.allowedToOperate)?.toUpperCase() ?? null,
    statusCode: str(carrier.statusCode)?.toUpperCase() ?? null,
  };
}

/**
 * The three states a counterparty can actually rely on. This is the whole
 * point of the module: "verified" has to mean a check happened and succeeded,
 * not that a text box was filled in.
 */
export type VerificationState = 'VERIFIED' | 'DECLARED' | 'NONE' | 'FAILED';

export interface VerificationInput {
  mcNumber: string | null;
  usdotNumber: string | null;
  checkedAt: Date | null;
  checkStatus: string | null;
  now: Date;
  enabled: boolean;
}

export interface Verification {
  state: VerificationState;
  /** True only for a fresh, successful FMCSA check of an operating carrier. */
  verified: boolean;
  checkedAt: Date | null;
  stale: boolean;
  /** Displayable explanation; never overstates what was checked. */
  note: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function verificationState(input: VerificationInput): Verification {
  const hasNumber = Boolean(input.mcNumber || input.usdotNumber);

  if (!hasNumber) {
    return {
      state: 'NONE',
      verified: false,
      checkedAt: null,
      stale: false,
      note: 'No MC/USDOT on file',
    };
  }

  if (!input.checkedAt) {
    // Either we never checked, or checking is switched off here. Both mean the
    // number is self-declared, and we say exactly that.
    return {
      state: 'DECLARED',
      verified: false,
      checkedAt: null,
      stale: false,
      note: input.enabled
        ? 'Declared by the carrier — not checked yet'
        : 'Declared by the carrier — not checked',
    };
  }

  const stale = input.now.getTime() - input.checkedAt.getTime() > FMCSA_FRESH_DAYS * DAY_MS;
  const status = (input.checkStatus ?? 'UNKNOWN').toUpperCase();

  if (status === 'ACTIVE') {
    return {
      state: 'VERIFIED',
      verified: !stale,
      checkedAt: input.checkedAt,
      stale,
      note: stale
        ? 'FMCSA check is over 90 days old — recheck advised'
        : 'Authority checked against FMCSA records',
    };
  }

  if (status === 'NOT_ALLOWED') {
    return {
      state: 'FAILED',
      verified: false,
      checkedAt: input.checkedAt,
      stale,
      note: 'FMCSA records do not allow this carrier to operate',
    };
  }

  if (status === 'INACTIVE') {
    return {
      state: 'FAILED',
      verified: false,
      checkedAt: input.checkedAt,
      stale,
      note: 'FMCSA record is inactive',
    };
  }

  // Checked, but the record carried no operating flag we are willing to call a pass.
  return {
    state: 'DECLARED',
    verified: false,
    checkedAt: input.checkedAt,
    stale,
    note: 'FMCSA record found, but operating status could not be confirmed',
  };
}
