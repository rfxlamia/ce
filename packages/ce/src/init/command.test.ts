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

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

/** Real node:fs with selected operations replaced, to simulate failures. */
function fsWith(over: Record<string, unknown>) {
  return {
    lstat: realFs.lstatSync,
    stat: realFs.statSync,
    readFile: realFs.readFileSync,
    readdir: realFs.readdirSync,
    writeFile: realFs.writeFileSync,
    rename: realFs.renameSync,
    unlink: realFs.unlinkSync,
    ...over,
  };
}

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

describe('runInitCommand guard', () => {
  const EXISTS = (name: string) => `${name} already exists; re-run with --force to overwrite`;
  beforeEach(() => write('package.json', VITE_PKG));

  it('refuses to overwrite an existing ce.yml', async () => {
    write('package.json', VITE_PKG);
    write('ce.yml', 'custom: true\n');
    const r = await init([]);
    expect(r.code).toBe(1);
    expect(read('ce.yml')).toBe('custom: true\n');
    expect(r.err).toContain(EXISTS('ce.yml'));
    expect(r.out).toBe('');
  });

  it('refuses when only .ce.yml exists and does not create ce.yml', async () => {
    write('.ce.yml', 'custom: true\n');
    const r = await init([]);
    expect(r.code).toBe(1);
    expect(exists('ce.yml')).toBe(false);
    expect(read('.ce.yml')).toBe('custom: true\n');
    expect(r.err).toContain(EXISTS('.ce.yml'));
  });

  it('is a no-op on a second run', async () => {
    write('package.json', VITE_PKG);
    expect((await init([])).code).toBe(0);
    const first = read('ce.yml');
    const r = await init([]);
    expect(r.code).toBe(1);
    expect(read('ce.yml')).toBe(first);
    expect(r.err).toContain(EXISTS('ce.yml'));
  });

  it('treats a directory named ce.yml as existing', async () => {
    realFs.mkdirSync(path.join(cwd, 'ce.yml'));
    const r = await init([]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(EXISTS('ce.yml'));
  });

  it('treats a dangling symlink ce.yml as existing', async () => {
    realFs.symlinkSync(path.join(cwd, 'nowhere'), path.join(cwd, 'ce.yml'));
    const r = await init([]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(EXISTS('ce.yml'));
    expect(exists('nowhere')).toBe(false);
  });

  it('reports a non-ENOENT lstat failure cleanly instead of rejecting', async () => {
    const fs = fsWith({
      lstat: () => {
        throw errno('EACCES');
      },
    });
    const r = await init([], {}, fs);
    expect(r.code).toBe(1);
    expect(r.err).toContain('ce.yml');
    expect(r.err).toContain('EACCES');
    expect(r.out).toBe('');
    expect(exists('ce.yml')).toBe(false);
  });

  it('maps an EEXIST race on the exclusive create to the same message', async () => {
    write('package.json', VITE_PKG);
    const fs = fsWith({
      writeFile: (p: string, data: string, o: { flag: string }) => {
        if (o.flag === 'wx') {
          realFs.writeFileSync(p, 'raced\n');
          throw errno('EEXIST');
        }
        realFs.writeFileSync(p, data, o);
      },
    });
    const r = await init([], {}, fs);
    expect(r.code).toBe(1);
    expect(r.err).toContain(EXISTS('ce.yml'));
    expect(read('ce.yml')).toBe('raced\n');
    expect(r.out).toBe('');
  });
});

describe('runInitCommand force', () => {
  beforeEach(() => write('package.json', VITE_PKG));

  it('replaces an existing ce.yml', async () => {
    write('ce.yml', 'custom: true\n');
    const r = await init(['--force']);
    expect(r.code).toBe(0);
    expect(read('ce.yml')).toContain('http://localhost:5173');
    expect(read('ce.yml')).not.toContain('custom: true');
    expect(r.out).toContain('Wrote ce.yml');
    expect(entries()).toEqual(['ce.yml', 'package.json']);
  });

  it('rewrites .ce.yml in place when it is the only config', async () => {
    write('.ce.yml', 'custom: true\n');
    const r = await init(['--force']);
    expect(r.code).toBe(0);
    expect(exists('ce.yml')).toBe(false);
    expect(read('.ce.yml')).toContain('http://localhost:5173');
    expect(r.out).toContain('Wrote .ce.yml');
    expect(r.out).not.toContain('Please edit');
  });

  it('rewrites ce.yml and notes that .ce.yml stays ignored when both exist', async () => {
    write('ce.yml', 'one: 1\n');
    write('.ce.yml', 'two: 2\n');
    const r = await init(['--force']);
    expect(r.code).toBe(0);
    expect(read('ce.yml')).toContain('http://localhost:5173');
    expect(read('.ce.yml')).toBe('two: 2\n');
    expect(r.err).toContain('.ce.yml');
    expect(r.err).toContain('ignored');
  });

  it('rewrites .ce.yml when ce.yml is a directory', async () => {
    realFs.mkdirSync(path.join(cwd, 'ce.yml'));
    write('.ce.yml', 'two: 2\n');
    const r = await init(['--force']);
    expect(r.code).toBe(0);
    expect(read('.ce.yml')).toContain('http://localhost:5173');
    expect(realFs.statSync(path.join(cwd, 'ce.yml')).isDirectory()).toBe(true);
  });

  it('fails with EISDIR and leaves no temp file when ce.yml is a directory', async () => {
    realFs.mkdirSync(path.join(cwd, 'ce.yml'));
    const r = await init(['--force']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('ce.yml');
    expect(r.err).toContain('EISDIR');
    expect(r.out).toBe('');
    expect(entries()).toEqual(['ce.yml', 'package.json']);
  });

  it('keeps the original and removes the temp file when rename fails with ENOSPC', async () => {
    write('ce.yml', 'custom: true\n');
    const renamed: string[] = [];
    const fs = fsWith({
      rename: (from: string) => {
        renamed.push(path.basename(from));
        throw errno('ENOSPC');
      },
    });
    const r = await init(['--force'], {}, fs);
    expect(r.code).toBe(1);
    expect(read('ce.yml')).toBe('custom: true\n');
    expect(entries()).toEqual(['ce.yml', 'package.json']);
    expect(renamed[0]).toMatch(/^\.ce\.yml\.[0-9a-f]+\.tmp$/);
    expect(r.err).toContain('ce.yml');
    expect(r.err).toContain('ENOSPC');
    expect(r.out).toBe('');
  });

  it('removes the temp file when the temp write itself fails midway', async () => {
    write('ce.yml', 'custom: true\n');
    const fs = fsWith({
      writeFile: (p: string, data: string, o: { flag: string }) => {
        realFs.writeFileSync(p, data.slice(0, 5), o);
        throw errno('ENOSPC');
      },
    });
    const r = await init(['--force'], {}, fs);
    expect(r.code).toBe(1);
    expect(read('ce.yml')).toBe('custom: true\n');
    expect(entries()).toEqual(['ce.yml', 'package.json']);
    expect(r.err).toContain('ENOSPC');
  });

  it('omits the ignored-.ce.yml note when the replace fails', async () => {
    write('ce.yml', 'one: 1\n');
    write('.ce.yml', 'two: 2\n');
    const fs = fsWith({
      rename: () => {
        throw errno('ENOSPC');
      },
    });
    const r = await init(['--force'], {}, fs);
    expect(r.code).toBe(1);
    expect(r.err).not.toContain('ignored');
  });

  it('replaces a dangling symlink ce.yml with a regular file', async () => {
    realFs.symlinkSync(path.join(cwd, 'nowhere'), path.join(cwd, 'ce.yml'));
    const r = await init(['--force']);
    expect(r.code).toBe(0);
    expect(realFs.lstatSync(path.join(cwd, 'ce.yml')).isFile()).toBe(true);
    expect(read('ce.yml')).toContain('http://localhost:5173');
    expect(exists('nowhere')).toBe(false);
  });

  it('reports EACCES from the create without --force', async () => {
    const fs = fsWith({
      writeFile: () => {
        throw errno('EACCES');
      },
    });
    const r = await init([], {}, fs);
    expect(r.code).toBe(1);
    expect(r.err).toContain('ce.yml');
    expect(r.err).toContain('EACCES');
    expect(r.out).toBe('');
  });
});

describe('runInitCommand argv and fallbacks', () => {
  it('prints usage and writes nothing for an unknown flag', async () => {
    write('package.json', VITE_PKG);
    const r = await init(['--bogus']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Usage: ce init [--force]');
    expect(r.out).toBe('');
    expect(entries()).toEqual(['package.json']);
  });

  it('prints usage and writes nothing for a positional argument', async () => {
    write('package.json', VITE_PKG);
    const r = await init(['foo']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Usage: ce init [--force]');
    expect(entries()).toEqual(['package.json']);
  });

  it('writes the fallback template in an empty directory', async () => {
    const r = await init([]);
    expect(r.code).toBe(0);
    expect(read('ce.yml')).toContain('# Target not detected');
    expect(r.out).toContain('Please edit target in ce.yml');
    expect(r.err).toBe('');
  });

  it('notes an unparseable package.json and still writes the template', async () => {
    write('package.json', '{ not json');
    const r = await init([]);
    expect(r.code).toBe(0);
    expect(r.err).toContain('package.json could not be parsed');
    expect(r.out).toContain('Next steps:');
    expect(exists('ce.yml')).toBe(true);
  });

  it('notes an unreadable package.json (a directory) and still writes the template', async () => {
    realFs.mkdirSync(path.join(cwd, 'package.json'));
    const r = await init([]);
    expect(r.code).toBe(0);
    expect(r.err).toContain('package.json could not be read (EISDIR)');
    expect(read('ce.yml')).toContain('package.json could not be read');
    expect(r.out).toContain('Please edit target in ce.yml');
  });

  it('ignores a lockfile name that is a directory', async () => {
    write('package.json', VITE_PKG);
    realFs.mkdirSync(path.join(cwd, 'yarn.lock'));
    const r = await init([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('npm install');
    expect(r.out).not.toContain('yarn');
  });

  it('never prints the API key value', async () => {
    write('package.json', VITE_PKG);
    const r = await init([], { OPENROUTER_API_KEY: 'sk-test-123' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('already set');
    expect(r.out + r.err).not.toContain('sk-test-123');
  });
});
