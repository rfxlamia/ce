import type { EffectiveConfig } from './schema.js';

/**
 * Config_Defaults: the lowest-precedence config source.
 * Keys with no default (target.*, context.*, runtime.fixtures) are omitted.
 */
export const ConfigDefaults: EffectiveConfig = {
  version: 0,
  assessment: {
    thresholds: { claim: 0.6, observable: 0.6, adequate: 0.7 },
    'uncertainty-band': 0.1,
    'on-uncertain': 'evidence',
  },
  runtime: {
    'max-steps': 12,
    timeout: '90s',
    viewport: { width: 1280, height: 800 },
  },
  jev: {
    provider: 'openrouter',
    model: 'typesafe/jev-1.14',
  },
  output: {
    dir: '.ce/runs',
    'fail-on': ['error'],
  },
};
