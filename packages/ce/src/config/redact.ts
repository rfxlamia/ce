import type { ConfigMeta, RedactedConfig } from './load.js';
import { compileRedactPattern } from './redact-pattern.js';
import type { EffectiveConfig } from './schema.js';

export type { RedactedConfig } from './load.js';

export const REDACTED = '[REDACTED]';

/** Environment variables whose values are Secrets (Requirement 7). */
const CREDENTIAL_ENV_NAMES = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'] as const;

const CREDENTIAL_ENV_BY_PROVIDER = {
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
} as const;

function collectStringLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringLeaves(item, out);
  }
}

function compilePatterns(config: EffectiveConfig): RegExp[] {
  const items = config.context?.redact ?? [];
  const patterns: RegExp[] = [];
  for (const item of items) {
    try {
      const re = compileRedactPattern(item);
      const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
      patterns.push(new RegExp(re.source, flags.replace('y', '')));
    } catch {
      // Validated by the schema already; an uncompilable pattern adds no secrets.
    }
  }
  return patterns;
}

function collectSecrets(
  config: EffectiveConfig,
  env: Record<string, string | undefined>,
): string[] {
  const secrets = new Set<string>();

  for (const name of CREDENTIAL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) secrets.add(value);
  }

  const patterns = compilePatterns(config);
  if (patterns.length > 0) {
    const leaves: string[] = [];
    collectStringLeaves(config, leaves);
    for (const leaf of leaves) {
      for (const re of patterns) {
        for (const match of leaf.matchAll(re)) {
          if (match[0] !== '') secrets.add(match[0]);
        }
      }
    }
  }

  return [...secrets].sort((a, b) => b.length - a.length);
}

function redactString(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    result = result.split(secret).join(REDACTED);
  }
  return result;
}

function redactDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactDeep(item, secrets);
    }
    return out;
  }
  return value;
}

/**
 * Build the secret-free Redacted_Config: a deep clone of `config` with every
 * Secret substring replaced by `[REDACTED]`, plus `meta` as a sibling key.
 * Pure: writes no file and does not mutate its inputs. Idempotent.
 * `jev.provider` stays in `config`; the credential variable name is derivable
 * from it by consumers. `credentials` records the provider and the credential
 * variable name (Requirement 7.5), never its value.
 */
export function buildRedactedConfig(
  config: EffectiveConfig,
  meta: ConfigMeta,
  env: Record<string, string | undefined>,
): RedactedConfig {
  const secrets = collectSecrets(config, env);
  const provider = config.jev?.provider ?? 'openrouter';
  return {
    config: redactDeep(config, secrets) as EffectiveConfig,
    meta: JSON.parse(JSON.stringify(meta)) as ConfigMeta,
    credentials: { provider, envVar: CREDENTIAL_ENV_BY_PROVIDER[provider] },
  };
}
