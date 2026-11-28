/**
 * Integration tests for the Publisher against a Fake_Remote: a bare Git
 * repository in a temp directory, driven by the real Git_Runner. A wrapper
 * around the runner can advance the remote tip between a fetch and a push, so
 * the non-fast-forward rejection is genuine (D10). No network, no API key.
 *
 * Task 4.4. Requirements 5.1, 5.2, 5.4, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.6,
 * 11.1, 16.6, 16.7, 16.8.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunRecord } from 'continuous-evidence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitRunner } from './git-runner.js';
import type { GitInvocation, GitRunner } from './git-runner.js';
import { publish } from './publisher.js';
import type { PublishOptions } from './publisher.js';
import type { DirectoryEntry } from './select.js';

const BRANCH = 'ce-evidence';
const REF = `refs/heads/${BRANCH}`;
const SERVER = 'https://github.com';
const FIXED_ENV: Record<string, string> = {
  LC_ALL: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const IDENT = {
  GIT_AUTHOR_NAME: 'Other',
  GIT_AUTHOR_EMAIL: 'other@example.invalid',
  GIT_COMMITTER_NAME: 'Other',
  GIT_COMMITTER_EMAIL: 'other@example.invalid',
};

/** Runs git synchronously with a clean environment. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { PATH: process.env['PATH'] ?? '', ...FIXED_ENV, ...IDENT },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let root: string;
let remote: string;
let runDir: string;
let tmpBase: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ce-int-'));
  remote = join(root, 'remote.git');
  mkdirSync(remote);
  git(remote, ['init', '-q', '--bare']);
  runDir = join(root, 'run');
  tmpBase = join(root, 'tmp');
  mkdirSync(runDir);
  mkdirSync(tmpBase);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes PNG-named files and returns the record and listing for them. */
function makeRun(content = 'png-bytes'): { record: RunRecord; listing: DirectoryEntry[] } {
  const names = ['final.png', 'step-0.png', 'step-1.png'];
  const listing: DirectoryEntry[] = [];
  for (const name of names) {
    const body = `${content}:${name}`;
    writeFileSync(join(runDir, name), body);
    listing.push({ relativePath: name, isFile: true, sizeBytes: Buffer.byteLength(body) });
  }
  const record = {
    finalImage: { screenshot: 'final.png' },
    steps: [
      { executed: true, screenshot: 'step-0.png' },
      { executed: true, screenshot: 'step-1.png' },
    ],
  } as unknown as RunRecord;
  return { record, listing };
}

interface Harness {
  invocations: GitInvocation[];
  runner: GitRunner;
  /** Called before every push; may advance the remote. */
  beforePush: (pushIndex: number) => void;
}

function harness(): Harness {
  const real = createGitRunner();
  const h: Harness = {
    invocations: [],
    beforePush: () => undefined,
    runner: async (invocation) => {
      h.invocations.push(invocation);
      if (invocation.args[0] === 'push') {
        const index = h.invocations.filter((i) => i.args[0] === 'push').length - 1;
        h.beforePush(index);
      }
      return real(invocation);
    },
  };
  return h;
}

function options(h: Harness, overrides: Partial<PublishOptions> = {}, runId = 'run-a', prNumber = 7): PublishOptions {
  const { record, listing } = makeRun();
  return {
    runner: h.runner,
    runToken: 'test-token-value',
    record,
    runDir,
    listing,
    prNumber,
    runId,
    owner: 'octo',
    repo: 'demo',
    serverUrl: SERVER,
    imageCap: 6,
    byteCapBytes: 5 * 1024 * 1024,
    tmpBase,
    remoteUrl: remote,
    ...overrides,
  };
}

/** Pushes one extra commit to the remote as another actor, advancing the tip. */
let otherCounter = 0;
function advanceRemote(): string {
  otherCounter += 1;
  const work = mkdtempSync(join(root, 'other-'));
  git(work, ['init', '-q', '--template=']);
  let tipExists = true;
  try {
    git(work, ['fetch', '-q', '--depth', '1', remote, `+${REF}:refs/remotes/origin/${BRANCH}`]);
  } catch {
    tipExists = false;
  }
  if (tipExists) git(work, ['checkout', '-q', '-f', '-B', BRANCH, `refs/remotes/origin/${BRANCH}`]);
  else git(work, ['symbolic-ref', 'HEAD', REF]);
  mkdirSync(join(work, 'other'), { recursive: true });
  writeFileSync(join(work, 'other', `file-${otherCounter}.txt`), `other ${otherCounter}`);
  git(work, ['add', '--', 'other']);
  git(work, ['commit', '-q', '-m', `other ${otherCounter}`]);
  git(work, ['push', '-q', remote, `HEAD:${REF}`]);
  return git(work, ['rev-parse', 'HEAD']).trim();
}

const remoteTip = (): string => git(remote, ['rev-parse', REF]).trim();
const remoteFiles = (sha = REF): string[] =>
  git(remote, ['ls-tree', '-r', '--name-only', sha]).split('\n').filter((l) => l !== '');
const parentsOf = (sha: string): string[] =>
  git(remote, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1);
const commitCount = (): number => Number(git(remote, ['rev-list', '--count', REF]).trim());

describe('Publisher against a Fake_Remote', () => {
  it('creates an orphan branch with one root commit holding only the published files', async () => {
    const h = harness();
    const result = await publish(options(h));

    expect(result.kind).toBe('published');
    expect(remoteFiles().sort()).toEqual([
      'pr-7/run-a/final.png',
      'pr-7/run-a/step-0.png',
      'pr-7/run-a/step-1.png',
    ]);
    expect(commitCount()).toBe(1);
    expect(parentsOf(REF)).toEqual([]);
    expect(readFileSync(join(runDir, 'final.png'), 'utf8')).toBe(
      git(remote, ['show', `${REF}:pr-7/run-a/final.png`]),
    );
  });

  it('appends on an existing branch: earlier files unchanged, old tip is the parent', async () => {
    const h = harness();
    await publish(options(h, {}, 'run-a', 7));
    const oldTip = remoteTip();
    const oldFiles = remoteFiles();

    const result = await publish(options(h, {}, 'run-b', 8));

    expect(result.kind).toBe('published');
    const newTip = remoteTip();
    expect(newTip).not.toBe(oldTip);
    expect(parentsOf(newTip)).toEqual([oldTip]);
    for (const file of oldFiles) {
      expect(git(remote, ['rev-parse', `${newTip}:${file}`])).toBe(git(remote, ['rev-parse', `${oldTip}:${file}`]));
    }
    expect(remoteFiles()).toContain('pr-8/run-b/final.png');
  });

  it('fetches and retries after a rejected push, then succeeds with the new tip as parent', async () => {
    const h = harness();
    await publish(options(h, {}, 'run-a', 7));
    let advancedTo = '';
    h.beforePush = (index) => {
      if (index === 1) advancedTo = advanceRemote(); // first push of the second publish
    };

    const result = await publish(options(h, {}, 'run-b', 8));

    expect(result.kind).toBe('published');
    const pushes = h.invocations.filter((i) => i.args[0] === 'push');
    expect(pushes).toHaveLength(3); // run-a, run-b rejected, run-b retried
    expect(advancedTo).not.toBe('');
    expect(parentsOf(remoteTip())).toEqual([advancedTo]);
    // Everything survived: the earlier run, the other actor, and this run.
    const files = remoteFiles();
    expect(files).toContain('pr-7/run-a/final.png');
    expect(files.some((f) => f.startsWith('other/'))).toBe(true);
    expect(files).toContain('pr-8/run-b/final.png');
  });

  it('gives push-conflict-exhausted after 3 retries when the tip moves before every push', async () => {
    const h = harness();
    await publish(options(h, {}, 'run-a', 7));
    const base = h.invocations.filter((i) => i.args[0] === 'push').length;
    h.beforePush = (index) => {
      if (index >= base) advanceRemote();
    };

    const result = await publish(options(h, {}, 'run-b', 8));

    expect(result).toEqual({ kind: 'fallback', reason: 'push-conflict-exhausted' });
    const pushes = h.invocations.filter((i) => i.args[0] === 'push').length - base;
    expect(pushes).toBe(4); // first attempt plus 3 retries
    expect(remoteFiles()).not.toContain('pr-8/run-b/final.png');
  });

  it('gives push-blocked when a pre-receive hook rejects the push', async () => {
    const hook = join(remote, 'hooks', 'pre-receive');
    mkdirSync(join(remote, 'hooks'), { recursive: true });
    writeFileSync(hook, '#!/bin/sh\necho "protected branch: push declined" >&2\nexit 1\n');
    chmodSync(hook, 0o755);

    const result = await publish(options(harness()));

    expect(result).toEqual({ kind: 'fallback', reason: 'push-blocked' });
  });

  it('overwrites an existing Evidence_Path on a re-run with the same Run_Id', async () => {
    const h = harness();
    await publish(options(h));
    const first = remoteTip();

    const second = options(h);
    const { record, listing } = makeRun('second-content'); // rewrites the files on disk
    const result = await publish({ ...second, record, listing });

    expect(result.kind).toBe('published');
    expect(remoteTip()).not.toBe(first);
    expect(git(remote, ['show', `${REF}:pr-7/run-a/final.png`])).toBe('second-content:final.png');
    expect(remoteFiles().filter((f) => f.startsWith('pr-7/run-a/'))).toHaveLength(3);
    // History is kept: the first commit is still an ancestor.
    git(remote, ['merge-base', '--is-ancestor', first, REF]);
  });

  it('keeps both results when two publishes for different paths run at the same time', async () => {
    const a = harness();
    const b = harness();
    const [ra, rb] = await Promise.all([
      publish(options(a, {}, 'run-a', 7)),
      publish(options(b, {}, 'run-b', 8)),
    ]);

    // Two writers racing to create the branch: the loser must retry, not fall back.
    expect(ra.kind).toBe('published');
    expect(rb.kind).toBe('published');
    const files = remoteFiles();
    expect(files).toContain('pr-7/run-a/final.png');
    expect(files).toContain('pr-8/run-b/final.png');
  });

  it('removes the temp directory after success and after failure', async () => {
    await publish(options(harness()));
    expect(readdirSync(tmpBase)).toEqual([]);

    const hook = join(remote, 'hooks', 'pre-receive');
    mkdirSync(join(remote, 'hooks'), { recursive: true });
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const result = await publish(options(harness(), {}, 'run-z', 9));
    expect(result.kind).toBe('fallback');
    expect(readdirSync(tmpBase)).toEqual([]);
  });

  it('fetches only the Evidence_Branch at depth 1, with the four fixed env entries on every call, and never force-pushes', async () => {
    const h = harness();
    await publish(options(h, {}, 'run-a', 7));
    const oldTip = remoteTip();
    await publish(options(h, {}, 'run-b', 8));

    expect(h.invocations.length).toBeGreaterThan(0);
    for (const invocation of h.invocations) {
      for (const [key, value] of Object.entries(FIXED_ENV)) expect(invocation.env[key]).toBe(value);
    }
    const fetches = h.invocations.filter((i) => i.args[0] === 'fetch');
    expect(fetches.length).toBeGreaterThan(0);
    for (const fetch of fetches) {
      expect(fetch.args).toContain('--depth');
      expect(fetch.args[fetch.args.indexOf('--depth') + 1]).toBe('1');
      const refspecs = fetch.args.filter((a) => a.includes('refs/'));
      expect(refspecs).toHaveLength(1);
      expect(refspecs[0]).toContain(REF);
      expect(fetch.args).not.toContain('--all');
    }
    for (const push of h.invocations.filter((i) => i.args[0] === 'push')) {
      expect(push.args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force-') || a.startsWith('+'))).toBe(false);
    }
    git(remote, ['merge-base', '--is-ancestor', oldTip, REF]);
  });

  it('builds Image_URLs from the SHA the remote holds', async () => {
    const result = await publish(options(harness()));

    expect(result.kind).toBe('published');
    if (result.kind !== 'published') return;
    expect(result.sha).toBe(remoteTip());
    expect(result.imageUrls).toHaveLength(3);
    expect(result.finalIncluded).toBe(true);
    expect(result.stepNumbers).toEqual([1, 2]);
    for (const url of result.imageUrls) {
      expect(url.startsWith(`${SERVER}/octo/demo/raw/${result.sha}/pr-7/run-a/`)).toBe(true);
    }
    expect(existsSync(join(tmpBase))).toBe(true);
  });

  it('reports finalIncluded false and step numbers when the final is over the byte cap', async () => {
    const { record, listing } = makeRun();
    const sized = listing.map((e) => (e.relativePath === 'final.png' ? { ...e, sizeBytes: 1000 } : { ...e, sizeBytes: 10 }));
    const result = await publish(options(harness(), { record, listing: sized, byteCapBytes: 100 }));
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') return;
    expect(result.finalIncluded).toBe(false);
    expect(result.imageUrls).toHaveLength(2);
    expect(result.stepNumbers).toEqual([1, 2]);
    expect(result.skippedCount).toBe(1);
  });

  it('reports finalIncluded false when the record has no final screenshot, and keeps late step numbers under the cap', async () => {
    const { record, listing } = makeRun();
    const noFinal = { ...record, finalImage: { screenshot: null } } as unknown as RunRecord;
    const result = await publish(options(harness(), { record: noFinal, listing, imageCap: 1 }));
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') return;
    expect(result.finalIncluded).toBe(false);
    expect(result.imageUrls).toHaveLength(1);
    expect(result.stepNumbers).toEqual([2]);
  });
});
