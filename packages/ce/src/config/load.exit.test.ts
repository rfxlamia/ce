import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireJevCredentials } from './credentials.js';
import { formatFileError, reportConfigFailure } from './errors.js';
import { loadConfig } from './load.js';
import type { LoadFailure } from './load.js';

const fsState = vi.hoisted(() => ({ failRead: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    // Only fail reads of the config file under test; leave other readers
    // (vitest internals, lazy module loads) untouched.
    if (fsState.failRead && /[\\/]ce-exit-[^\\/]+[\\/]/.test(String(args[0]))) {
      throw Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES' });
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-exit-'));
  fsState.failRead = false;
});

afterEach(() => {
  fsState.failRead = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeStderr(): { chunks: string[]; write(text: string): void; text(): string } {
  const chunks: string[] = [];
  return {
    chunks,
    write: (t: string) => {
      chunks.push(t);
    },
    text: () => chunks.join(''),
  };
}

const FAIL_ON: Array<{ label: string; list: string[] }> = [
  { label: '[]', list: [] },
  { label: '[error]', list: ['error'] },
  { label: '[unsupported]', list: ['unsupported'] },
];

function expectFailure(result: ReturnType<typeof loadConfig>): LoadFailure {
  expect(result.ok).toBe(false);
  return result as LoadFailure;
}

describe.each(FAIL_ON)('output.fail-on $label', ({ list }) => {
  it('invalid config from the file: report on stderr, exit code 1', () => {
    const yaml = `output:\n  fail-on: [${list.join(', ')}]\nruntime:\n  max-steps: -1\n`;
    fs.writeFileSync(path.join(dir, 'ce.yml'), yaml);
    const failure = expectFailure(loadConfig({ cwd: dir, flags: {}, env: {} }));
    expect('errors' in failure).toBe(true);
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [], stderr)).toBe(1);
    expect(stderr.text()).toContain('runtime.max-steps');
  });

  it('invalid config from flags: report on stderr, exit code 1', () => {
    const failure = expectFailure(
      loadConfig({
        cwd: dir,
        flags: { 'output.fail-on': list, 'runtime.max-steps': -1 },
        env: {},
      }),
    );
    expect('errors' in failure).toBe(true);
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [], stderr)).toBe(1);
    expect(stderr.text()).toContain('runtime.max-steps');
  });

  it('invalid config from env: report on stderr, exit code 1', () => {
    const failure = expectFailure(
      loadConfig({
        cwd: dir,
        flags: {},
        env: { CE_OUTPUT_FAIL_ON: list.join(','), CE_RUNTIME_MAX_STEPS: 'abc' },
      }),
    );
    expect('errors' in failure).toBe(true);
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [], stderr)).toBe(1);
    expect(stderr.text()).toContain('runtime.max-steps');
    expect(stderr.text()).toContain('abc');
  });

  it('Credential_Check failure: report on stderr, exit code 1', () => {
    const loaded = loadConfig({ cwd: dir, flags: { 'output.fail-on': list }, env: {} });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const check = requireJevCredentials(loaded, {});
    expect(check.ok).toBe(false);
    if (check.ok) return;
    const stderr = fakeStderr();
    expect(reportConfigFailure(check, [], stderr)).toBe(1);
    expect(stderr.text()).toContain('OPENROUTER_API_KEY');
    expect(stderr.text()).toContain('jev.provider');
  });

  it('malformed YAML: file error text on stderr, exit code 1', () => {
    const file = path.join(dir, 'ce.yml');
    fs.writeFileSync(file, `output:\n  fail-on: [${list.join(', ')}]\nruntime: [1, 2\nother: 3\n`);
    const failure = expectFailure(loadConfig({ cwd: dir, flags: {}, env: {} }));
    expect('fileError' in failure).toBe(true);
    expect('errors' in failure).toBe(false);
    if (!('fileError' in failure)) return;
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [], stderr)).toBe(1);
    const out = stderr.text();
    expect(out.trimEnd()).toBe(formatFileError(failure.fileError).trimEnd());
    expect(out).toContain('ce.yml');
    expect(out).toContain(failure.fileError.code);
    expect(out).not.toMatch(/value:|expected:/);
    expect(out).not.toContain('path');
    expect(out).not.toContain('runtime: [1, 2');
    expect(out).not.toContain('other: 3');
    expect(out.trimEnd()).not.toContain('\n');
  });

  it('unreadable file (EACCES): file error text on stderr, exit code 1', () => {
    fs.writeFileSync(path.join(dir, 'ce.yml'), 'version: 0\n');
    fsState.failRead = true;
    let failure: LoadFailure;
    try {
      failure = expectFailure(
        loadConfig({ cwd: dir, flags: { 'output.fail-on': list }, env: {} }),
      );
    } finally {
      fsState.failRead = false;
    }
    expect('fileError' in failure).toBe(true);
    expect('errors' in failure).toBe(false);
    if (!('fileError' in failure)) return;
    expect(failure.fileError).toMatchObject({ kind: 'read', code: 'EACCES' });
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [], stderr)).toBe(1);
    const out = stderr.text();
    expect(out.trimEnd()).toBe(formatFileError(failure.fileError).trimEnd());
    expect(out).toContain('ce.yml');
    expect(out).toContain('EACCES');
    expect(out).not.toMatch(/value:|expected:/);
  });
});

describe('Secret redaction in the printed report', () => {
  it('prints a Secret value as [REDACTED]', () => {
    const secret = 'sk-test-super-secret-123';
    const failure = expectFailure(
      loadConfig({
        cwd: dir,
        flags: {},
        env: { OPENROUTER_API_KEY: secret, CE_TARGET_URL: secret },
      }),
    );
    expect('errors' in failure).toBe(true);
    const stderr = fakeStderr();
    expect(reportConfigFailure(failure, [secret], stderr)).toBe(1);
    expect(stderr.text()).toContain('[REDACTED]');
    expect(stderr.text()).not.toContain(secret);
  });
});
