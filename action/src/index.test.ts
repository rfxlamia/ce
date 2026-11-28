// Integration tests for the Action entry (task 5.3). `runAction(deps)` runs with fakes only:
// no process, network, cache, artifact service or Jev call is made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMENT_MARKER, FakeJevGateway } from 'continuous-evidence';
import type { RunRecord } from 'continuous-evidence';
import { runAction } from './index.js';
import type { ActionDeps, SpawnRequest, SpawnResult } from './index.js';
import type { CommentApi } from './upsert.js';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  skippedRunRecordArb,
} from '../../packages/ce/src/evidence/arbitraries.js';

const TOKEN = 'ghs_runtokenvalue123';
const RUN_DIR_NAME = 'run-2026-01-01T00-00-00-000Z';

interface Harness {
  deps: ActionDeps;
  /** Every side effect in call order: 'cache.save', 'artifact.upload', 'comment.create', ... */
  writes: string[];
  /** Every GitHub API request the CommentApi fake received, as `VERB name`. */
  requests: string[];
  /** Every command the fakes were asked to run (CLI spawn, installer). Git would appear here. */
  commands: string[];
  spawned: SpawnRequest[];
  outputs: Record<string, string>;
  summary: string[];
  logs: { info: string[]; warning: string[]; error: string[]; mask: string[] };
  comments: Array<{ id: number; body: string; user: { login: string } }>;
  jev: FakeJevGateway;
  jevAsk: ReturnType<typeof vi.spyOn>;
  cwd: string;
}

interface Options {
  inputs?: Record<string, string>;
  env?: Record<string, string>;
  spawn?: SpawnResult | ((r: SpawnRequest) => Promise<SpawnResult>);
  record?: RunRecord | undefined;
  newRunDir?: boolean;
  event?: unknown;
  platform?: NodeJS.Platform;
  cacheHit?: boolean;
  cacheRestoreError?: Error;
  installError?: Error;
  uploadError?: Error;
  uploadResult?: { id?: number };
  apiError?: Error & { status?: number };
  existingComments?: Harness['comments'];
}

const sameRepoEvent = {
  pull_request: {
    number: 7,
    head: { repo: { full_name: 'o/r' } },
    base: { repo: { full_name: 'o/r' } },
  },
};

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-index-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function sample<T>(arb: fc.Arbitrary<T>): T {
  return fc.sample(arb, 1)[0]!;
}

function harness(options: Options = {}): Harness {
  const writes: string[] = [];
  const requests: string[] = [];
  const commands: string[] = [];
  const spawned: SpawnRequest[] = [];
  const outputs: Record<string, string> = {};
  const summary: string[] = [];
  const logs = { info: [] as string[], warning: [] as string[], error: [] as string[], mask: [] as string[] };
  const comments = options.existingComments ?? [];
  const inputs: Record<string, string> = { 'github-token': TOKEN, ...options.inputs };
  const outputDir = join(cwd, '.ce/runs');
  const runDir = join(outputDir, RUN_DIR_NAME);
  const record = 'record' in options ? options.record : sample(skippedRunRecordArb);
  const newRunDir = options.newRunDir ?? true;
  let listCalls = 0;
  const event = 'event' in options ? options.event : sameRepoEvent;

  const jev = new FakeJevGateway([]);
  const jevAsk = vi.spyOn(jev, 'ask');

  const commentApi: CommentApi = {
    async listComments(_pr, page) {
      requests.push(`GET list-comments page=${page}`);
      if (options.apiError !== undefined) throw options.apiError;
      return page === 1 ? comments : [];
    },
    async createComment(_pr, body) {
      requests.push('POST create-comment');
      writes.push('comment.create');
      if (options.apiError !== undefined) throw options.apiError;
      comments.push({ id: 100, body, user: { login: 'github-actions[bot]' } });
      return { id: 100, html_url: 'https://github.com/o/r/pull/7#issuecomment-100' };
    },
    async updateComment(id, body) {
      requests.push(`PATCH update-comment ${id}`);
      writes.push('comment.update');
      if (options.apiError !== undefined) throw options.apiError;
      return { id, html_url: `https://github.com/o/r/pull/7#issuecomment-${id}` };
    },
  };

  const deps: ActionDeps = {
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: '/event.json',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'ce',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_API_URL: 'https://api.github.com',
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
      ...options.env,
    },
    getInput: (name) => inputs[name] ?? '',
    adapters: {
      cache: {
        async restore() {
          if (options.cacheRestoreError !== undefined) throw options.cacheRestoreError;
          return options.cacheHit ?? false;
        },
        async save() {
          writes.push('cache.save');
        },
      },
      installer: {
        async installChromium() {
          commands.push('playwright install chromium');
          if (options.installError !== undefined) throw options.installError;
        },
        async installLinuxDeps() {
          commands.push('playwright install-deps chromium');
        },
      },
      artifacts: {
        async upload(name, dir) {
          writes.push('artifact.upload');
          expect(dir).toBe(runDir);
          expect(name).toContain('ce-evidence-42-1-ce-');
          if (options.uploadError !== undefined) throw options.uploadError;
          return options.uploadResult ?? { id: 555 };
        },
      },
      summary: { append: (body) => void summary.push(body) },
      outputs: { set: (name, value) => void (outputs[name] = value) },
      log: {
        info: (m) => void logs.info.push(m),
        warning: (m) => void logs.warning.push(m),
        error: (m) => void logs.error.push(m),
        mask: (v) => void logs.mask.push(v),
      },
      commentApi: () => commentApi,
    },
    async spawnCli(request) {
      spawned.push(request);
      commands.push(`ce ${request.args.join(' ')}`);
      const spec = options.spawn ?? { exitCode: 0, signal: null };
      return typeof spec === 'function' ? spec(request) : spec;
    },
    platform: options.platform ?? 'linux',
    arch: 'x64',
    home: '/home/runner',
    cwd,
    playwrightVersion: () => '1.50.0',
    listEntries: () => {
      listCalls += 1;
      return listCalls === 1 || !newRunDir ? [] : [RUN_DIR_NAME];
    },
    async readRunRecord(dir) {
      expect(dir).toBe(runDir);
      return record;
    },
    readEventFile: () => {
      if (event === undefined) throw new Error('ENOENT');
      return JSON.stringify(event);
    },
  };
  return { deps, writes, requests, commands, spawned, outputs, summary, logs, comments, jev, jevAsk, cwd };
}

const ALLOWED_WRITES = new Set(['artifact.upload', 'cache.save', 'comment.create', 'comment.update']);

function expectNoForbiddenWrites(h: Harness): void {
  // Only the three permitted writes exist.
  for (const w of h.writes) expect(ALLOWED_WRITES.has(w)).toBe(true);
  // Every GitHub API request is a read or a comment create/update; nothing touches refs, contents or branches.
  for (const r of h.requests) {
    expect(r).toMatch(/^(GET list-comments|POST create-comment|PATCH update-comment)/);
  }
  // No Git command was run by any process the fakes saw.
  for (const c of h.commands) expect(c).not.toMatch(/\bgit\b/);
  for (const s of h.spawned) expect(s.args.some((a) => a === 'git')).toBe(false);
  // No Jev call can have happened.
  expect(h.jevAsk).not.toHaveBeenCalled();
}

describe('runAction: success path', () => {
  it('sets all five outputs, creates one comment and ends with the CLI exit code', async () => {
    const record = sample(evidencedRunRecordArb);
    const h = harness({ record });
    const code = await runAction(h.deps);
    expect(code).toBe(0);
    expect(h.outputs).toEqual({
      outcome: record.outcome,
      'run-dir': join(h.cwd, '.ce/runs', RUN_DIR_NAME),
      'artifact-url': 'https://github.com/o/r/actions/runs/42/artifacts/555',
      'comment-url': 'https://github.com/o/r/pull/7#issuecomment-100',
      'exit-code': '0',
    });
    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]!.body).toContain(COMMENT_MARKER);
    expect(h.summary).toEqual([]);
    expect(h.writes).toEqual(['cache.save', 'artifact.upload', 'comment.create']);
    expectNoForbiddenWrites(h);
  });

  it('updates the existing marked comment instead of creating another', async () => {
    const h = harness({
      existingComments: [
        { id: 9, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]' } },
      ],
    });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.writes).toEqual(['cache.save', 'artifact.upload', 'comment.update']);
    expect(h.outputs['comment-url']).toContain('issuecomment-9');
    expectNoForbiddenWrites(h);
  });

  it('passes the CLI exit code through and reports it in the output', async () => {
    const h = harness({ record: sample(errorRunRecordArb), spawn: { exitCode: 3, signal: null } });
    expect(await runAction(h.deps)).toBe(3);
    expect(h.outputs['exit-code']).toBe('3');
    expect(h.outputs['outcome']).toBe('ERROR');
  });

  it('skips the cache save on a cache hit', async () => {
    const h = harness({ cacheHit: true });
    await runAction(h.deps);
    expect(h.writes).not.toContain('cache.save');
    expect(h.commands).not.toContain('playwright install chromium');
    // Linux packages are still installed on a hit.
    expect(h.commands).toContain('playwright install-deps chromium');
  });
});

describe('runAction: child argv and env (Requirement 5.11)', () => {
  it('passes an argument vector without a shell and a sanitized environment', async () => {
    const h = harness({
      inputs: {
        config: 'conf/ce.yml',
        base: 'origin/main',
        claim: 'login works\n--evil flag\n\nlogout works',
        'runtime-max-steps': '9',
      },
      env: {
        INPUT_CLAIM: 'x',
        ACTIONS_RUNTIME_TOKEN: 'rt',
        GITHUB_TOKEN: 'gt',
        GH_TOKEN: 'gh',
        RENAMED_TOKEN: TOKEN,
        CE_OTHER: 'kept',
        GITHUB_EVENT_PATH: '/event.json',
      },
    });
    await runAction(h.deps);
    expect(h.spawned).toHaveLength(1);
    const req = h.spawned[0]!;
    expect(req.args).toEqual([
      'run',
      '--config',
      'conf/ce.yml',
      '--base',
      'origin/main',
      '--claim',
      'login works',
      '--claim',
      'logout works',
    ]);
    expect(req.cwd).toBe(h.cwd);
    for (const name of ['INPUT_CLAIM', 'ACTIONS_RUNTIME_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'RENAMED_TOKEN']) {
      expect(req.env).not.toHaveProperty(name);
    }
    expect(Object.values(req.env)).not.toContain(TOKEN);
    expect(req.env['CE_OTHER']).toBe('kept');
    expect(req.env['GITHUB_EVENT_PATH']).toBe('/event.json');
    expect(req.env['CE_RUNTIME_MAX_STEPS']).toBe('9');
    expect(req.env['PLAYWRIGHT_BROWSERS_PATH']).toBe('/home/runner/.cache/ms-playwright');
    expect(h.logs.warning.some((w) => w.includes("starts with '--'"))).toBe(true);
    expect(h.logs.mask).toContain(TOKEN);
  });
});

describe('runAction: where the report goes', () => {
  it('writes a job summary without the marker for a non-pull-request event', async () => {
    const h = harness({ env: { GITHUB_EVENT_NAME: 'push' } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.requests).toEqual([]);
    expect(h.summary).toHaveLength(1);
    expect(h.summary[0]).not.toContain(COMMENT_MARKER);
    expect(h.outputs['comment-url']).toBe('');
    expectNoForbiddenWrites(h);
  });

  it('does not call the comment API for a fork pull request', async () => {
    const h = harness({
      event: {
        pull_request: {
          number: 7,
          head: { repo: { full_name: 'fork/r' } },
          base: { repo: { full_name: 'o/r' } },
        },
      },
    });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.requests).toEqual([]);
    expect(h.summary).toHaveLength(1);
    expect(h.summary[0]).not.toContain(COMMENT_MARKER);
    expect(h.logs.warning.some((w) => w.includes('Fork pull request'))).toBe(true);
    expect(h.outputs['comment-url']).toBe('');
  });

  it('does not call the comment API when comment is false', async () => {
    const h = harness({ inputs: { comment: 'false' } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.requests).toEqual([]);
    expect(h.summary).toHaveLength(1);
    expect(h.summary[0]).not.toContain(COMMENT_MARKER);
  });

  it('treats an unreadable event file as not a pull request', async () => {
    const h = harness({ event: undefined });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.requests).toEqual([]);
    expect(h.summary).toHaveLength(1);
  });
});

describe('runAction: comment API failures are warnings', () => {
  it('HTTP 403 leaves the step exit code equal to the CLI exit code', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const h = harness({ apiError: err, spawn: { exitCode: 2, signal: null } });
    expect(await runAction(h.deps)).toBe(2);
    expect(h.logs.warning.some((w) => w.includes('HTTP 403') && w.includes('pull-requests: write'))).toBe(true);
    expect(h.logs.error).toEqual([]);
    expect(h.summary).toHaveLength(1);
    expect(h.outputs['comment-url']).toBe('');
    expect(h.outputs['exit-code']).toBe('2');
  });

  it('another API failure leaves the step exit code equal to the CLI exit code', async () => {
    const err = Object.assign(new Error('boom'), { status: 500 });
    const h = harness({ apiError: err });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.warning.some((w) => w.includes('HTTP 500'))).toBe(true);
    expect(h.logs.error).toEqual([]);
    expect(h.summary).toHaveLength(1);
  });

  it('an API failure with no status is still a warning', async () => {
    const h = harness({ apiError: new Error('network down') });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.warning.some((w) => w.includes('no HTTP status'))).toBe(true);
  });
});

describe('runAction: CLI process failures', () => {
  it('fails the step on spawn failure, still uploads the artifact, and leaves exit-code empty', async () => {
    const h = harness({
      spawn: { exitCode: null, signal: null, error: new Error('ENOENT') },
      record: undefined,
    });
    expect(await runAction(h.deps)).toBe(1);
    expect(h.logs.error.some((e) => e.includes('could not be started'))).toBe(true);
    expect(h.writes).toContain('artifact.upload');
    expect(h.outputs['exit-code']).toBe('');
    expect(h.outputs['outcome']).toBe('');
  });

  it('fails the step on a signal exit and still uploads the artifact', async () => {
    const h = harness({ spawn: { exitCode: null, signal: 'SIGKILL' } });
    expect(await runAction(h.deps)).toBe(1);
    expect(h.logs.error.some((e) => e.includes('SIGKILL'))).toBe(true);
    expect(h.writes).toContain('artifact.upload');
    expect(h.outputs['exit-code']).toBe('');
  });
});

describe('runAction: setup and upload failures', () => {
  it('an upload failure is a warning and leaves artifact-url empty', async () => {
    const h = harness({ uploadError: new Error('quota') });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.warning.some((w) => w.includes('Artifact upload failed'))).toBe(true);
    expect(h.outputs['artifact-url']).toBe('');
    expect(h.outputs['run-dir']).toBe(join(h.cwd, '.ce/runs', RUN_DIR_NAME));
  });

  it('an upload without an id falls back to the run URL', async () => {
    const h = harness({ uploadResult: {} });
    await runAction(h.deps);
    expect(h.outputs['artifact-url']).toBe('https://github.com/o/r/actions/runs/42');
  });

  it('a cache restore failure is a warning and the run continues with an install', async () => {
    const h = harness({ cacheRestoreError: new Error('cache service down') });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.warning.some((w) => w.includes('cache restore failed'))).toBe(true);
    expect(h.commands).toContain('playwright install chromium');
    expect(h.spawned).toHaveLength(1);
  });

  it('an install failure stops before the CLI and writes nothing', async () => {
    const h = harness({ installError: new Error('download failed') });
    expect(await runAction(h.deps)).toBe(1);
    expect(h.spawned).toHaveLength(0);
    expect(h.logs.error.some((e) => e.includes('CE was not run'))).toBe(true);
    expect(h.writes).toEqual([]);
    expect(h.requests).toEqual([]);
    expect(h.outputs).toEqual({});
  });

  it('a missing Run_Dir skips the upload, warns, and leaves run-dir empty', async () => {
    const h = harness({ newRunDir: false, record: undefined });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.warning.some((w) => w.includes('No new Run_Dir'))).toBe(true);
    expect(h.writes).not.toContain('artifact.upload');
    expect(h.outputs['run-dir']).toBe('');
    expect(h.outputs['artifact-url']).toBe('');
    expect(h.outputs['outcome']).toBe('');
    // The unavailable-record comment is still produced.
    expect(h.comments).toHaveLength(1);
  });
});

describe('runAction: publish input validation', () => {
  it.each([['bogus'], ['BRANCH'], ['push']])(
    'publish: %s fails before any side effect and writes nothing',
    async (value) => {
      const h = harness({ inputs: { publish: value } });
      expect(await runAction(h.deps)).toBe(1);
      expect(h.logs.error).toHaveLength(1);
      expect(h.logs.error[0]).toContain('"none" and "branch"');
      expect(h.spawned).toHaveLength(0);
      expect(h.commands).toEqual([]);
      expect(h.writes).toEqual([]);
      expect(h.requests).toEqual([]);
      expect(h.summary).toEqual([]);
      expect(h.outputs).toEqual({});
      expect(h.logs.mask).toEqual([]);
      expect(h.jevAsk).not.toHaveBeenCalled();
    },
  );

  it('publish: branch is accepted and no longer reports "not implemented"', async () => {
    const h = harness({ inputs: { publish: 'branch' } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.logs.error).toEqual([]);
    expect(h.spawned).toHaveLength(1);
    expect(h.logs.info.some((m) => m.startsWith('publish: branch'))).toBe(true);
  });

  it.each([[''], ['none']])('publish: "%s" runs normally', async (value) => {
    const h = harness({ inputs: { publish: value } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.spawned).toHaveLength(1);
    expectNoForbiddenWrites(h);
  });
});

describe('runAction: evidence-branch guard (Requirement 12)', () => {
  it.each([
    [{ GITHUB_REF: 'refs/heads/ce-evidence' }],
    [{ GITHUB_HEAD_REF: 'ce-evidence' }],
    [{ GITHUB_BASE_REF: 'ce-evidence' }],
  ])('ends with exit 0 and empty outcome, before any side effect (%j)', async (env) => {
    const h = harness({ env, inputs: { publish: 'bogus' } });
    expect(await runAction(h.deps)).toBe(0);
    // Ran before input validation, so the bad `publish` value was never looked at.
    expect(h.logs.error).toEqual([]);
    expect(h.logs.info).toHaveLength(1);
    expect(h.outputs).toEqual({ outcome: '', 'exit-code': '0' });
    expect(h.spawned).toHaveLength(0);
    expect(h.commands).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.requests).toEqual([]);
    expect(h.logs.mask).toEqual([]);
  });

  it('does not match a branch that merely contains the name', async () => {
    const h = harness({ env: { GITHUB_HEAD_REF: 'feature/ce-evidence-docs' } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.spawned).toHaveLength(1);
  });
});

describe('runAction: token resolution and masking (Requirement 1.4, 7.2)', () => {
  const b64 = (t: string): string => Buffer.from(`x-access-token:${t}`).toString('base64');

  it('masks the token, its base64 form and the full header, before the cache restore', async () => {
    const h = harness({ inputs: { token: 'tok-A', 'github-token': 'tok-B', 'default-token': 'tok-C' } });
    const order: string[] = [];
    const restore = h.deps.adapters.cache.restore.bind(h.deps.adapters.cache);
    h.deps.adapters.cache.restore = async (p, k) => {
      order.push(`restore after ${h.logs.mask.length} masks`);
      return restore(p, k);
    };
    await runAction(h.deps);
    expect(h.logs.mask).toEqual(['tok-A', b64('tok-A'), `AUTHORIZATION: basic ${b64('tok-A')}`]);
    expect(order).toEqual(['restore after 3 masks']);
  });

  it('uses github-token alone, and default-token when both are empty', async () => {
    const a = harness({ inputs: { 'github-token': 'only-gh' } });
    await runAction(a.deps);
    expect(a.logs.mask[0]).toBe('only-gh');
    const b = harness({ inputs: { 'github-token': '', 'default-token': 'dflt' } });
    await runAction(b.deps);
    expect(b.logs.mask[0]).toBe('dflt');
  });

  it('keeps every masked value out of the CE_CLI child environment', async () => {
    const h = harness({ inputs: { token: 'tok-A' } });
    await runAction(h.deps);
    const values = Object.values(h.spawned[0]!.env);
    for (const v of ['tok-A', b64('tok-A'), `AUTHORIZATION: basic ${b64('tok-A')}`]) {
      expect(values).not.toContain(v);
    }
  });
});

describe('runAction: no-write check', () => {
  it('records only artifact upload, cache save and comment create/update across a full run', async () => {
    const h = harness();
    await runAction(h.deps);
    expect(new Set(h.writes)).toEqual(new Set(['cache.save', 'artifact.upload', 'comment.create']));
    expect(h.requests).toEqual(['GET list-comments page=1', 'POST create-comment']);
    expectNoForbiddenWrites(h);
  });

  it('never calls the Jev gateway on any path', async () => {
    for (const options of [
      {},
      { env: { GITHUB_EVENT_NAME: 'push' } },
      { spawn: { exitCode: null, signal: 'SIGTERM' } as SpawnResult },
      { installError: new Error('x') },
    ] as Options[]) {
      const h = harness(options);
      await runAction(h.deps);
      expect(h.jevAsk).not.toHaveBeenCalled();
    }
  });
});
