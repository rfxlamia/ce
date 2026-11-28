// Child-process tests for `ce init` routing in cli.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const cliPath = path.join(here, 'cli.ts');
const tsxBin = path.resolve(pkgDir, '..', '..', 'node_modules', '.bin', 'tsx');

const DOTENV_KEY = 'sk-or-DOTENV-0123456789abcdef';
const VITE_PKG = JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6' } });

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'ce-cli-init-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['OPENROUTER_API_KEY'];
  delete env['TYPESAFE_API_KEY'];
  const r = spawnSync(tsxBin, [cliPath, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('cli init', () => {
  it('writes ce.yml, lists init in help, and refuses a second run', () => {
    writeFileSync(path.join(cwd, 'package.json'), VITE_PKG);
    const first = runCli(['init']);
    expect(first.code).toBe(0);
    expect(existsSync(path.join(cwd, 'ce.yml'))).toBe(true);
    expect(first.stdout).toContain('Next steps:');

    expect(runCli(['--help']).stdout).toContain('ce init [--force]');

    const second = runCli(['init']);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('ce.yml already exists; re-run with --force to overwrite');
  });

  it('does not load .env', () => {
    writeFileSync(path.join(cwd, 'package.json'), VITE_PKG);
    writeFileSync(path.join(cwd, '.env'), `OPENROUTER_API_KEY=${DOTENV_KEY}\n`);
    const r = runCli(['init']);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('sk-or-DOTENV');
    expect(r.stdout).not.toContain('is already set');
    expect(r.stdout).toContain('Set OPENROUTER_API_KEY');
  });
});
