import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from './defaults.js';
import type { ConfigMeta } from './load.js';
import { REDACTED as REDACTED_FROM_REDACT, buildRedactedConfig } from './redact.js';
import type { EffectiveConfig } from './schema.js';
import { REDACTED, collectSecretValues, redactSecretValues } from './secrets.js';

// Feature: ce-context-resolver, Property 16: config/secrets.ts gives buildRedactedConfig and the Redactor the same secret set
// **Validates: Requirements 13.1, 13.2, 13.4, 11.11**

const meta: ConfigMeta = { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: {} };

const NAMES = [
  'OPENROUTER_API_KEY',
  'TYPESAFE_API_KEY',
  'STRIPE_API_KEY',
  'GITHUB_TOKEN',
  'DB_PASSWORD',
  'HOME',
] as const;

const valueArb = fc.oneof(
  fc.constantFrom('REDACTED', 'RED', 'k', 'ts-bbb', '[REDACTED]', 'ACTED]', '[RED'),
  fc.stringMatching(/^[A-Za-z0-9_\-[\]]{1,24}$/),
);
const envArb = fc.dictionary(fc.constantFrom(...NAMES), valueArb);
const pieceArb = fc.oneof(valueArb, fc.constantFrom('', ' ', '/', 'x', REDACTED));

function configWith(text: string): EffectiveConfig {
  return {
    ...ConfigDefaults,
    jev: { provider: 'openrouter', model: text },
    context: { include: [text] },
  } as EffectiveConfig;
}

function viaBuild(text: string, env: Record<string, string | undefined>): string {
  const model = buildRedactedConfig(configWith(text), meta, env).config.jev?.model;
  return model as string;
}

describe('Property 16: shared secret set', () => {
  it('re-exports the same REDACTED constant', () => {
    expect(REDACTED_FROM_REDACT).toBe(REDACTED);
  });

  it('redactSecretValues is idempotent and buildRedactedConfig agrees with collectSecretValues', () => {
    fc.assert(
      fc.property(envArb, fc.array(pieceArb, { maxLength: 8 }), (env, pieces) => {
        const secrets = collectSecretValues(env);
        const text = [...pieces, ...Object.values(env)].join('');

        const once = redactSecretValues(text, secrets);
        expect(redactSecretValues(once, secrets)).toBe(once);

        expect(viaBuild(text, env)).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it('example: OPENROUTER_API_KEY "k" and TYPESAFE_API_KEY "ts-bbb"', () => {
    const env = { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'ts-bbb' };
    expect(collectSecretValues(env)).toEqual(['ts-bbb', 'k']);
    const text = 'a k ts-bbb [REDACTED]k';
    const once = redactSecretValues(text, collectSecretValues(env));
    expect(once).toBe('a [REDACTED] [REDACTED] [REDACTED][REDACTED]');
    expect(redactSecretValues(once, collectSecretValues(env))).toBe(once);
    expect(viaBuild(text, env)).toBe(once);
  });

  it('example: values overlapping the marker (REDACTED, RED) terminate and stay idempotent', () => {
    const env = { OPENROUTER_API_KEY: 'REDACTED', TYPESAFE_API_KEY: 'RED' };
    const secrets = collectSecretValues(env);
    const text = 'REDACTED RED [REDACTED] [RED]';
    const once = redactSecretValues(text, secrets);
    expect(redactSecretValues(once, secrets)).toBe(once);
    expect(viaBuild(text, env)).toBe(once);
  });

  it('example: STRIPE_API_KEY is secret in both consumers', () => {
    const env = { STRIPE_API_KEY: 'sk_live_abcdef123456' };
    expect(collectSecretValues(env)).toEqual(['sk_live_abcdef123456']);
    const text = 'key=sk_live_abcdef123456';
    expect(viaBuild(text, env)).toBe(`key=${REDACTED}`);
    expect(viaBuild(text, env)).toBe(redactSecretValues(text, collectSecretValues(env)));
  });
});
