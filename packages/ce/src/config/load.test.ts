import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDefaults } from './defaults.js';
import { reportConfigFailure } from './errors.js';
import { loadConfig } from './load.js';
import type { LoadConfigResult, LoadFailure, LoadedConfig } from './load.js';

const fsState = vi.hoisted(() => ({ failRead: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (fsState.failRead) {
      throw Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES' });
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-load-'));
  fsState.failRead = false;
});

afterEach(() => {
  fsState.failRead = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

function load(
  opts: { flags?: Record<string, unknown>; env?: Record<string, string | undefined> } = {},
): LoadConfigResult {
  return loadConfig({ cwd: dir, flags: opts.flags ?? {}, env: opts.env ?? {} });
}

function ok(result: LoadConfigResult): LoadedConfig {
  if (!result.ok) throw new Error(`expected success: ${JSON.stringify(result)}`);
  return result;
}

function errorsOf(result: LoadConfigResult): Array<Record<string, unknown>> {
  if (result.ok || !('errors' in result)) throw new Error('expected errors result');
  return result.errors as unknown as Array<Record<string, unknown>>;
}

describe('precedence (Requirements 5.2-5.4, 9.1)', () => {
  it('flag beats env', () => {
    const loaded = ok(
      load({ flags: { 'runtime.max-steps': 3 }, env: { CE_RUNTIME_MAX_STEPS: '5' } }),
    );
    expect(loaded.config.runtime?.['max-steps']).toBe(3);
    expect(loaded.meta.sources['runtime.max-steps']).toBe('flag');
  });

  it('env beats file', () => {
    write('ce.yml', 'runtime:\n  max-steps: 7\n');
    const loaded = ok(load({ env: { CE_RUNTIME_MAX_STEPS: '5' } }));
    expect(loaded.config.runtime?.['max-steps']).toBe(5);
    expect(loaded.meta.sources['runtime.max-steps']).toBe('env');
  });

  it('file beats default', () => {
    write('ce.yml', 'runtime:\n  max-steps: 7\n');
    const loaded = ok(load());
    expect(loaded.config.runtime?.['max-steps']).toBe(7);
    expect(loaded.meta.sources['runtime.max-steps']).toBe('file');
    expect(loaded.meta.sources['runtime.timeout']).toBe('default');
  });
});

describe('defaults (Requirements 2.4, 9.9)', () => {
  it('returns the defaults with empty env and no file', () => {
    expect(ok(load()).config).toEqual(ConfigDefaults);
  });

  it.each([
    { OPENROUTER_API_KEY: 'sk-or-aaa' },
    { TYPESAFE_API_KEY: 'ts-bbb' },
    { OPENROUTER_API_KEY: 'sk-or-aaa', TYPESAFE_API_KEY: 'ts-bbb' },
  ])('returns the defaults with provider keys set %#', (env) => {
    expect(ok(load({ env })).config).toEqual(ConfigDefaults);
  });
});

describe('effective and redacted config (Requirements 7.1, 7.5, 9.7)', () => {
  it('keeps meta out of config and Secrets out of redacted', () => {
    const secret = 'sk-or-super-secret-value';
    const loaded = ok(load({ env: { OPENROUTER_API_KEY: secret } }));
    expect('meta' in loaded.config).toBe(false);
    expect(loaded.redacted.meta.sources['jev.provider']).toBe('default');
    expect(JSON.stringify(loaded.redacted)).not.toContain(secret);
  });

  it('records the provider and credential variable name, not the value', () => {
    const secret = 'ts-another-secret';
    const loaded = ok(
      load({ flags: { 'jev.provider': 'typesafe' }, env: { TYPESAFE_API_KEY: secret } }),
    );
    expect(loaded.redacted.config.jev?.provider).toBe('typesafe');
    expect(loaded.redacted.credentials).toEqual({
      provider: 'typesafe',
      envVar: 'TYPESAFE_API_KEY',
    });
    expect(JSON.stringify(loaded.redacted)).not.toContain(secret);
  });
});

describe('runtime.fixtures (Requirements 5.15-5.17, 9.4)', () => {
  it('accepts fixtures in the file', () => {
    write('ce.yml', 'runtime:\n  fixtures:\n    user: alice\n');
    const loaded = ok(load());
    expect(loaded.config.runtime?.fixtures).toEqual({ user: 'alice' });
  });

  it('ignores CE_RUNTIME_FIXTURES_X and lists it in meta', () => {
    const loaded = ok(load({ env: { CE_RUNTIME_FIXTURES_X: 'v' } }));
    expect(loaded.config.runtime?.fixtures).toBeUndefined();
    expect(loaded.meta.ignoredEnvNames).toContain('CE_RUNTIME_FIXTURES_X');
  });

  it('rejects fixtures in flags', () => {
    const result = load({ flags: { 'runtime.fixtures': { a: 1 } } });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatchObject([{ path: 'runtime.fixtures', source: 'flag' }]);
  });
});

describe('Config_Flag (Requirements 4.11-4.16, 9.8)', () => {
  it('(a) reads only the --config file; ce.yml is neither read nor listed as ignored', () => {
    write('ce.yml', 'runtime:\n  max-steps: 2\n');
    write('.ce.yml', 'runtime:\n  max-steps: 3\n');
    const other = write('other.yml', 'runtime:\n  max-steps: 9\n');
    const loaded = ok(load({ flags: { config: other } }));
    expect(loaded.config.runtime?.['max-steps']).toBe(9);
    expect(loaded.meta.fileRead).toBe(other);
    expect(loaded.meta.fileIgnored).toBeNull();
  });

  it('(b) a missing --config file fails without falling back to ce.yml', () => {
    write('ce.yml', 'runtime:\n  max-steps: 2\n');
    const result = load({ flags: { config: ' missing/none.yml ' } });
    expect(result.ok).toBe(false);
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'config', value: ' missing/none.yml ', source: 'flag' });
    expect(String(errors[0]?.expected)).toContain(' missing/none.yml ');

    let stderr = '';
    const code = reportConfigFailure(result as LoadFailure, [], {
      write: (t) => (stderr += t),
    });
    expect(code).toBe(1);
    expect(stderr).toContain('missing/none.yml');
    expect(stderr).not.toContain('max-steps');
  });

  it('(c) resolves a relative --config against cwd, not process.cwd()', () => {
    const p = write('rel.yml', 'runtime:\n  max-steps: 4\n');
    expect(path.resolve(process.cwd())).not.toBe(path.resolve(dir));
    const loaded = ok(load({ flags: { config: 'rel.yml' } }));
    expect(loaded.meta.fileRead).toBe(p);
    expect(loaded.config.runtime?.['max-steps']).toBe(4);
  });

  it.each(['', '   '])('(d) rejects empty or whitespace --config %j', (flag) => {
    write('ce.yml', 'runtime:\n  max-steps: 2\n');
    const result = load({ flags: { config: flag } });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatchObject([{ path: 'config', value: flag, source: 'flag' }]);
  });
});

describe('error reporting (Requirements 6.1, 6.4, 6.8)', () => {
  it('reports several violations together, sorted by path', () => {
    write(
      'ce.yml',
      [
        'runtime:',
        '  max-steps: -1',
        'output:',
        '  dir: 5',
        'assessment:',
        '  on-uncertain: maybe',
        'jev:',
        '  provider: nope',
        '',
      ].join('\n'),
    );
    const result = load();
    expect(result.ok).toBe(false);
    const paths = errorsOf(result).map((e) => String(e.path));
    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(
      expect.arrayContaining([
        'runtime.max-steps',
        'output.dir',
        'assessment.on-uncertain',
        'jev.provider',
      ]),
    );
  });
});

describe('file errors (Requirements 6.9, 6.19, 6.20, 9.16)', () => {
  it('returns a read fileError for EACCES', () => {
    const file = write('ce.yml', 'version: 0\n');
    fsState.failRead = true;
    const result = load();
    fsState.failRead = false;
    expect(result.ok).toBe(false);
    expect('errors' in result).toBe(false);
    const fileError = (result as unknown as { fileError: Record<string, unknown> }).fileError;
    expect(fileError).toMatchObject({ kind: 'read', code: 'EACCES', file });
    expect('path' in fileError).toBe(false);
  });

  it('returns a parse fileError for malformed YAML and exits with 1', () => {
    write('ce.yml', 'runtime: [1, 2\nother: 3\n');
    const result = load();
    expect(result.ok).toBe(false);
    expect('errors' in result).toBe(false);
    const fileError = (result as unknown as { fileError: Record<string, unknown> }).fileError;
    expect(fileError.kind).toBe('parse');
    expect(String(fileError.file)).toContain('ce.yml');
    for (const key of ['path', 'value', 'expected']) expect(key in fileError).toBe(false);
    expect(reportConfigFailure(result as LoadFailure, [], { write: () => undefined })).toBe(1);
  });
});

describe('purity (Requirement 8.3)', () => {
  it('does not read process.env or process.cwd() when env and cwd are given', () => {
    write('ce.yml', 'version: 0\n');
    const original = Object.getOwnPropertyDescriptor(process, 'env')!;
    const cwdSpy = vi.spyOn(process, 'cwd');
    // Third-party libraries (yaml) may read process.env themselves; count only
    // reads whose call stack passes through this package's config sources.
    let envReads = 0;
    Object.defineProperty(process, 'env', {
      configurable: true,
      get() {
        const stack = new Error().stack ?? '';
        const caller = stack.split('\n').filter((line) => line.includes('    at '))[1] ?? '';
        const own = /\/src\/config\/[^/]+\.ts/.test(caller);
        if (own) envReads++;
        return original.value as NodeJS.ProcessEnv;
      },
    });
    try {
      const result = load({ env: { CE_RUNTIME_MAX_STEPS: '4' } });
      expect(result.ok).toBe(true);
    } finally {
      Object.defineProperty(process, 'env', original);
      cwdSpy.mockRestore();
    }
    expect(envReads).toBe(0);
    expect(cwdSpy).not.toHaveBeenCalled();
  });
});
