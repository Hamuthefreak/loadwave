export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /**
     * Structured payload the client needs to act on the refusal — the specific
     * documents blocking an assignment, for instance. It rides along with the
     * error rather than being fetched again, so the screen showing the problem
     * is looking at the same facts the server refused on.
     */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(msg: string): AppError {
  return new AppError(400, 'BAD_REQUEST', msg);
}

export function unauthorized(msg = 'Authentication required'): AppError {
  return new AppError(401, 'UNAUTHORIZED', msg);
}

export function forbidden(msg = 'Access denied'): AppError {
  return new AppError(403, 'FORBIDDEN', msg);
}

export function notFound(msg = 'Resource not found'): AppError {
  return new AppError(404, 'NOT_FOUND', msg);
}

export function conflict(msg: string, details?: unknown): AppError {
  return new AppError(409, 'CONFLICT', msg, details);
}

/**
 * Refused because a stated rule would be broken: a lapsed compliance document,
 * a duplicate open query. Distinct from CONFLICT so the client can tell "no"
 * apart from "that already exists".
 */
export function blocked(code: string, msg: string, details?: unknown): AppError {
  return new AppError(409, code, msg, details);
}

/**
 * The account is fine, the plan is not. 402 lets the client distinguish "this
 * needs an upgrade" from "you may not do this at all", which is the difference
 * between showing an upgrade prompt and showing an error.
 */
export function paymentRequired(msg: string): AppError {
  return new AppError(402, 'PLAN_UPGRADE_REQUIRED', msg);
}

export function unprocessable(msg: string): AppError {
  return new AppError(422, 'UNPROCESSABLE_ENTITY', msg);
}
