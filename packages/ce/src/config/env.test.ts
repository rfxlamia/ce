import { describe, expect, it } from 'vitest';
import { ENV_KEY_MAP, envNameForPath, readEnvSource } from './env.js';

describe('ENV_KEY_MAP name mapping (Requirements 5.7, 5.16)', () => {
  const expected: Record<string, string> = {
    CE_VERSION: 'version',
    CE_TARGET_URL: 'target.url',
    CE_TARGET_START: 'target.start',
    CE_TARGET_READY_PATH: 'target.ready.path',
    CE_TARGET_READY_TIMEOUT: 'target.ready.timeout',
    CE_TARGET_ROUTES: 'target.routes',
    CE_CONTEXT_BASE: 'context.base',
    CE_CONTEXT_INCLUDE: 'context.include',
    CE_CONTEXT_EXCLUDE: 'context.exclude',
    CE_CONTEXT_REDACT: 'context.redact',
    CE_CONTEXT_CHECKS: 'context.checks',
    CE_ASSESSMENT_THRESHOLDS_CLAIM: 'assessment.thresholds.claim',
    CE_ASSESSMENT_THRESHOLDS_OBSERVABLE: 'assessment.thresholds.observable',
    CE_ASSESSMENT_THRESHOLDS_ADEQUATE: 'assessment.thresholds.adequate',
    CE_ASSESSMENT_UNCERTAINTY_BAND: 'assessment.uncertainty-band',
    CE_ASSESSMENT_ON_UNCERTAIN: 'assessment.on-uncertain',
    CE_RUNTIME_MAX_STEPS: 'runtime.max-steps',
    CE_RUNTIME_TIMEOUT: 'runtime.timeout',
    CE_RUNTIME_VIEWPORT_WIDTH: 'runtime.viewport.width',
    CE_RUNTIME_VIEWPORT_HEIGHT: 'runtime.viewport.height',
    CE_JEV_PROVIDER: 'jev.provider',
    CE_JEV_MODEL: 'jev.model',
    CE_OUTPUT_DIR: 'output.dir',
    CE_OUTPUT_FAIL_ON: 'output.fail-on',
  };

  it('maps every schema key (except runtime.fixtures) to its CE_ name', () => {
    expect(Object.fromEntries(ENV_KEY_MAP)).toEqual(expected);
  });

  it('does not map runtime.fixtures or anything under it', () => {
    for (const path of ENV_KEY_MAP.values()) {
      expect(path.startsWith('runtime.fixtures')).toBe(false);
    }
    expect(ENV_KEY_MAP.has('CE_RUNTIME_FIXTURES')).toBe(false);
  });

  it('envNameForPath replaces dots and hyphens and upper-cases', () => {
    expect(envNameForPath('output.fail-on')).toBe('CE_OUTPUT_FAIL_ON');
    expect(envNameForPath('runtime.max-steps')).toBe('CE_RUNTIME_MAX_STEPS');
  });
});

describe('readEnvSource', () => {
  it('builds nested values from mapped names', () => {
    const { values, ignoredNames } = readEnvSource({
      CE_RUNTIME_MAX_STEPS: '12',
      CE_ASSESSMENT_THRESHOLDS_CLAIM: '0.7',
      CE_OUTPUT_FAIL_ON: 'error',
      CE_JEV_PROVIDER: 'typesafe',
      CE_RUNTIME_VIEWPORT_WIDTH: '800',
    });
    expect(values).toEqual({
      runtime: { 'max-steps': 12, viewport: { width: 800 } },
      assessment: { thresholds: { claim: 0.7 } },
      output: { 'fail-on': ['error'] },
      jev: { provider: 'typesafe' },
    });
    expect(ignoredNames).toEqual([]);
  });

  it('splits list values on commas and trims whitespace around items (5.8)', () => {
    const { values } = readEnvSource({
      CE_CONTEXT_INCLUDE: '  src/** ,\tdocs/**  ,lib/**',
      CE_OUTPUT_FAIL_ON: 'error , unsupported',
    });
    expect(values).toEqual({
      context: { include: ['src/**', 'docs/**', 'lib/**'] },
      output: { 'fail-on': ['error', 'unsupported'] },
    });
  });

  it('coerces numbers, including surrounding whitespace and decimals (5.9)', () => {
    const { values } = readEnvSource({
      CE_RUNTIME_MAX_STEPS: ' 30 ',
      CE_ASSESSMENT_UNCERTAINTY_BAND: '0.25',
    });
    expect(values).toEqual({
      runtime: { 'max-steps': 30 },
      assessment: { 'uncertainty-band': 0.25 },
    });
  });

  it('keeps durations and enums as strings (5.9)', () => {
    const { values } = readEnvSource({
      CE_RUNTIME_TIMEOUT: '120s',
      CE_ASSESSMENT_ON_UNCERTAIN: 'skip',
    });
    expect(values).toEqual({
      runtime: { timeout: '120s' },
      assessment: { 'on-uncertain': 'skip' },
    });
  });

  it('preserves un-coercible numeric text unchanged (5.10)', () => {
    const { values } = readEnvSource({
      CE_RUNTIME_MAX_STEPS: 'abc',
      CE_ASSESSMENT_THRESHOLDS_CLAIM: ' 0.5x ',
      CE_ASSESSMENT_THRESHOLDS_ADEQUATE: '',
      CE_ASSESSMENT_UNCERTAINTY_BAND: 'Infinity',
    });
    expect(values).toEqual({
      runtime: { 'max-steps': 'abc' },
      assessment: {
        thresholds: { claim: ' 0.5x ', adequate: '' },
        'uncertainty-band': 'Infinity',
      },
    });
  });

  it('ignores and lists unknown and fixtures-prefixed CE_ names (5.11, 5.16)', () => {
    const { values, ignoredNames } = readEnvSource({
      CE_UNKNOWN: 'x',
      CE_RUNTIME_FIXTURES_X: 'secret',
      CE_RUNTIME_FIXTURES: 'y',
      CE_RUNTIME_MAX_STEPS: '5',
    });
    expect(values).toEqual({ runtime: { 'max-steps': 5 } });
    expect(ignoredNames).toEqual(['CE_RUNTIME_FIXTURES', 'CE_RUNTIME_FIXTURES_X', 'CE_UNKNOWN']);
  });

  it('ignores non-CE_ variables silently (5.11)', () => {
    const { values, ignoredNames } = readEnvSource({
      PATH: '/usr/bin',
      OPENROUTER_API_KEY: 'k',
      ce_runtime_max_steps: '9',
      NOT_CE_X: '1',
    });
    expect(values).toEqual({});
    expect(ignoredNames).toEqual([]);
  });

  it('skips variables whose value is undefined', () => {
    const { values, ignoredNames } = readEnvSource({
      CE_RUNTIME_MAX_STEPS: undefined,
      CE_UNKNOWN: undefined,
    });
    expect(values).toEqual({});
    expect(ignoredNames).toEqual([]);
  });
});
