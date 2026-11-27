import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ce from './index.js';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

// Runtime exports of index.ts at HEAD before the run-vertical-slice change.
const ORIGINAL_VALUE_EXPORTS = [
  'VERSION',
  'run',
  'loadConfig',
  'requireJevCredentials',
  'createJevGateway',
  'FakeJevGateway',
  'FakeRecordingMissingError',
  'JevImageError',
  'JevUsageError',
  'RateLimitError',
  'StageError',
  'resolveOutcome',
  'exitCodeFor',
  'OUTCOMES',
] as const;

// Type-only exports at HEAD. They are erased at runtime, so check the source.
const ORIGINAL_TYPE_EXPORTS = [
  'RunResult',
  'ConfigMeta',
  'LoadedConfig',
  'EffectiveConfig',
  'AskOptions',
  'JevGateway',
  'Outcome',
  'ExecutionOutcome',
  'Resolution',
  'ResolveInput',
] as const;

describe('index.ts stub removal', () => {
  it('no longer contains the TODO(Milestone 1) marker', () => {
    expect(source).not.toContain('TODO(Milestone 1)');
  });

  it('no longer contains the placeholder error text', () => {
    expect(source).not.toContain('CE v0 implementation spike: not implemented yet');
  });

  it.each(ORIGINAL_VALUE_EXPORTS)('still exports %s', (name) => {
    expect(ce).toHaveProperty(name);
    expect((ce as Record<string, unknown>)[name]).toBeDefined();
  });

  it('still exports run as a function', () => {
    expect(typeof ce.run).toBe('function');
  });

  it.each(ORIGINAL_TYPE_EXPORTS)('still exports type %s', (name) => {
    expect(source).toMatch(new RegExp(`\\b${name}\\b`));
  });
});
