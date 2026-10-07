/**
 * The error every failed API call throws.
 *
 * It lives in its own module rather than beside the client so that code with no
 * business touching the DOM — the offline renewal queue, which has to decide
 * from a status whether a failure is worth retrying — can use it without
 * pulling in the whole client. `api.ts` re-exports it, so this is still
 * `import { ApiError } from '../api'` for everything that already does.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
