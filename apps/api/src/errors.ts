import { HTTPException } from 'hono/http-exception';

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'owner_not_registered'
  | 'owner_disabled'
  | 'totp_required'
  | 'totp_locked'
  | 'totp_invalid'
  | 'email_unverified'
  | 'invalid_transition'
  | 'shares_invalid'
  | 'grid_incomplete'
  | 'total_mismatch_needs_reason';

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(status, { message });
  }

  toBody(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'forbidden', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const validation = (message: string, details?: unknown) =>
  new ApiError(422, 'validation', message, details);
