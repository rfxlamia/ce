/**
 * Duration strings ("90s", "2m", "500ms") <-> milliseconds.
 * Shared by schema.ts (validation) and env.ts (coercion).
 */

export const DURATION_PATTERN = /^[1-9]\d*(ms|s|m)$/;

const UNIT_MS = { ms: 1, s: 1000, m: 60_000 } as const;

/** Thrown by `parseDuration` for text that does not match `DURATION_PATTERN`. */
export class DurationParseError extends Error {
  readonly text: string;

  constructor(text: string) {
    super(`not a duration string like "90s": ${JSON.stringify(text)}`);
    this.name = 'DurationParseError';
    this.text = text;
  }
}

/**
 * Converts a duration string to milliseconds.
 * Throws `DurationParseError` (carrying the original text) when the text does not match.
 */
export function parseDuration(text: string): number {
  if (typeof text !== 'string' || !DURATION_PATTERN.test(text)) {
    throw new DurationParseError(String(text));
  }
  const unit = text.endsWith('ms') ? 'ms' : text.endsWith('s') ? 's' : 'm';
  const amount = Number(text.slice(0, text.length - unit.length));
  return amount * UNIT_MS[unit];
}

/**
 * Formats a positive integer number of milliseconds using the largest unit
 * that represents it exactly. `parseDuration(formatDuration(ms)) === ms`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new RangeError(`duration must be a positive integer number of milliseconds: ${ms}`);
  }
  if (ms % UNIT_MS.m === 0) return `${ms / UNIT_MS.m}m`;
  if (ms % UNIT_MS.s === 0) return `${ms / UNIT_MS.s}s`;
  return `${ms}ms`;
}
