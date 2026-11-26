// Child-process tests for .env loading in cli.ts (Requirements 14.15-14.19, 16.11).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const cliPath = path.join(here, 'cli.ts');
const tsxBin = path.resolve(pkgDir, '..', '..', 'node_modules', '.bin', 'tsx');

const FILE_KEY = 'sk-or-FILEKEY-0123456789abcdef';
const ENV_KEY = 'sk-or-ENVKEY-0123456789abcdef';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'ce-cli-env-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
  if (!('OPENROUTER_API_KEY' in extraEnv)) delete env['OPENROUTER_API_KEY'];
  delete env['TYPESAFE_API_KEY'];
  const r = spawnSync(tsxBin, [cliPath, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('cli .env loading', () => {
  it('uses a key from .env, so the missing fixture directory is reported, not a credential', () => {
    writeFileSync(path.join(cwd, '.env'), `OPENROUTER_API_KEY=${FILE_KEY}\n`);
    const missing = path.join(cwd, 'no-such-fixtures');
    const r = runCli(['eval', '--fixtures', missing]);
    const all = r.stdout + r.stderr;
    expect(r.code).toBe(1);
    expect(all).toContain('Fixture directory is missing, unreadable or empty');
    expect(all).toContain(missing);
    expect(all).not.toContain('OPENROUTER_API_KEY');
    expect(all).not.toContain(FILE_KEY);
    expect(all).not.toContain('0123456789abcdef');
  });

  it('names OPENROUTER_API_KEY as missing when there is no .env', () => {
    const r = runCli(['eval', '--fixtures', path.join(cwd, 'no-such-fixtures')]);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('OPENROUTER_API_KEY');
    expect(r.stdout + r.stderr).not.toContain('Fixture directory is missing');
  });

  it('does not replace a key already in the environment', () => {
    writeFileSync(path.join(cwd, '.env'), `OPENROUTER_API_KEY=${FILE_KEY}\n`);
    const r = runCli(['eval', '--fixtures', path.join(cwd, 'nope')], { OPENROUTER_API_KEY: ENV_KEY });
    const all = r.stdout + r.stderr;
    expect(r.code).toBe(1);
    expect(all).toContain('Fixture directory is missing');
    expect(all).not.toContain(FILE_KEY);
    expect(all).not.toContain(ENV_KEY);
  });

  it('does not replace an empty-string key already in the environment', () => {
    writeFileSync(path.join(cwd, '.env'), `OPENROUTER_API_KEY=${FILE_KEY}\n`);
    const r = runCli(['eval', '--fixtures', path.join(cwd, 'nope')], { OPENROUTER_API_KEY: '' });
    const all = r.stdout + r.stderr;
    expect(r.code).toBe(1);
    expect(all).toContain('OPENROUTER_API_KEY');
    expect(all).not.toContain('Fixture directory is missing');
    expect(all).not.toContain(FILE_KEY);
  });

  it('--help does not load .env (a directory named .env is ignored)', () => {
    mkdirSync(path.join(cwd, '.env'));
    const r = runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stderr).not.toContain('.env');
  });

  it('exits 1 naming .env and EISDIR when .env is a directory, without running the command', () => {
    mkdirSync(path.join(cwd, '.env'));
    writeFileSync(path.join(cwd, '.env', 'secret'), `OPENROUTER_API_KEY=${FILE_KEY}\n`);
    const r = runCli(['eval', '--fixtures', path.join(cwd, 'nope')]);
    const all = r.stdout + r.stderr;
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('.env');
    expect(r.stderr).toContain('EISDIR');
    expect(all).not.toContain(FILE_KEY);
    expect(all).not.toContain('Fixture directory');
    expect(all).not.toContain('Eval saved');
    expect(existsSync(path.join(cwd, '.ce'))).toBe(false);
  });
});
