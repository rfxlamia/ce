import { describe, expect, expectTypeOf, it } from 'vitest';
import { loadConfig, requireJevCredentials } from '../index.js';
import type { ConfigMeta, EffectiveConfig, LoadedConfig } from '../index.js';

describe('public API', () => {
  it('exports loadConfig and requireJevCredentials as functions', () => {
    expect(typeof loadConfig).toBe('function');
    expect(typeof requireJevCredentials).toBe('function');
  });

  it('exports the EffectiveConfig, ConfigMeta and LoadedConfig types', () => {
    expectTypeOf<EffectiveConfig>().toBeObject();
    expectTypeOf<ConfigMeta>().toBeObject();
    expectTypeOf<LoadedConfig>().toBeObject();
    expectTypeOf<LoadedConfig['config']>().not.toBeAny();
    expectTypeOf<LoadedConfig['meta']>().toEqualTypeOf<ConfigMeta>();
  });
});
