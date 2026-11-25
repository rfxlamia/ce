import { ConfigDefaults } from './defaults.js';
import type { ValidationError } from './errors.js';
import type { LoadedConfig } from './load.js';

const KEY_NAME = {
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
} as const;

/**
 * Credential_Check: verifies the API key for the selected Jev provider is
 * present. Reads only the already-loaded config and the given env. Only the
 * presence of the key is checked; its value never enters an error.
 */
export function requireJevCredentials(
  loaded: LoadedConfig,
  env: Record<string, string | undefined>,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const provider = loaded.config.jev?.provider ?? ConfigDefaults.jev?.provider ?? 'openrouter';
  const source = loaded.meta.sources['jev.provider'] ?? 'default';
  const keyName = KEY_NAME[provider];

  const present = (env[keyName] ?? '').trim() !== '';
  if (present) return { ok: true };

  return {
    ok: false,
    errors: [
      {
        path: 'jev.provider',
        value: provider,
        expected: `environment variable ${keyName} set to a non-empty value (required for jev.provider "${provider}")`,
        source,
      },
    ],
  };
}
