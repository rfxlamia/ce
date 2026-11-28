// Feature: inline-screenshot-in-pr, Property 10: Git invocations never carry the Run_Token in argv, and always carry the four fixed environment entries
// Feature: inline-screenshot-in-pr, Property 11: The commit message is a fixed template containing no Claim, diff, or secret text
// **Validates: Requirements 5.5, 5.6, 5.15, 7.8**
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunRecord } from 'continuous-evidence';
import { GitCommandError } from './git-runner.js';
import type { GitInvocation, GitRunner } from './git-runner.js';
import { buildCommitMessage, publish } from './publisher.js';

const NUM_RUNS = 100;
const SHA = 'a'.repeat(40);

const FIXED_ENV = {
  LC_ALL: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

let base: string;
let runDir: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'ce-publisher-test-'));
  runDir = join(base, 'run');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'step-0-final.png'), 'png');
  await writeFile(join(runDir, 'step-0.png'), 'png');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const record = {
  outcome: 'EVIDENCED',
  steps: [{ screenshot: 'step-0.png', executed: true }],
  finalImage: { screenshot: 'step-0-final.png' },
} as unknown as RunRecord;

const listing = [
  { relativePath: 'step-0-final.png', isFile: true, sizeBytes: 3 },
  { relativePath: 'step-0.png', isFile: true, sizeBytes: 3 },
];

function rejection(stderr: string): GitCommandError {
  return new GitCommandError({ exitCode: 1, stdout: '', stderr });
}

/**
 * Recording fake runner. The first fetch finds no branch (orphan create), the
 * first `rejectedPushes` pushes are rejected as non-fast-forward, later ones succeed.
 */
function recordingRunner(rejectedPushes: number): { runner: GitRunner; calls: GitInvocation[] } {
  const calls: GitInvocation[] = [];
  let fetches = 0;
  let pushes = 0;
  const runner: GitRunner = async (invocation) => {
    calls.push({ args: [...invocation.args], cwd: invocation.cwd, env: { ...invocation.env } });
    const [cmd] = invocation.args;
    if (cmd === 'fetch') {
      fetches += 1;
      if (fetches === 1) throw rejection("fatal: couldn't find remote ref refs/heads/ce-evidence");
    }
    if (cmd === 'push') {
      pushes += 1;
      if (pushes <= rejectedPushes) {
        throw rejection('! [rejected] HEAD -> ce-evidence (fetch first)\nerror: failed to push some refs');
      }
    }
    if (cmd === 'rev-parse') return { exitCode: 0, stdout: `${SHA}\n`, stderr: '' };
    if (cmd === 'ls-remote') return { exitCode: 0, stdout: `${SHA}\trefs/heads/ce-evidence\n`, stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

// Distinctive tokens: long, prefixed, so they cannot appear by chance in a fixed argv or env value.
const tokenArb = fc
  .stringMatching(/^[A-Za-z0-9_]{12,40}$/)
  .map((s) => `tok_${s}`);
const tokenWithOddCharsArb = fc.oneof(
  tokenArb,
  fc.string({ minLength: 12, maxLength: 40 }).map((s) => `tok_${s}`),
);
const prArb = fc.integer({ min: 1, max: 100000 });
const runIdArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,30}$/).filter((s) => !s.includes('..'));

describe('Property 10: Git invocations never carry the Run_Token in argv, and always carry the fixed environment', () => {
  it('holds for the initial attempt and every retry, including exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenWithOddCharsArb,
        fc.integer({ min: 0, max: 4 }),
        prArb,
        runIdArb,
        async (token, rejectedPushes, prNumber, runId) => {
          const { runner, calls } = recordingRunner(rejectedPushes);
          const result = await publish({
            runner,
            runToken: token,
            record,
            runDir,
            listing,
            prNumber,
            runId,
            owner: 'octo',
            repo: 'repo',
            serverUrl: 'https://github.com',
            imageCap: 6,
            byteCapBytes: 5_242_880,
            tmpBase: base,
          });

          // 0..3 rejections end in success; 4 exhausts the three retries.
          expect(result.kind).toBe(rejectedPushes <= 3 ? 'published' : 'fallback');
          if (rejectedPushes > 3) {
            expect(result).toEqual({ kind: 'fallback', reason: 'push-conflict-exhausted' });
          }
          const pushes = calls.filter((c) => c.args[0] === 'push');
          expect(pushes).toHaveLength(Math.min(rejectedPushes, 4) + (rejectedPushes <= 3 ? 1 : 0));
          expect(calls.length).toBeGreaterThan(0);

          const b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
          const header = `AUTHORIZATION: basic ${b64}`;
          for (const call of calls) {
            for (const [key, value] of Object.entries(FIXED_ENV)) {
              expect(call.env[key]).toBe(value);
            }
            for (const arg of call.args) {
              expect(arg.includes(token)).toBe(false);
              expect(arg.includes(b64)).toBe(false);
            }
            for (const [key, value] of Object.entries(call.env)) {
              if (key === 'GIT_CONFIG_VALUE_0') {
                expect(value).toBe(header);
              } else {
                expect(value.includes(token)).toBe(false);
                expect(value.includes(b64)).toBe(false);
              }
            }
          }
          // Remote-contacting commands carry the credential; local ones do not.
          for (const call of calls.filter((c) => ['fetch', 'push', 'ls-remote'].includes(c.args[0] ?? ''))) {
            expect(call.env['GIT_CONFIG_VALUE_0']).toBe(header);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never passes --force to push', async () => {
    const { runner, calls } = recordingRunner(2);
    await publish({
      runner,
      runToken: 'tok_abcdefghijkl',
      record,
      runDir,
      listing,
      prNumber: 7,
      runId: 'run-1',
      owner: 'octo',
      repo: 'repo',
      serverUrl: 'https://github.com',
      imageCap: 6,
      byteCapBytes: 5_242_880,
      tmpBase: base,
    });
    for (const call of calls.filter((c) => c.args[0] === 'push')) {
      expect(call.args.some((a) => a === '--force' || a === '-f' || a.startsWith('+'))).toBe(false);
    }
  });
});

describe('Property 11: the commit message is a fixed template', () => {
  it('equals the template and never contains unrelated Claim, diff, or secret text', () => {
    fc.assert(
      fc.property(prArb, runIdArb, fc.string({ minLength: 1, maxLength: 60 }), (n, runId, forbidden) => {
        const expected = `ce: evidence for PR #${n} (${runId})`;
        fc.pre(!expected.includes(forbidden));
        const message = buildCommitMessage(n, runId);
        expect(message).toBe(expected);
        expect(message.includes(forbidden)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is the exact -m argument of every commit, initial and retried', async () => {
    await fc.assert(
      fc.asyncProperty(
        prArb,
        runIdArb,
        fc.integer({ min: 0, max: 3 }),
        async (prNumber, runId, rejectedPushes) => {
          const { runner, calls } = recordingRunner(rejectedPushes);
          await publish({
            runner,
            runToken: 'tok_abcdefghijkl',
            record,
            runDir,
            listing,
            prNumber,
            runId,
            owner: 'octo',
            repo: 'repo',
            serverUrl: 'https://github.com',
            imageCap: 6,
            byteCapBytes: 5_242_880,
            tmpBase: base,
          });
          const commits = calls.filter((c) => c.args[0] === 'commit');
          expect(commits).toHaveLength(rejectedPushes + 1);
          for (const commit of commits) {
            const at = commit.args.indexOf('-m');
            expect(commit.args[at + 1]).toBe(`ce: evidence for PR #${prNumber} (${runId})`);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('replaces control characters in the Run_Id', () => {
    expect(buildCommitMessage(3, 'a\nb\u0000c')).toBe('ce: evidence for PR #3 (a b c)');
  });
});
