import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ConfigSource, LoadedConfig } from '../../config/load.js';
import { createJevGateway } from '../gateway.js';

const FAKE_KEY = 'sk-or-fake-key-for-tests';
const env = { OPENROUTER_API_KEY: FAKE_KEY };

function loadedWithModel(model: string, source: ConfigSource): LoadedConfig {
  const config = { jev: { provider: 'openrouter', model } } as never;
  const meta = {
    fileRead: null,
    fileIgnored: null,
    ignoredEnvNames: [],
    sources: { 'jev.provider': 'file', 'jev.model': source } as Record<string, ConfigSource>,
  };
  return { ok: true, config, meta, redacted: { config, meta } as never } as LoadedConfig;
}

/** Independent statement of the documented form: typesafe/<name> or ~typesafe/<name>. */
function matchesDocumentedForm(model: string): boolean {
  return /^~?typesafe\/[^\r\n\u2028\u2029]+$/.test(model);
}

const source = fc.constantFrom<ConfigSource>('flag', 'env', 'file');
const name = fc.stringMatching(/^[A-Za-z0-9._\-/~ ]{1,30}$/);

const accepted = fc.tuple(fc.constantFrom('typesafe/', '~typesafe/'), name).map(([p, n]) => p + n);

const nearMisses = fc.constantFrom(
  'jev-preview',
  'typesafe/',
  '~typesafe/',
  'typesafe',
  '~typesafe',
  '~~typesafe/jev',
  'Typesafe/jev-1.14',
  ' typesafe/jev-1.14',
  'x/typesafe/jev',
  'other/jev-1.14',
  'jev-1.14',
  '',
);

const rejected = fc
  .oneof(
    nearMisses,
    fc.string({ maxLength: 40 }),
    name.map((n) => `openai/${n}`),
    name.map((n) => `jev-preview${n}`),
  )
  .filter((m) => !matchesDocumentedForm(m));

describe('Property 5: OpenRouter model-form validation', () => {
  // Feature: jev-gateway, Property 5: OpenRouter model-form validation accepts and rejects by the documented pattern
  // **Validates: Requirements 4.8**
  it('accepts typesafe/<name> and ~typesafe/<name> for any configured source', () => {
    fc.assert(
      fc.property(accepted, source, (model, src) => {
        const result = createJevGateway(loadedWithModel(model, src), env);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.gateway.requestedModel).toBe(model);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: jev-gateway, Property 5: OpenRouter model-form validation accepts and rejects by the documented pattern
  // **Validates: Requirements 4.8**
  it('rejects every other string with a ValidationError naming the form and jev-preview', () => {
    fc.assert(
      fc.property(rejected, source, (model, src) => {
        const result = createJevGateway(loadedWithModel(model, src), env);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toHaveLength(1);
        const [error] = result.errors;
        expect(error?.path).toBe('jev.model');
        expect(error?.value).toBe(model);
        expect(error?.source).toBe(src);
        expect(error?.expected).toContain('typesafe/<name>');
        expect(error?.expected).toContain('~typesafe/<name>');
        expect(error?.expected).toContain('jev-preview');
        expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: jev-gateway, Property 5: OpenRouter model-form validation accepts and rejects by the documented pattern
  // **Validates: Requirements 4.8**
  it('rejects jev-preview explicitly', () => {
    const result = createJevGateway(loadedWithModel('jev-preview', 'file'), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('jev.model');
  });
});
