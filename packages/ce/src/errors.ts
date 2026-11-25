export type Stage = 'context' | 'assessment' | 'runtime' | 'evidence';

/**
 * Failure of one pipeline stage. The message states the stage and the
 * constructor name of the cause only. It never repeats the cause's message,
 * which could carry an API key, an Authorization header, state text or image
 * bytes. Callers that need detail read `cause`.
 */
export class StageError extends Error {
  readonly stage: Stage;
  override readonly cause: unknown;
  /** Set only when a Call_Log write failure superseded the original call error. */
  readonly callError?: unknown;

  constructor(stage: Stage, cause: unknown, options?: { callError?: unknown }) {
    super(`Stage "${stage}" failed: ${causeName(cause)}`);
    this.name = 'StageError';
    this.stage = stage;
    this.cause = cause;
    if (options !== undefined && 'callError' in options) {
      this.callError = options.callError;
    }
  }
}

function causeName(cause: unknown): string {
  if (cause === null || cause === undefined) return 'unknown';
  const ctor = (cause as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' && ctor.name !== '' ? ctor.name : 'unknown';
}
