import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigSource, LoadedConfig } from '../../config/load.js';

vi.mock('../transport-sdk.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transport-sdk.js')>();
  return { ...actual, createSdkTransport: vi.fn(actual.createSdkTransport) };
});
vi.mock('../transport-json.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transport-json.js')>();
  return { ...actual, createJsonTransport: vi.fn(actual.createJsonTransport) };
});

import { createJevGateway } from '../gateway.js';
import { createJsonTransport } from '../transport-json.js';
import { createSdkTransport } from '../transport-sdk.js';

type Provider = 'openrouter' | 'typesafe';

const KEY_NAMES: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
};

function loaded(provider: Provider, model: string | undefined, source: ConfigSource): LoadedConfig {
  const config = { jev: { provider, ...(model === undefined ? {} : { model }) } } as never;
  const meta = {
    fileRead: null,
    fileIgnored: null,
    ignoredEnvNames: [],
    sources: { 'jev.provider': source, 'jev.model': 'default' } as Record<string, ConfigSource>,
  };
  return { ok: true, config, meta, redacted: { config, meta } as never } as LoadedConfig;
}

const provider = fc.constantFrom<Provider>('openrouter', 'typesafe');
const source = fc.constantFrom<ConfigSource>('flag', 'env', 'file', 'default');
// Missing means: unset, empty, or whitespace-only.
const missing = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant<string | undefined>(''),
  fc.stringMatching(/^[ \t\r\n]{1,8}$/) as fc.Arbitrary<string | undefined>,
);
// A recognisable secret for the other provider's key; must never be echoed.
const otherSecret = fc.stringMatching(/^[A-Za-z0-9]{12,24}$/).map((s) => `sk-secret-${s}`);
const unrelated = fc.dictionary(
  fc.stringMatching(/^CE_UNRELATED_[A-Z]{1,8}$/),
  fc.stringMatching(/^[a-z0-9]{0,10}$/),
  { maxKeys: 4 },
);

describe('Property 6: missing-credential failures name the correct variable only', () => {
  beforeEach(() => {
    vi.mocked(createSdkTransport).mockClear();
    vi.mocked(createJsonTransport).mockClear();
  });

  // Feature: jev-gateway, Property 6: Missing-credential failures always name the correct variable and only that variable
  // **Validates: Requirements 5.2, 5.4, 5.5, 5.6**
  it('names exactly the selected provider variable, builds no transport, leaks no key', () => {
    fc.assert(
      fc.property(
        provider,
        source,
        missing,
        fc.option(otherSecret, { nil: undefined }),
        unrelated,
        (p, src, selectedValue, otherValue, extra) => {
          vi.mocked(createSdkTransport).mockClear();
          vi.mocked(createJsonTransport).mockClear();

          const other: Provider = p === 'openrouter' ? 'typesafe' : 'openrouter';
          const env: Record<string, string | undefined> = { ...extra };
          env[KEY_NAMES[p]] = selectedValue;
          env[KEY_NAMES[other]] = otherValue;

          const result = createJevGateway(loaded(p, undefined, src), env);

          expect(result.ok).toBe(false);
          if (result.ok) return;

          const text = JSON.stringify(result.errors);
          expect(text).toContain(KEY_NAMES[p]);
          expect(text).not.toContain(KEY_NAMES[other]);
          if (otherValue !== undefined) expect(text).not.toContain(otherValue);
          for (const [name, value] of Object.entries(extra)) {
            if (value.length >= 4) expect(text).not.toContain(value);
            expect(text).not.toContain(name);
          }

          expect(createSdkTransport).not.toHaveBeenCalled();
          expect(createJsonTransport).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
