import { describe, expect, it } from 'vitest';
import {
  compileRedactPattern,
  InlineFlagError,
  RegexCompileError,
} from '../config/redact-pattern.js';
import { buildRedactedConfig } from '../config/redact.js';
import type { ConfigMeta } from '../config/load.js';
import type { EffectiveConfig } from '../config/schema.js';
import { collectSecretValues } from '../config/secrets.js';
import { redact, type RedactOptions } from './redact.js';

// Unit tests for the credential key rule and its false positives.
// **Validates: Requirements 5.2, 5.11, 5.13, 5.14, 11.8, 11.11**

const base: RedactOptions = { secrets: [], configuredPatterns: [], textKind: 'text' };

describe('Redactor false positives stay unchanged', () => {
  const unchanged = [
    'max_tokens: 4000',
    'tokenizer=cl100k_base',
    'showPassword=false',
    'secretary: abcdefghijkl',
    'SKIP_TOKEN_CHECK=true',
    'const token = getToken()',
    '{ accessToken: accessToken }',
    'nextPageToken = response.nextPageToken',
    'task-list-item-container',
    'risk-assessment-for-the-project',
    'npm_lifecycle_script',
    'npm_config_registry',
    'desk-lamp-description-text-long',
  ];

  it.each(unchanged)('leaves %j unchanged', (input) => {
    expect(redact(input, base)).toEqual({ text: input, count: 0 });
  });

  it('leaves a CSS custom property unchanged in a .css file', () => {
    const input = '--color-token: var(--brand-primary)';
    expect(redact(input, { ...base, extension: '.css' })).toEqual({ text: input, count: 0 });
  });
});

describe('Redactor credential key rule', () => {
  it('redacts a quoted password value', () => {
    const r = redact('password = "correcthorsebattery"', base);
    expect(r.text).not.toContain('correcthorsebattery');
    expect(r.count).toBeGreaterThan(0);
  });

  it('keeps the key and quotes, replacing only the value', () => {
    expect(redact('api_key = "Zq8vK2mXp9LrT4wB"', base).text).toBe('api_key = "[REDACTED]"');
  });
});

describe('Redactor and buildRedactedConfig agree on Secret_Variable values', () => {
  const meta: ConfigMeta = { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: {} };
  const envs: Record<string, string>[] = [
    { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'ts-bbb' },
    { STRIPE_API_KEY: 'sk_live_abcdef123456' },
    { STRIPE_API_KEY: 'REDACTED' },
    { OPENROUTER_API_KEY: 'RED' },
    { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'ts-bbb', STRIPE_API_KEY: 'REDACTED' },
  ];

  it.each(envs)('removes the same values for %j and is idempotent', (env) => {
    const values = collectSecretValues(env);
    const text = `x ${values.join(' ')} [REDACTED] ${values.join('')} end`;
    const config = { version: 0, output: { dir: text } } as unknown as EffectiveConfig;

    const built = buildRedactedConfig(config, meta, env);
    const dir = (built.config as unknown as { output: { dir: string } }).output.dir;
    const viaRedactor = redact(text, { ...base, secrets: values }).text;
    expect(viaRedactor).toBe(dir);

    const again = buildRedactedConfig(built.config, meta, env);
    expect(again.config).toEqual(built.config);
    expect(redact(viaRedactor, { ...base, secrets: values }).text).toBe(viaRedactor);
  });
});

describe('configured redact patterns', () => {
  it('rejects an invalid pattern with RegexCompileError', () => {
    expect(() => compileRedactPattern('(unclosed')).toThrow(RegexCompileError);
  });

  it('rejects an inline flag group with InlineFlagError', () => {
    expect(() => compileRedactPattern('(?i)token')).toThrow(InlineFlagError);
  });
});
