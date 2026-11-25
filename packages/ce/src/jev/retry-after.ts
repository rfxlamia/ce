/**
 * Parsing of server retry delays. Shared by both transports and the gateway.
 * Pure: no I/O, no clock unless `now` is defaulted.
 */

const DELTA = /^\d+(?:\.\d+)?$/;
/** IMF-fixdate, the HTTP-date form: `Sun, 06 Nov 1994 08:49:37 GMT`. */
const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parses the text of a `Retry-After` header (delta-seconds or HTTP date) into a non-negative
 * whole number of milliseconds. Returns `undefined` for any other text.
 */
export function parseRetryAfter(text: string, now: number = Date.now()): number | undefined {
  const value = text.trim();
  if (DELTA.test(value)) {
    const ms = Math.round(Number(value) * 1000);
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (HTTP_DATE.test(value)) {
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.round(date - now));
  }
  return undefined;
}

/** Parses the text of a `retry-after-ms` header into whole milliseconds, else `undefined`. */
export function parseRetryAfterMsText(text: string): number | undefined {
  const value = text.trim();
  if (!DELTA.test(value)) return undefined;
  const ms = Math.round(Number(value));
  return Number.isFinite(ms) ? ms : undefined;
}

interface HeaderReader {
  get(name: string): string | null;
}

/** `retry-after-ms` first, else `Retry-After`. Returns `undefined` when neither is valid. */
export function parseRetryAfterHeaders(
  headers: HeaderReader | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (headers === null || headers === undefined || typeof headers.get !== 'function') {
    return undefined;
  }
  const ms = headers.get('retry-after-ms');
  if (ms !== null) {
    const parsed = parseRetryAfterMsText(ms);
    if (parsed !== undefined) return parsed;
  }
  const after = headers.get('retry-after');
  return after === null ? undefined : parseRetryAfter(after, now);
}
