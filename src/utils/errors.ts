export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
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

export function conflict(msg: string): AppError {
  return new AppError(409, 'CONFLICT', msg);
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
