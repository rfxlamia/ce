// Wiring tests for the publish pipeline in `runAction` (task 7.3).
// Fakes only: no process, network, Git remote, cache, artifact service or Jev call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMENT_MARKER } from 'continuous-evidence';
import type { RunRecord } from 'continuous-evidence';
import { runAction } from './index.js';
import type { ActionDeps } from './index.js';
import { fallbackNote } from './publish/fallback.js';
import type { FallbackReason } from './publish/fallback.js';
import { GitCommandError } from './publish/git-runner.js';
import type { GitInvocation, GitResult } from './publish/git-runner.js';
import type { DirectoryEntry } from './publish/select.js';
import type { CommentApi } from './upsert.js';
import {
  evidencedRunRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from '../../packages/ce/src/evidence/arbitraries.js';

const TOKEN = 'ghs_wiringtokenvalue456';
const RUN_DIR_NAME = 'run-2026-01-01T00-00-00-000Z';

type GitBehavior = (inv: GitInvocation) => GitResult | Error;

interface Options {
  inputs?: Record<string, string>;
  env?: Record<string, string>;
  record?: RunRecord | undefined;
  event?: unknown;
  git?: GitBehavior;
  listing?: DirectoryEntry[];
  exitCode?: number;
}

const sameRepoEvent = (headRef = 'feature/x', baseRef = 'main') => ({
  pull_request: {
    number: 7,
    head: { ref: headRef, repo: { full_name: 'o/r' } },
    base: { ref: baseRef, repo: { full_name: 'o/r' } },
  },
});
const forkEvent = {
  pull_request: {
    number: 7,
    head: { ref: 'feature/x', repo: { full_name: 'fork/r' } },
    base: { ref: 'main', repo: { full_name: 'o/r' } },
  },
};

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-wiring-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function sample<T>(arb: fc.Arbitrary<T>): T {
  return fc.sample(arb, 1)[0]!;
}

/** An EVIDENCED record whose only screenshot is `final.png`. */
function evidencedWithFinal(): RunRecord {
  const rec = sample(evidencedRunRecordArb) as unknown as Record<string, unknown>;
  const finalImage = (rec['finalImage'] ?? {}) as Record<string, unknown>;
  return { ...rec, steps: [], finalImage: { ...finalImage, screenshot: 'final.png' } } as unknown as RunRecord;
}
const finalListing: DirectoryEntry[] = [{ relativePath: 'final.png', isFile: true, sizeBytes: 1000 }];

function gitError(stderr: string): GitCommandError {
  return new GitCommandError({ exitCode: 128, stdout: '', stderr });
}

function harness(options: Options = {}) {
  const inputs: Record<string, string> = { publish: 'branch', 'github-token': TOKEN, ...options.inputs };
  const gitCalls: GitInvocation[] = [];
  const apiRequests: string[] = [];
  const commentBodies: string[] = [];
  const summary: string[] = [];
  const outputs: Record<string, string> = {};
  const logs = { info: [] as string[], warning: [] as string[], error: [] as string[], mask: [] as string[] };
  const commands: string[] = [];
  const record = 'record' in options ? options.record : sample(skippedRunRecordArb);
  const event = 'event' in options ? options.event : sameRepoEvent();
  let listCalls = 0;
  let commentToken: string | undefined;

  const commentApi: CommentApi = {
    async listComments() {
      apiRequests.push('GET list-comments');
      return [];
    },
    async createComment(_pr, body) {
      apiRequests.push('POST create-comment');
      commentBodies.push(body);
      return { id: 1, html_url: 'https://github.com/o/r/pull/7#issuecomment-1' };
    },
    async updateComment(id) {
      apiRequests.push(`PATCH update-comment ${id}`);
      return { id, html_url: 'x' };
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
      cache: { restore: async () => false, save: async () => undefined },
      installer: {
        installChromium: async () => void commands.push('playwright install chromium'),
        installLinuxDeps: async () => void commands.push('playwright install-deps chromium'),
      },
      artifacts: { upload: async () => ({ id: 555 }) },
      summary: { append: (b) => void summary.push(b) },
      outputs: { set: (n, v) => void (outputs[n] = v) },
      log: {
        info: (m) => void logs.info.push(m),
        warning: (m) => void logs.warning.push(m),
        error: (m) => void logs.error.push(m),
        mask: (v) => void logs.mask.push(v),
      },
      commentApi: (opts) => {
        commentToken = opts.token;
        return commentApi;
      },
    },
    async spawnCli(request) {
      commands.push(`ce ${request.args.join(' ')}`);
      return { exitCode: options.exitCode ?? 0, signal: null };
    },
    platform: 'linux',
    arch: 'x64',
    home: '/home/runner',
    cwd,
    playwrightVersion: () => '1.50.0',
    listEntries: () => {
      listCalls += 1;
      return listCalls === 1 ? [] : [RUN_DIR_NAME];
    },
    readRunRecord: async () => record,
    readEventFile: () => {
      if (event === undefined) throw new Error('ENOENT');
      return JSON.stringify(event);
    },
    gitRunner: async (inv) => {
      gitCalls.push(inv);
      const result = options.git?.(inv) ?? { exitCode: 0, stdout: '', stderr: '' };
      if (result instanceof Error) throw result;
      return result;
    },
    listRunFiles: () => options.listing ?? [],
  };
  return {
    deps,
    gitCalls,
    apiRequests,
    commentBodies,
    summary,
    outputs,
    logs,
    commands,
    commentToken: () => commentToken,
  };
}

/** The three outcome-independent anchors that must survive any publish decision. */
function renderedReport(h: ReturnType<typeof harness>): string {
  return h.commentBodies[0] ?? h.summary.join('\n');
}

describe('publish wiring: fork pull request (Requirement 10.1, 10.4)', () => {
  it('makes no Git call, shows the fork note, and keeps the exit code', async () => {
    const h = harness({ record: evidencedWithFinal(), listing: finalListing, event: forkEvent, exitCode: 0 });
    const code = await runAction(h.deps);
    expect(code).toBe(0);
    expect(h.outputs['exit-code']).toBe('0');
    expect(h.gitCalls).toEqual([]);
    // A fork cannot comment, so the report goes to the job summary with the note.
    expect(h.apiRequests).toEqual([]);
    expect(renderedReport(h)).toContain(fallbackNote('fork-pr'));
    expect(renderedReport(h)).not.toContain('![');
  });

  it('keeps a non-zero CLI exit code unchanged on a fork', async () => {
    const h = harness({ record: evidencedWithFinal(), listing: finalListing, event: forkEvent, exitCode: 3 });
    expect(await runAction(h.deps)).toBe(3);
    expect(h.gitCalls).toEqual([]);
  });

  it('treats a payload with missing repository names as a fork', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      event: { pull_request: { number: 7, head: { ref: 'a' }, base: { ref: 'main' } } },
    });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(renderedReport(h)).toContain(fallbackNote('fork-pr'));
  });
});

describe('publish wiring: evidence-branch guard (Requirement 12.1)', () => {
  it('ends the run before anything else when GITHUB_REF is ce-evidence', async () => {
    const h = harness({ env: { GITHUB_REF: 'refs/heads/ce-evidence' } });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.outputs).toEqual({ outcome: '', 'exit-code': '0' });
    expect(h.commands).toEqual([]);
    expect(h.gitCalls).toEqual([]);
    expect(h.apiRequests).toEqual([]);
  });

  it('falls back with the ref-guard note when the PR head ref is ce-evidence', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      event: sameRepoEvent('ce-evidence'),
    });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(renderedReport(h)).toContain(fallbackNote('ref-guard'));
  });

  it('does not match feature/ce-evidence-docs, so publishing proceeds', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      event: sameRepoEvent('feature/ce-evidence-docs'),
      env: { GITHUB_HEAD_REF: 'feature/ce-evidence-docs', GITHUB_REF: 'refs/pull/7/merge' },
    });
    await runAction(h.deps);
    expect(h.outputs['outcome']).not.toBe('');
    expect(h.gitCalls.length).toBeGreaterThan(0);
    expect(renderedReport(h)).not.toContain(fallbackNote('ref-guard'));
  });
});

describe('publish wiring: pre-Publisher decisions (Requirement 2.3, 2.8, 2.9, 2.10)', () => {
  it('comment: false publishes nothing and notes why', async () => {
    const h = harness({
      inputs: { comment: 'false' },
      record: evidencedWithFinal(),
      listing: finalListing,
    });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(h.apiRequests).toEqual([]);
    expect(h.logs.info.some((m) => m.includes('comment is false'))).toBe(true);
    expect(h.logs.warning).toEqual([]);
    for (const reason of ['fork-pr', 'ref-guard', 'git-error'] as const) {
      expect(renderedReport(h)).not.toContain(fallbackNote(reason));
    }
  });

  it.each([
    ['SKIPPED', () => sample(skippedRunRecordArb) as RunRecord],
    ['UNSUPPORTED', () => sample(unsupportedRunRecordArb) as RunRecord],
  ])('Outcome %s gives not-attempted: no Git call, no fallback note, no warning', async (_n, make) => {
    const h = harness({ record: make(), listing: finalListing });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(h.logs.warning).toEqual([]);
    expect(renderedReport(h)).toContain(COMMENT_MARKER);
    expect(renderedReport(h)).not.toMatch(/publish skipped/);
  });

  it('Outcome check comes before the fork check', async () => {
    const h = harness({ record: sample(skippedRunRecordArb) as RunRecord, event: forkEvent });
    await runAction(h.deps);
    expect(renderedReport(h)).not.toContain(fallbackNote('fork-pr'));
    expect(h.logs.warning.some((m) => m.includes(fallbackNote('fork-pr')))).toBe(false);
  });

  it('comment check comes before the fork check', async () => {
    const h = harness({
      inputs: { comment: 'false' },
      record: evidencedWithFinal(),
      listing: finalListing,
      event: forkEvent,
    });
    await runAction(h.deps);
    expect(renderedReport(h)).not.toContain(fallbackNote('fork-pr'));
  });

  it('fork check comes before the evidence-branch check', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      event: {
        pull_request: {
          number: 7,
          head: { ref: 'ce-evidence', repo: { full_name: 'fork/r' } },
          base: { ref: 'main', repo: { full_name: 'o/r' } },
        },
      },
    });
    await runAction(h.deps);
    expect(renderedReport(h)).toContain(fallbackNote('fork-pr'));
    expect(renderedReport(h)).not.toContain(fallbackNote('ref-guard'));
  });

  it('a non-pull-request event gives no-pr-number silently, without a Git call', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      env: { GITHUB_EVENT_NAME: 'push' },
    });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(h.logs.warning).toEqual([]);
    expect(renderedReport(h)).toContain(fallbackNote('no-pr-number'));
  });

  it('an unavailable Run_Record continues to the Publisher and ends in no-images without a Git call', async () => {
    const h = harness({ record: undefined, listing: finalListing });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
    expect(h.logs.warning.every((m) => !m.includes('publish skipped'))).toBe(true);
    expect(renderedReport(h)).toContain(fallbackNote('no-images'));
  });
});

describe('publish wiring: publish: none regression (Requirement 3.1, 3.3)', () => {
  it('runs no Git command and renders no publish note', async () => {
    const h = harness({
      inputs: { publish: 'none' },
      record: evidencedWithFinal(),
      listing: finalListing,
    });
    expect(await runAction(h.deps)).toBe(0);
    expect(h.gitCalls).toEqual([]);
    for (const c of h.commands) expect(c).not.toMatch(/\bgit\b/);
    for (const r of h.apiRequests) expect(r).toMatch(/^(GET list-comments|POST create-comment|PATCH update-comment)/);
    expect(renderedReport(h)).not.toMatch(/publish skipped|!\[/);
    expect(h.logs.warning).toEqual([]);
  });

  it('an empty publish input behaves as none', async () => {
    const h = harness({ inputs: { publish: '' }, record: evidencedWithFinal(), listing: finalListing });
    await runAction(h.deps);
    expect(h.gitCalls).toEqual([]);
  });
});

describe('publish wiring: only github-token is set (Requirement 1.4)', () => {
  it('uses github-token for the Git credential, the comment API and masking', async () => {
    const h = harness({
      record: evidencedWithFinal(),
      listing: finalListing,
      git: (inv) =>
        inv.args.includes('fetch') ? gitError('fatal: unexpected failure') : { exitCode: 0, stdout: '', stderr: '' },
    });
    await runAction(h.deps);
    expect(h.logs.mask).toContain(TOKEN);
    expect(h.commentToken()).toBe(TOKEN);
    expect(h.gitCalls.length).toBeGreaterThan(0);
    const expectedHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
    const withCredential = h.gitCalls.filter((c) => c.env['GIT_CONFIG_VALUE_0'] !== undefined);
    expect(withCredential.length).toBeGreaterThan(0);
    for (const c of withCredential) expect(c.env['GIT_CONFIG_VALUE_0']).toBe(expectedHeader);
    for (const c of h.gitCalls) expect(c.args.join(' ')).not.toContain(TOKEN);
  });

  it('prefers token over github-token and default-token', async () => {
    const h = harness({
      inputs: { token: 'ghs_explicit', 'default-token': 'ghs_default' },
      record: evidencedWithFinal(),
      listing: finalListing,
      git: () => gitError('fatal: unexpected failure'),
    });
    await runAction(h.deps);
    expect(h.commentToken()).toBe('ghs_explicit');
  });
});

describe('publish wiring: fallback warnings (Property 9, Requirement 11.6)', () => {
  const scenarios: Array<{
    reason: FallbackReason;
    silent: boolean;
    options: () => Options;
  }> = [
    { reason: 'fork-pr', silent: false, options: () => ({ event: forkEvent }) },
    { reason: 'ref-guard', silent: false, options: () => ({ event: sameRepoEvent('ce-evidence') }) },
    { reason: 'no-pr-number', silent: true, options: () => ({ env: { GITHUB_EVENT_NAME: 'push' } }) },
    { reason: 'no-images', silent: true, options: () => ({ listing: [] }) },
    {
      reason: 'token-lacks-write',
      silent: false,
      options: () => ({ git: () => gitError('remote: Permission denied to github-actions[bot].\nfatal: 403') }),
    },
    {
      reason: 'push-blocked',
      silent: false,
      options: () => ({ git: () => gitError('remote: error: GH006: Protected branch update failed') }),
    },
    {
      reason: 'git-error',
      silent: false,
      options: () => ({ git: () => gitError('fatal: something odd') }),
    },
  ];

  it.each(scenarios)('$reason: warning written iff not silent', async ({ reason, silent, options }) => {
    const h = harness({ record: evidencedWithFinal(), listing: finalListing, ...options() });
    expect(await runAction(h.deps)).toBe(0);
    const note = fallbackNote(reason);
    expect(renderedReport(h)).toContain(note);
    const warnings = h.logs.warning.filter((m) => m.includes(note));
    expect(warnings).toHaveLength(silent ? 0 : 1);
    if (silent) expect(h.logs.warning).toEqual([]);
    // Publishing never changes the outcome output or the exit code.
    expect(h.outputs['exit-code']).toBe('0');
  });
});
