// Strips credentials before anything is written to disk (R7.2, R8.2, R8.15).
// Never prints or returns credential values.

const SECRET_ENV_VARS = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'] as const;

// Lower-cased names of keys that carry credentials. Matched exactly, at any depth.
const CREDENTIAL_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'x-typesafe-api-key',
  'cookie',
  'set-cookie',
]);

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(strip(item, seen));
    return out;
  }

  // Preserve non-plain objects (Date, Buffer, etc.) untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_KEYS.has(key.toLowerCase())) continue;
    out[key] = strip(v, seen);
  }
  return out;
}

/** Returns a copy with credential headers/keys removed. Everything else is kept. */
export function sanitizeRequest(raw: unknown): unknown {
  return strip(raw, new WeakMap());
}

/** Same credential stripping as the request side. Seam for future redaction. */
export function sanitizeResponse(raw: unknown): unknown {
  return strip(raw, new WeakMap());
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const s = JSON.stringify(value, (_k, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    );
    return s ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Throws if the serialized value contains the current value of
 * OPENROUTER_API_KEY or TYPESAFE_API_KEY. Empty or unset variables are ignored.
 * The error names the variable, never the value.
 */
export function assertNoEnvLeak(value: unknown): void {
  const text = serialize(value);
  // Also check the JSON-escaped form, in case the secret contains escapable characters.
  for (const name of SECRET_ENV_VARS) {
    const secret = process.env[name];
    if (!secret) continue;
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (text.includes(secret) || text.includes(escaped)) {
      throw new Error(`Credential leak detected: value of ${name} found in output`);
    }
  }
}
