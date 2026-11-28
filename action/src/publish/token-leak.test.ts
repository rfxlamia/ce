/**
 * Token-leak test (task 4.5, Requirement 7.1, 7.2, 7.3, 7.8).
 *
 * A Run_Token of a known random value must not appear, raw or as
 * base64("x-access-token:" + value), in any log line, any recorded Git argument
 * vector, any file in the temporary directory, or any PR_Comment body. This
 * holds on success and when the push fails. The token may appear only in the
 * `GIT_CONFIG_*` environment entries.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { redactSecretValues, renderPrComment } from 'continuous-evidence';
import type { PublishResult, RunRecord } from 'continuous-evidence';
import { evidencedRunRecordArb } from '../../../packages/ce/src/evidence/arbitraries.js';
import { GitCommandError, createGitRunner } from './git-runner.js';
import type { GitInvocation, GitRunner } from './git-runner.js';
import { publish } from './publisher.js';
import type { PublishOptions } from './publisher.js';
import { runAction } from '../index.js';
import type { ActionDeps } from '../index.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const SERVER = 'https://github.com';

let root: string;
let remoteDir: string;
let runDir: string;
let tmpBase: string;
let token: string;
let b64: string;
let header: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ce-leak-'));
  remoteDir = join(root, 'remote.git');
  runDir = join(root, 'run');
  tmpBase = join(root, 'tmp');
  mkdirSync(runDir);
  mkdirSync(tmpBase);
  execFileSync('git', ['init', '--bare', '-q', remoteDir]);
  writeFileSync(join(runDir, 'final.png'), PNG);
  writeFileSync(join(runDir, 'step-0.png'), PNG);
  token = `ghs_${randomBytes(18).toString('hex')}`;
  b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
  header = `AUTHORIZATION: basic ${b64}`;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRecord(): RunRecord {
  const base = fc.sample(evidencedRunRecordArb, 1)[0]! as unknown as Record<string, any>;
  return {
    ...base,
    finalImage: { ...(base['finalImage'] ?? {}), screenshot: 'final.png' },
    steps: [{ ...(base['steps']?.[0] ?? {}), executed: true, screenshot: 'step-0.png' }],
  } as unknown as RunRecord;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function leaks(text: string): boolean {
  return text.includes(token) || text.includes(b64);
}

interface Captured {
  invocations: GitInvocation[];
  tempFileLeaks: string[];
  logs: string[];
}

/** Wraps the real runner: records every invocation and scans the temp dir after each. */
function recordingRunner(captured: Captured, failPushWith?: string): GitRunner {
  const real = createGitRunner();
  return async (invocation) => {
    captured.invocations.push({ ...invocation, args: [...invocation.args] });
    let result;
    if (failPushWith !== undefined && invocation.args[0] === 'push') {
      throw new GitCommandError({ exitCode: 128, stdout: '', stderr: failPushWith });
    }
    try {
      result = await real(invocation);
    } finally {
      for (const file of filesUnder(tmpBase)) {
        const bytes = readFileSync(file);
        if (bytes.includes(token) || bytes.includes(b64)) captured.tempFileLeaks.push(file);
      }
    }
    return result;
  };
}

function options(runner: GitRunner, captured: Captured, extra: Partial<PublishOptions> = {}): PublishOptions {
  const record = makeRecord();
  return {
    runner,
    runToken: token,
    record,
    runDir,
    listing: [
      { relativePath: 'final.png', isFile: true, sizeBytes: PNG.length },
      { relativePath: 'step-0.png', isFile: true, sizeBytes: PNG.length },
    ],
    prNumber: 7,
    runId: 'run-2026-01-01T00-00-00-000Z',
    owner: 'o',
    repo: 'r',
    serverUrl: SERVER,
    imageCap: 6,
    byteCapBytes: 5 * 1024 * 1024,
    tmpBase,
    remoteUrl: remoteDir,
    // The caller redacts before it writes a log line (Requirement 7.3).
    warn: (m) => captured.logs.push(redactSecretValues(m, [token, b64, header])),
    onGitError: (e) => {
      const raw = e instanceof GitCommandError ? `${e.message}\n${e.result.stderr}\n${e.result.stdout}` : String(e);
      captured.logs.push(redactSecretValues(raw, [token, b64, header]));
    },
    ...extra,
  };
}

function commentBody(result: PublishResult, record: RunRecord): string {
  const secrets = [token, b64, header];
  return redactSecretValues(
    renderPrComment({
      record,
      artifactLink: '',
      secrets,
      publishResult: result,
      repository: 'o/r',
      serverUrl: SERVER,
      prNumber: 7,
    }),
    secrets,
  );
}

function expectNoLeak(captured: Captured, body: string): void {
  for (const line of captured.logs) expect(leaks(line)).toBe(false);
  for (const inv of captured.invocations) {
    for (const arg of inv.args) expect(leaks(arg)).toBe(false);
    expect(leaks(inv.cwd)).toBe(false);
  }
  expect(captured.tempFileLeaks).toEqual([]);
  expect(readdirSync(tmpBase)).toEqual([]); // temp directory removed, nothing left behind
  expect(leaks(body)).toBe(false);
  expect(body.includes(header)).toBe(false);
}

describe('Run_Token never leaks (Requirement 7.8)', () => {
  it('on a successful publish', async () => {
    const captured: Captured = { invocations: [], tempFileLeaks: [], logs: [] };
    const opts = options(recordingRunner(captured), captured);
    const result = await publish(opts);
    expect(result.kind).toBe('published');
    expectNoLeak(captured, commentBody(result, opts.record!));
  });

  it('on a failed push whose error text echoes the token, its base64 form, and the header', async () => {
    const captured: Captured = { invocations: [], tempFileLeaks: [], logs: [] };
    const hostile = `remote: Permission denied (403) ${token} ${b64} ${header}`;
    const opts = options(recordingRunner(captured, hostile), captured);
    const result = await publish(opts);
    expect(result).toEqual({ kind: 'fallback', reason: 'token-lacks-write' });
    expect(captured.logs.length).toBeGreaterThan(0);
    expect(captured.logs.join('\n')).toContain('[REDACTED]');
    expectNoLeak(captured, commentBody(result, opts.record!));
  });

  it('on a failed fetch from an unreachable remote', async () => {
    const captured: Captured = { invocations: [], tempFileLeaks: [], logs: [] };
    const opts = options(recordingRunner(captured), captured, { remoteUrl: join(root, 'missing.git') });
    const result = await publish(opts);
    expect(result.kind).toBe('fallback');
    expectNoLeak(captured, commentBody(result, opts.record!));
  });

  it('puts the credential only in the GIT_CONFIG_* environment entries', async () => {
    const captured: Captured = { invocations: [], tempFileLeaks: [], logs: [] };
    await publish(options(recordingRunner(captured), captured));
    const remoteCalls = captured.invocations.filter((i) => leaks(JSON.stringify(i.env)));
    expect(remoteCalls.length).toBeGreaterThan(0);
    for (const inv of remoteCalls) {
      for (const [name, value] of Object.entries(inv.env)) {
        if (leaks(value)) expect(name).toBe('GIT_CONFIG_VALUE_0');
      }
      expect(inv.env['GIT_CONFIG_VALUE_0']).toBe(header);
    }
  });

  it('holds for any random token value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9_]{20,40}$/), async (value) => {
        token = `ghs_${value}`;
        b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
        header = `AUTHORIZATION: basic ${b64}`;
        const captured: Captured = { invocations: [], tempFileLeaks: [], logs: [] };
        const opts = options(recordingRunner(captured), captured);
        const result = await publish(opts);
        expect(result.kind).toBe('published');
        expectNoLeak(captured, commentBody(result, opts.record!));
      }),
      { numRuns: 5 },
    );
  });
});

describe('masking registration (Requirement 7.2)', () => {
  it('the credential header is built from exactly the base64 form that must be masked', async () => {
    const { credentialEnv } = await import('./git-runner.js');
    const env = credentialEnv(token, SERVER);
    expect(env['GIT_CONFIG_VALUE_0']).toBe(header);
    expect(env['GIT_CONFIG_VALUE_0']).toContain(b64);
  });

  // runAction masks the three values before its first side effect (the cache restore),
  // so before the CE_CLI and before any `git` command the publish pipeline will run.
  it('runAction registers the Run_Token, its base64 form, and the header value with log.mask before any other step', async () => {
    const events: string[] = [];
    const masked: string[] = [];
    const deps: ActionDeps = {
      env: { GITHUB_EVENT_NAME: 'push', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' },
      getInput: (name) => (name === 'token' ? token : name === 'publish' ? 'branch' : ''),
      adapters: {
        cache: {
          async restore() {
            events.push('cache.restore');
            return true;
          },
          async save() {
            events.push('cache.save');
          },
        },
        installer: {
          async installChromium() {
            events.push('install');
          },
          async installLinuxDeps() {
            events.push('install-deps');
          },
        },
        artifacts: {
          async upload() {
            events.push('artifact.upload');
            return {};
          },
        },
        summary: { append: () => void events.push('summary') },
        outputs: { set: () => undefined },
        log: {
          info: () => undefined,
          warning: () => undefined,
          error: () => undefined,
          mask: (v) => {
            masked.push(v);
            events.push('mask');
          },
        },
        commentApi: () => {
          throw new Error('no comment API expected');
        },
      },
      async spawnCli() {
        events.push('spawn');
        return { exitCode: 0, signal: null };
      },
      platform: 'linux',
      arch: 'x64',
      home: '/home/runner',
      cwd: root,
      playwrightVersion: () => '1.50.0',
      listEntries: () => [],
      readRunRecord: async () => undefined,
      readEventFile: () => '{}',
    };
    await runAction(deps);
    expect(masked).toEqual([token, b64, header]);
    expect(events.slice(0, 3)).toEqual(['mask', 'mask', 'mask']);
    expect(events.indexOf('spawn')).toBeGreaterThan(2);
  });
});
