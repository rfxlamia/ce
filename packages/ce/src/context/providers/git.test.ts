// Git_Provider tests against real temporary repositories (no remote contact, no writes).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveGit, type GitExecOptions, type GitExecResult, type GitProviderInput } from './git.js';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-git-'));
  roots.push(d);
  return d;
}

const BASE_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: BASE_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function realExec(args: string[], o: GitExecOptions): GitExecResult {
  const r = spawnSync('git', args, {
    cwd: o.cwd,
    env: { ...BASE_ENV, ...o.env, GIT_CEILING_DIRECTORIES: dirname(o.cwd) },
    maxBuffer: o.maxBuffer,
    encoding: 'utf8',
  });
  if (r.error) return { error: r.error as NodeJS.ErrnoException };
  if (r.status !== 0) {
    const e: NodeJS.ErrnoException = new Error(`exit ${r.status}: ${r.stderr}`);
    e.code = 'EGIT';
    return { error: e };
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

function put(cwd: string, path: string, content: string | Buffer): void {
  const full = join(cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function newRepo(): string {
  const d = mkTmp();
  git(d, 'init', '-q', '-b', 'main');
  return d;
}

function commit(cwd: string, msg: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

const base = (ref: string): GitProviderInput['baseRef'] => ({
  ref,
  provenance: { provider: 'git', location: ref },
});

function run(cwd: string, extra: Partial<GitProviderInput> = {}) {
  return resolveGit({ cwd, baseRef: base('main'), exec: realExec, ...extra });
}

describe('git provider status reasons', () => {
  it('not-a-repository outside a work tree', () => {
    const d = mkTmp();
    const r = resolveGit({ cwd: d, baseRef: base('main'), exec: realExec });
    expect(r.status).toEqual({ name: 'git', status: 'unavailable', reason: 'not-a-repository' });
    expect(r.files).toEqual([]);
  });

  it('base-unresolved without a base and with an unknown base', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    expect(resolveGit({ cwd: d, exec: realExec }).status.reason).toBe('base-unresolved');
    expect(run(d, { baseRef: base('nope') }).status.reason).toBe('base-unresolved');
  });

  it('merge-base-missing in a shallow clone with diverged tips', () => {
    const src = newRepo();
    put(src, 'a.txt', 'a\n');
    commit(src, 'init');
    git(src, 'checkout', '-q', '-b', 'feature');
    put(src, 'f.txt', 'f\n');
    commit(src, 'feat');
    git(src, 'checkout', '-q', 'main');
    put(src, 'm.txt', 'm\n');
    commit(src, 'main2');
    const dst = join(mkTmp(), 'clone');
    git(dirname(dst), 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${src}`, dst);
    const r = resolveGit({
      cwd: dst,
      baseRef: base('origin/main'),
      headRef: { ref: 'origin/feature', provenance: { provider: 'git', location: 'origin/feature' } },
      exec: realExec,
    });
    expect(r.status).toEqual({ name: 'git', status: 'unavailable', reason: 'merge-base-missing' });
  });

  it('git-failed never carries git stderr text', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    // Unresolvable head.
    const r1 = run(d, { headRef: { ref: 'nohead', provenance: { provider: 'git', location: 'nohead' } } });
    expect(r1.status).toEqual({ name: 'git', status: 'unavailable', reason: 'git-failed' });
    // Failing stage 1 diff with stderr text.
    const failing: GitProviderInput['exec'] = (args, o) =>
      args.includes('--name-status') ? { error: Object.assign(new Error('SECRET-STDERR fatal: boom'), { code: 'EGIT' }) } : realExec(args, o);
    const r2 = run(d, { exec: failing });
    expect(r2.status).toEqual({ name: 'git', status: 'unavailable', reason: 'git-failed' });
    expect(JSON.stringify(r2)).not.toMatch(/SECRET-STDERR|fatal/);
  });

  it('head-missing keeps status used with the reason', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    const r = run(d, {
      headRef: { ref: 'HEAD', provenance: { provider: 'git', location: 'HEAD' }, headMissing: true },
    });
    expect(r.status).toEqual({ name: 'git', status: 'used', reason: 'head-missing' });
  });
});

describe('git provider diff scope', () => {
  it('diffs against the merge base, not the advanced base tip', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'f.txt', 'f\n');
    commit(d, 'feat');
    git(d, 'checkout', '-q', 'main');
    put(d, 'm.txt', 'm\n');
    commit(d, 'main advance');
    git(d, 'checkout', '-q', 'feature');
    const r = run(d);
    expect(r.status.status).toBe('used');
    expect(r.files.map((f) => f.path)).toEqual(['f.txt']);
    expect(r.files[0]?.patch).toContain('+f');
    expect(r.commits.map((c) => c.message)).toEqual(['feat']);
  });

  it('synthetic merge commit yields only PR files and commits, no merge message', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'pr');
    put(d, 'p1.txt', '1\n');
    commit(d, 'pr one');
    put(d, 'p2.txt', '2\n');
    commit(d, 'pr two');
    git(d, 'checkout', '-q', 'main');
    put(d, 'm.txt', 'm\n');
    commit(d, 'main advance');
    git(d, 'checkout', '-q', '-b', 'synthetic', 'pr');
    git(d, 'merge', '-q', '--no-ff', '-m', 'Merge main into synthetic', 'main');
    // Base is the advanced main tip: merge-base is the main tip, so only PR content remains.
    const r2 = run(d, { baseRef: base('main') });
    expect(r2.files.map((f) => f.path)).toEqual(['p1.txt', 'p2.txt']);
    expect(r2.commits.map((c) => c.message)).toEqual(['pr one', 'pr two']);
    expect(JSON.stringify(r2.commits)).not.toContain('Merge main');
  });
});

describe('git provider Env_File and Sensitive_File handling', () => {
  it('empties patches and records reasons, leaking no content', () => {
    const d = newRepo();
    const S = 'TOPSECRET-VALUE\n';
    put(d, 'deleted/.env', `${'deleted-only\n'.repeat(30)}${S}`);
    put(d, 'ren/.env', `${'rename-one\n'.repeat(30)}${S}`);
    put(d, 'envren/.env.production', `${'rename-two\n'.repeat(30)}${S}`);
    put(d, 'keep.txt', 'one\n');
    commit(d, 'base');
    git(d, 'checkout', '-q', '-b', 'feature');
    git(d, 'rm', '-q', 'deleted/.env');
    git(d, 'mv', 'ren/.env', 'ren/config.txt');
    git(d, 'mv', 'envren/.env.production', 'envren/.env.staging');
    put(d, 'keep.txt', 'two\n');
    const sens: Record<string, string> = {
      'x/.Env': 'env-file',
      'x/.envrc': 'env-file',
      'x/.env-local': 'env-file',
      'x/.env_prod': 'env-file',
      'x/ID_RSA': 'sensitive-file',
      'x/Server.PEM': 'sensitive-file',
      'x/deploy.KEY': 'sensitive-file',
      'x/id_ecdsa': 'sensitive-file',
      'x/id_dsa': 'sensitive-file',
      'x/store.p12': 'sensitive-file',
      'x/store.pfx': 'sensitive-file',
      'x/.netrc': 'sensitive-file',
      'x/.git-credentials': 'sensitive-file',
      'x/.pypirc': 'sensitive-file',
    };
    for (const p of Object.keys(sens)) put(d, p, `${`${p}\n`.repeat(30)}${S}`);
    commit(d, 'feature');
    const r = run(d);
    const byPath = new Map(r.files.map((f) => [f.path, f]));
    const rec = new Map(r.truncated.map((t) => [t.file, t.reason]));
    expect(r.status.status).toBe('used');
    expect(byPath.get('deleted/.env')).toMatchObject({ status: 'deleted', patch: '' });
    expect(rec.get('deleted/.env')).toBe('env-file');
    expect(byPath.get('ren/config.txt')).toMatchObject({ status: 'renamed', oldPath: 'ren/.env', patch: '' });
    expect(rec.get('ren/config.txt')).toBe('env-file');
    expect(byPath.get('envren/.env.staging')).toMatchObject({ oldPath: 'envren/.env.production', patch: '' });
    expect(rec.get('envren/.env.staging')).toBe('env-file');
    for (const [p, reason] of Object.entries(sens)) {
      expect(byPath.get(p)?.patch, p).toBe('');
      expect(rec.get(p), p).toBe(reason);
    }
    expect(byPath.get('keep.txt')?.patch).toContain('+two');
    expect(rec.has('keep.txt')).toBe(false);
    expect(JSON.stringify(r)).not.toContain('TOPSECRET');
  });
});

describe('git provider environment independence', () => {
  it('gives identical output under hostile git config', () => {
    const d = newRepo();
    put(d, 'dir with space/café.txt', 'a\nb\nc\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'dir with space/café.txt', 'a\nB\nc\nd\n');
    put(d, 'dir with space/ünï new.txt', 'x\n');
    commit(d, 'change');
    const clean = run(d);
    for (const [k, v] of [
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.algorithm', 'patience'],
      ['diff.renames', 'false'],
      ['color.ui', 'always'],
      ['color.diff', 'always'],
      ['core.quotePath', 'true'],
      ['diff.context', '0'],
    ] as const) git(d, 'config', k, v);
    const hostile = run(d);
    expect(hostile).toEqual(clean);
    expect(clean.files).toHaveLength(2);
    const f = clean.files.find((x) => x.path === 'dir with space/café.txt');
    expect(f?.patch).toContain('diff --git a/dir with space/café.txt b/dir with space/café.txt');
    expect(f?.patch).not.toContain('\x1b[');
  });
});

describe('git provider pathspecs and patches', () => {
  it('120 files, 100 excluded: one pathspec per requested path, no git-failed', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    for (let i = 0; i < 100; i++) put(d, `gen/g${i}.txt`, `${i}\n`);
    for (let i = 0; i < 20; i++) put(d, `src/s${i}.txt`, `${i}\n`);
    commit(d, 'many');
    const calls: string[][] = [];
    const spy: GitProviderInput['exec'] = (args, o) => {
      calls.push(args);
      return realExec(args, o);
    };
    const r = run(d, { exclude: ['gen/**'], exec: spy });
    expect(r.status.status).toBe('used');
    expect(r.files).toHaveLength(20);
    const specs = calls
      .filter((a) => a.includes('-p'))
      .flatMap((a) => a.slice(a.indexOf('--') + 1))
      .filter((s) => s.startsWith(':(literal)'));
    expect(specs).toHaveLength(20);
    expect(specs.every((s) => s.startsWith(':(literal)src/'))).toBe(true);
  });

  it('discards orphan patches when a rename is excluded', () => {
    const d = newRepo();
    put(d, 'a.txt', 'one\ntwo\nthree\n');
    put(d, 'keep.txt', 'k\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    mkdirSync(join(d, 'gen'));
    git(d, 'mv', 'a.txt', 'gen/a.txt');
    put(d, 'keep.txt', 'k2\n');
    commit(d, 'rename');
    const r = run(d, { exclude: ['gen/**'] });
    expect(r.status.status).toBe('used');
    expect(r.files.map((f) => f.path)).toEqual(['keep.txt']);
    expect(r.files[0]?.patch).not.toContain('a.txt');
  });

  it('drops an oversize patch whole (raw patch limit)', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'big.txt', Array.from({ length: 40000 }, (_, i) => `line number ${i} padding`).join('\n') + '\n');
    put(d, 'small.txt', 's\n');
    commit(d, 'big');
    const r = run(d);
    const big = r.files.find((f) => f.path === 'big.txt');
    expect(big?.patch).toBe('');
    expect(r.truncated).toContainEqual({ file: 'big.txt', reason: 'dropped' });
    expect(r.files.find((f) => f.path === 'small.txt')?.patch).toContain('+s');
  });

  it('retries per entry when a batch overflows an injected maxBuffer', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'big.txt', Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n') + '\n');
    put(d, 's1.txt', '1\n');
    put(d, 's2.txt', '2\n');
    commit(d, 'mix');
    let diffCalls = 0;
    const spy: GitProviderInput['exec'] = (args, o) => {
      if (args.includes('-p')) diffCalls++;
      return realExec(args, o);
    };
    const r = run(d, { maxBuffer: 4000, exec: spy });
    expect(r.status.status).toBe('used');
    expect(diffCalls).toBeGreaterThan(1 + 0);
    expect(diffCalls).toBe(4); // batch + three singles
    expect(r.files.find((f) => f.path === 'big.txt')?.patch).toBe('');
    expect(r.truncated).toContainEqual({ file: 'big.txt', reason: 'dropped' });
    expect(r.files.find((f) => f.path === 's1.txt')?.patch).toContain('+1');
    expect(r.files.find((f) => f.path === 's2.txt')?.patch).toContain('+2');
  });

  it('records binary files with an empty patch', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'img.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0, 7]));
    commit(d, 'bin');
    const r = run(d);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ path: 'img.bin', status: 'added', patch: '' });
    expect(r.truncated).toEqual([{ file: 'img.bin', reason: 'binary' }]);
  });

  it('does not write to the repository', () => {
    const d = newRepo();
    put(d, 'a.txt', 'a\n');
    commit(d, 'init');
    git(d, 'checkout', '-q', '-b', 'feature');
    put(d, 'b.txt', 'b\n');
    commit(d, 'b');
    const snap = (dir: string, out: string[] = []): string[] => {
      for (const n of readdirSync(dir).sort()) {
        const p = join(dir, n);
        const s = statSync(p);
        if (s.isDirectory()) snap(p, out);
        else out.push(`${p}:${s.size}:${s.mtimeMs}:${readFileSync(p).length}`);
      }
      return out;
    };
    const before = snap(d);
    const r = run(d);
    expect(r.status.status).toBe('used');
    expect(snap(d)).toEqual(before);
  });
});
