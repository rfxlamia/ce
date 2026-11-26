import { CREDENTIAL_KEY_NAME_PATTERN } from './schema.js';

export const REDACTED = '[REDACTED]';

const ALWAYS_SECRET = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'] as const;
const API_KEY_NAME_PATTERN = /api[-_]key/i;
const MIN_PATTERN_VALUE_LENGTH = 8;
const DENY_LIST = new Set([
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'null',
  'undefined',
  'none',
]);

/**
 * Secret values found in `env`, trimmed, without duplicates, longest first.
 * The two provider keys are always secret when non-empty. Other variables
 * whose name looks like a credential count only when the value is long enough,
 * not purely digits, and not a common flag word.
 */
export function collectSecretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  const found = new Set<string>();
  for (const name of ALWAYS_SECRET) {
    const value = env[name]?.trim();
    if (value) found.add(value);
  }
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined) continue;
    if (!CREDENTIAL_KEY_NAME_PATTERN.test(name) && !API_KEY_NAME_PATTERN.test(name)) continue;
    const value = raw.trim();
    if (value.length < MIN_PATTERN_VALUE_LENGTH) continue;
    if (/^\d+$/.test(value)) continue;
    if (DENY_LIST.has(value.toLowerCase())) continue;
    found.add(value);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_PASSES = 32;

/**
 * Replace every secret with `[REDACTED]`. A single scan matches either an
 * existing marker (kept as is, so markers are atomic) or a secret (replaced).
 * Repeats until the text stops changing, with an iteration guard.
 */
export function redactSecretValues(text: string, secrets: readonly string[]): string {
  const ordered = [...new Set(secrets.filter((s) => s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (ordered.length === 0) return text;
  const pattern = new RegExp(
    [escapeRegExp(REDACTED), ...ordered.map(escapeRegExp)].join('|'),
    'g',
  );
  let current = text;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = current.replace(pattern, (match) => (match === REDACTED ? match : REDACTED));
    if (next === current) return current;
    current = next;
  }
  return current;
}
