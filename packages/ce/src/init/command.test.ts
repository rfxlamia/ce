import * as realFs from 'node:fs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load.js';
import { runInitCommand } from './command.js';

const VITE_PKG = JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6' } });

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'ce-init-cmd-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function capture() {
  let out = '';
  let err = '';
  return {
    stdout: { write: (t: string) => ((out += t), true) },
    stderr: { write: (t: string) => ((err += t), true) },
    out: () => out,
    err: () => err,
  };
}

async function init(argv: string[], env: Record<string, string | undefined> = {}, fs?: unknown) {
  const c = capture();
  const code = await runInitCommand(argv, {
    cwd,
    env,
    stdout: c.stdout,
    stderr: c.stderr,
    ...(fs !== undefined ? { fs: fs as never } : {}),
  });
  return { code, out: c.out(), err: c.err() };
}

const write = (name: string, text: string) => writeFileSync(path.join(cwd, name), text);
const read = (name: string) => readFileSync(path.join(cwd, name), 'utf8');
const exists = (name: string) => realFs.existsSync(path.join(cwd, name));
const entries = () => readdirSync(cwd).sort();

describe('runInitCommand happy path', () => {
  it('writes a detected config end to end', async () => {
    write('package.json', VITE_PKG);
    write('package-lock.json', '{}');
    const r = await init([]);
    expect(r.code).toBe(0);
    expect(exists('ce.yml')).toBe(true);
    const loaded = loadConfig({ cwd, flags: {}, env: {} });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.target?.url).toBe('http://localhost:5173');
    expect(r.out).toContain('Next steps:');
    expect(r.out).toContain('Wrote ce.yml');
    expect(r.err).toBe('');
  });
});
