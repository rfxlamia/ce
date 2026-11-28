import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePublishSettings, validatePublishMode } from './publish.js';
import { buildChildInvocation } from './inputs.js';

describe('validatePublishMode (Requirements 12.2, 12.3, 12.4, 15.8)', () => {
  it('maps an empty value to none', () => {
    expect(validatePublishMode('')).toBe('none');
  });

  it('accepts none', () => {
    expect(validatePublishMode('none')).toBe('none');
  });

  it('accepts branch', () => {
    expect(validatePublishMode('branch')).toBe('branch');
  });

  it('rejects an invalid value and lists the allowed values', () => {
    for (const bad of ['nope', 'None', 'BRANCH', ' branch', 'push']) {
      let message = '';
      try {
        validatePublishMode(bad);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('publish: invalid value');
      expect(message).toContain('none');
      expect(message).toContain('branch');
      expect(message).not.toContain('not implemented');
    }
  });
});

describe('publish default does not override ce.yml (review finding)', () => {
  const withYml = (yml: string, run: (cwd: string) => void): void => {
    const cwd = mkdtempSync(join(tmpdir(), 'ce-pub-'));
    try {
      writeFileSync(join(cwd, 'ce.yml'), yml);
      run(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
  const settings = (cwd: string, env: Record<string, string>) =>
    resolvePublishSettings({ cwd, flags: {}, env }, validatePublishMode(env['CE_PUBLISH'] ?? ''));

  it('an empty input sends no CE_PUBLISH and ce.yml publish: branch wins', () => {
    const { env } = buildChildInvocation({ getInput: () => '' });
    expect(env).not.toHaveProperty('CE_PUBLISH');
    withYml('publish: branch\n', (cwd) => expect(settings(cwd, env).mode).toBe('branch'));
  });

  it('an explicit none still wins over ce.yml publish: branch', () => {
    const { env } = buildChildInvocation({ getInput: (n) => (n === 'publish' ? 'none' : '') });
    expect(env['CE_PUBLISH']).toBe('none');
    withYml('publish: branch\n', (cwd) => expect(settings(cwd, env).mode).toBe('none'));
  });
});
