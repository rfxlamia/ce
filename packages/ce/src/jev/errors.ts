/**
 * Error taxonomy of the Jev gateway.
 *
 * The three classes are deliberately disjoint: none extends another, and none
 * extends StageError. Messages are built only from the reason, the HTTP status
 * and the retry delay. A caller-supplied `message` must already be sanitized:
 * it must never carry an API key, an Authorization header, state text or
 * image bytes.
 */

export type JevImageErrorReason =
  | 'bad_request'
  | 'rate_limited'
  | 'timeout'
  | 'connection'
  | 'server'
  | 'invalid_image'
  | 'invalid_response'
  | 'client';

export interface JevImageErrorOptions {
  /** HTTP status. Pass only when an HTTP status exists. */
  status?: number;
  /** Server-sent delay. Kept only when `reason` is `rate_limited`. */
  retryAfterMs?: number;
  /** Already-sanitized message. Replaces the default message. */
  message?: string;
}

/** Recoverable failure of the single final-image request. */
export class JevImageError extends Error {
  declare readonly reason: JevImageErrorReason;
  /** Present only when an HTTP status exists. */
  declare readonly status?: number;
  /** Present only when `reason` is `rate_limited` and the server sent a delay. */
  declare readonly retryAfterMs?: number;

  constructor(reason: JevImageErrorReason, options: JevImageErrorOptions = {}) {
    const { status, retryAfterMs, message } = options;
    super(
      message ??
        `Jev image request failed: ${reason}${status !== undefined ? ` (HTTP ${status})` : ''}`,
    );
    this.name = 'JevImageError';
    Object.defineProperty(this, 'reason', { value: reason, enumerable: true });
    if (status !== undefined) {
      Object.defineProperty(this, 'status', { value: status, enumerable: true });
    }
    if (reason === 'rate_limited' && retryAfterMs !== undefined) {
      Object.defineProperty(this, 'retryAfterMs', { value: retryAfterMs, enumerable: true });
    }
  }
}

/** Persistent rate limit. Distinct from the SDK's class of the same name. */
export class RateLimitError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(retryAfterMs: number | undefined) {
    super(
      retryAfterMs === undefined
        ? 'Jev rate limit exceeded'
        : `Jev rate limit exceeded (retry after ${retryAfterMs} ms)`,
    );
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Misuse of the gateway, such as a second image request on one instance. */
export class JevUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevUsageError';
  }
}
