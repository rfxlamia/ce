// Pipeline-level test of the Target_Manager error report (runtime-target task 8.2).
// Requirements 4.8, 4.9, 9.5, 9.6, 11.12.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assess } from '../assessment/index.js';
import { loadConfig } from '../config/load.js';
import { resolveContext } from '../context/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import type { RuntimeResult } from '../outcome/index.js';
import { openTarget } from '../runtime/target.js';
import { runRunCommand } from './command.js';
import type { RunCommandDeps } from './command.js';
import { createCapabilityRegistry, EMPTY_REGISTRY } from './capabilities.js';
import type { CreateGateway } from './types.js';

vi.mock('../runtime/target.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/target.js')>();
  return { ...actual, openTarget: vi.fn(actual.openTarget) };
});

const KEY = 'sk-or-dummy-not-a-real-key-0123456789';
const NOW = new Date('2026-01-02T03:04:05.678Z');
const TITLE = 'Add login form';
const WORKSPACE_RUNS = resolve(__dirname, '../../../../.ce/runs');

type Providers = NonNullable<ResolveContextOptions['providers']>;

interface Script {
  runtimeObservable: number;
  checksAdequate: number;
}
const REQUIRED_BROWSER: Script = { runtimeObservable: 0.95, checksAdequate: 0.05 };
const NOT_REQUIRED: Script = { runtimeObservable: 0.05, checksAdequate: 0.95 };

let cwd: string;
let out: string[];
let err: string[];

function fixedProviders(): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: TITLE }, status: { name: 'github', status: 'used' } }),
    cli: () => ({ claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } }),
    junit: () => ({
      checks: [],
      status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
    }),
  } as Providers;
}

const exec = vi.fn(() => ({ error: Object.assign(new Error('no git'), { code: '1' }) }));

function scriptedAnswerer(script: Script): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0])),
          };
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: script.runtimeObservable };
        } else if (name === 'checks_adequate') {
          answers[name] = { type: 'noul', noul: script.checksAdequate };
        } else {
          answers[name] = { type: 'noul', noul: 0.01 };
        }
      }
      return {
        model: 'stub-model',
        answers: answers as Jev_Response['answers'],
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}

async function recordingsFor(script: Script): Promise<Recording[]> {
  const env = { OPENROUTER_API_KEY: KEY };
  const loaded = loadConfig({ cwd, flags: {}, env });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({
    config: loaded.config,
    cliOptions: {},
    env,
    cwd,
    providers: fixedProviders(),
    exec,
  });
  const recordings: Recording[] = [];
  const answerer = scriptedAnswerer(script);
  const capturing: JevGateway = {
    async ask(request, options) {
      const response = await answerer.ask(request, options);
      const hash = stateHash(request.state);
      for (const [name, built] of Object.entries(request.questions)) {
        const answer = response.answers[name];
        if (answer === undefined) continue;
        recordings.push({ idVersion: built.idVersion, stateHash: hash, question: name, answer });
      }
      return response;
    },
  };
  await assess(context, loaded.config, capturing);
  exec.mockClear();
  return recordings;
}

async function fakeDeps(script: Script, capabilities: RunCommandDeps['capabilities']): Promise<RunCommandDeps> {
  const recordings = await recordingsFor(script);
  const createGateway: CreateGateway = () => ({ ok: true, gateway: new FakeJevGateway(recordings) });
  return {
    env: { OPENROUTER_API_KEY: KEY },
    cwd,
    stdout: { write: (t: string) => out.push(t) },
    stderr: { write: (t: string) => err.push(t) },
    createGateway,
    now: () => NOW,
    contextProviders: fixedProviders(),
    exec,
    ...(capabilities !== undefined ? { capabilities } : {}),
  };
}

/** A loopback port with nothing listening on it. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => res(port));
    });
  });
}

function runsListing(): string[] {
  return existsSync(WORKSPACE_RUNS) ? readdirSync(WORKSPACE_RUNS).sort() : [];
}

function registryCalling(url: string): RunCommandDeps['capabilities'] {
  return createCapabilityRegistry([
    {
      name: 'fake-browser',
      surfaces: ['browser_ui'],
      run: async (input) => {
        await openTarget({
          url,
          ready: { timeout: '1s' },
          // The last probe's request timeout shrinks to the remaining Ready_Timeout (Req 3.6), so under
          // load its abort timer can fire before the refusal is delivered and report `timeout`. This
          // test is about the error content, so the probe ignores the abort signal and always
          // observes the real refusal.
          fetch: (input, init) => fetch(input, { ...init, signal: undefined }),
          cwd,
          env: {},
          ...(input.runDir !== undefined ? { runDir: input.runDir } : {}),
        });
        return {} as RuntimeResult;
      },
    },
  ]);
}

const stdoutText = (): string => out.join('');
const stderrText = (): string => err.join('');

let runsBefore: string[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-run-target-'));
  out = [];
  err = [];
  exec.mockClear();
  vi.mocked(openTarget).mockClear();
  runsBefore = runsListing();
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('runRunCommand with a failing Target_Manager', () => {
  it('reports ERROR / stage-error / runtime, with url and lastStatus on stderr only', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const deps = await fakeDeps(REQUIRED_BROWSER, registryCalling(url));

    const code = await runRunCommand([], deps);

    expect(code).toBe(1);
    expect(vi.mocked(openTarget)).toHaveBeenCalledTimes(1);
    expect(stdoutText()).toContain('Outcome: ERROR\n');
    const stderr = stderrText();
    expect(stderr).toContain(`Target URL: ${url}`);
    expect(stderr).toContain('Last status: connection-refused');

    // The Stage_Error message (first stderr line) names only the stage and the cause class.
    const message = stderr.split('\n')[0]!;
    expect(message).toContain('runtime');
    expect(message).toContain('TargetUnreachableError');
    expect(message).not.toContain(url);
    expect(message).not.toContain('connection-refused');

    expect(runsListing()).toEqual(runsBefore);
  }, 20000);

  it('exposes reason stage-error and errorStage runtime on the run result', async () => {
    const { run } = await import('./pipeline.js');
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const deps = await fakeDeps(REQUIRED_BROWSER, registryCalling(url));
    const result = await run({
      cwd: deps.cwd,
      env: deps.env,
      flags: {},
      cliOptions: {},
      createGateway: deps.createGateway,
      now: deps.now,
      stderr: deps.stderr,
      contextProviders: deps.contextProviders,
      exec: deps.exec,
      capabilities: deps.capabilities!,
    });
    expect(result.outcome).toBe('ERROR');
    expect(result.reason).toBe('stage-error');
    expect(result.errorStage).toBe('runtime');
    expect(result.error?.message).not.toContain(url);
    expect(runsListing()).toEqual(runsBefore);
  }, 20000);
});

describe('runRunCommand never opens a target when no capability runs', () => {
  it('does not call openTarget with an empty registry', async () => {
    const code = await runRunCommand([], await fakeDeps(REQUIRED_BROWSER, EMPTY_REGISTRY));
    expect(code).toBe(0);
    expect(stdoutText()).toContain('Outcome: UNSUPPORTED\n');
    expect(vi.mocked(openTarget)).not.toHaveBeenCalled();
    expect(runsListing()).toEqual(runsBefore);
  });

  it('does not call openTarget when the Assessment is not required', async () => {
    const code = await runRunCommand([], await fakeDeps(NOT_REQUIRED, registryCalling('http://127.0.0.1:1')));
    expect(code).toBe(0);
    expect(stdoutText()).toContain('Outcome: SKIPPED\n');
    expect(vi.mocked(openTarget)).not.toHaveBeenCalled();
    expect(runsListing()).toEqual(runsBefore);
  });
});
