import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from './defaults.js';
import { ConfigSchema } from './schema.js';

describe('ConfigDefaults: values (Requirement 2.1)', () => {
  it('sets version to 0', () => {
    expect(ConfigDefaults.version).toBe(0);
  });

  it('sets assessment defaults', () => {
    expect(ConfigDefaults.assessment).toEqual({
      thresholds: { claim: 0.6, observable: 0.6, adequate: 0.7 },
      'uncertainty-band': 0.1,
      'on-uncertain': 'evidence',
    });
  });

  it('sets runtime defaults', () => {
    expect(ConfigDefaults.runtime?.['max-steps']).toBe(12);
    expect(ConfigDefaults.runtime?.timeout).toBe('90s');
    expect(ConfigDefaults.runtime?.viewport).toEqual({ width: 1280, height: 800 });
  });

  it('sets jev defaults', () => {
    expect(ConfigDefaults.jev).toEqual({
      provider: 'openrouter',
      model: 'typesafe/jev-1.14',
    });
  });

  it('sets output defaults', () => {
    expect(ConfigDefaults.output).toEqual({ dir: '.ce/runs', 'fail-on': ['error'] });
  });

});

describe('publish keys: schema boundaries (Requirements 1.2, 1.7, 8.3, 8.8)', () => {
  const ok = (cfg: object) => ConfigSchema.safeParse(cfg).success;

  it('accepts none and branch and rejects other values', () => {
    expect(ok({ publish: 'none' })).toBe(true);
    expect(ok({ publish: 'branch' })).toBe(true);
    expect(ok({ publish: 'tag' })).toBe(false);
  });

  it('bounds publish-max-images to integers 1..50', () => {
    for (const v of [1, 50]) expect(ok({ 'publish-max-images': v })).toBe(true);
    for (const v of [0, 51, 1.5]) expect(ok({ 'publish-max-images': v })).toBe(false);
  });

  it('bounds publish-max-image-bytes to integers 1..20971520', () => {
    for (const v of [1, 20971520]) expect(ok({ 'publish-max-image-bytes': v })).toBe(true);
    for (const v of [0, 20971521, 2.5]) expect(ok({ 'publish-max-image-bytes': v })).toBe(false);
  });

  it('still rejects a token key', () => {
    expect(ok({ token: 'x' })).toBe(false);
  });
});

describe('ConfigDefaults: keys without a default (Requirement 2.2)', () => {
  it('leaves target, context and runtime.fixtures undefined', () => {
    expect(ConfigDefaults.target).toBeUndefined();
    expect(ConfigDefaults.context).toBeUndefined();
    expect(ConfigDefaults.runtime?.fixtures).toBeUndefined();
  });
});

describe('ConfigDefaults: schema conformance (Requirement 2.3)', () => {
  it('passes ConfigSchema validation', () => {
    expect(ConfigSchema.safeParse(ConfigDefaults).success).toBe(true);
  });
});
