import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { runRunCommand } from './command.js';
import type { RunCommandDeps } from './command.js';
import { EMPTY_REGISTRY } from './capabilities.js';
import { run } from './pipeline.js';
import type { CreateGateway, RunResult } from './types.js';

vi.mock('./pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline.js')>();
  return { ...actual, run: vi.fn(actual.run) };
});

const KEY = 'sk-or-fake-key-0123456789abcdef';
const NOW = new Date('2026-01-02T03:04:05.678Z');
const TITLE = 'Add login form';

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
let contextCalls: number;

function fixedProviders(): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: TITLE }, status: { name: 'github', status: 'used' } }),
    cli: () => {
      contextCalls += 1;
      return { claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
    },
    junit: () => ({
      checks: [],
      status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
    }),
  } as Providers;
}

const exec = vi.fn(() => ({ error: Object.assign(new Error('no git'), { code: '1' }) }));

/** Scripted answerer: surface is always browser_ui, is_behavior says no Claim. */
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

/** Runs assess once on the context the command will resolve and records every answer. */
async function recordingsFor(script: Script): Promise<Recording[]> {
  const loaded = loadConfig({ cwd, flags: {}, env: { OPENROUTER_API_KEY: KEY } });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({
    config: loaded.config,
    cliOptions: {},
    env: { OPENROUTER_API_KEY: KEY },
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
  contextCalls = 0;
  exec.mockClear();
  return recordings;
}

function deps(extra: Partial<RunCommandDeps> = {}): RunCommandDeps {
  return {
    env: { OPENROUTER_API_KEY: KEY },
    cwd,
    stdout: { write: (t: string) => out.push(t) },
    stderr: { write: (t: string) => err.push(t) },
    createGateway: vi.fn<CreateGateway>(() => {
      throw new Error('createGateway must not be called');
    }),
    now: () => NOW,
    contextProviders: fixedProviders(),
    exec,
    ...extra,
  };
}

async function fakeDeps(script: Script): Promise<RunCommandDeps> {
  const recordings = await recordingsFor(script);
  const createGateway: CreateGateway = () => ({ ok: true, gateway: new FakeJevGateway(recordings) });
  return deps({ createGateway, capabilities: EMPTY_REGISTRY });
}

const stdoutText = (): string => out.join('');
const stderrText = (): string => err.join('');

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-run-cmd-'));
  out = [];
  err = [];
  contextCalls = 0;
  exec.mockClear();
  vi.mocked(run).mockClear();
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('runRunCommand outcomes', () => {
  it('prints Outcome: SKIPPED and exits 0', async () => {
    const code = await runRunCommand([], await fakeDeps(NOT_REQUIRED));
    expect(code).toBe(0);
    expect(stdoutText()).toContain('Outcome: SKIPPED\n');
    expect(stderrText()).toBe('');
  });

  it('prints Outcome: UNSUPPORTED with the reason line, the hint line and the exit code', async () => {
    const code = await runRunCommand([], await fakeDeps(REQUIRED_BROWSER));
    expect(code).toBe(0);
    const lines = stdoutText().split('\n');
    expect(lines[0]).toBe('Outcome: UNSUPPORTED');
    expect(lines).toContain('Reason: surface-unsupported');
    expect(lines).toContain('Surface: browser_ui');
    expect(lines).toContain('No capability is registered for browser_ui yet.');
    expect(stderrText()).toBe('');
  });
});

describe('runRunCommand arguments', () => {
  it('passes --claim=x as one claim', async () => {
    await runRunCommand(['--claim=x'], deps({ env: {} }));
    expect(vi.mocked(run).mock.calls[0]![0]!.cliOptions).toEqual({ claim: ['x'] });
  });

  it('collects a repeated --claim in order', async () => {
    await runRunCommand(['--claim', 'a', '--claim=b'], deps({ env: {} }));
    expect(vi.mocked(run).mock.calls[0]![0]!.cliOptions).toEqual({ claim: ['a', 'b'] });
  });

  it('maps --config to flags.config and --base to cliOptions.base', async () => {
    await runRunCommand(['--config', 'my.yml', '--base', 'origin/main'], deps({ env: {} }));
    const options = vi.mocked(run).mock.calls[0]![0]!;
    expect(options.flags).toEqual({ config: 'my.yml' });
    expect(options.cliOptions).toEqual({ base: 'origin/main' });
  });

  it.each([
    ['an unknown flag', ['--bogus', 'x']],
    ['an empty value', ['--claim=']],
    ['a value starting with -- in the = form', ['--claim=--x']],
    ['a value starting with -- in the separate form', ['--claim', '--x']],
    ['a missing value', ['--base']],
    ['a positional argument', ['extra']],
  ])('prints usage on stderr, exits 1 and does not call run() for %s', async (_label, argv) => {
    const code = await runRunCommand(argv, deps());
    expect(code).toBe(1);
    expect(stderrText()).toContain('Usage: ce run');
    expect(stdoutText()).toBe('');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('runRunCommand failures', () => {
  it('reports a config failure on stderr, prints Outcome: ERROR, exits 1 and does not resolve a context', async () => {
    const d = deps({ env: {} });
    const code = await runRunCommand([], d);
    expect(code).toBe(1);
    expect(stderrText()).toContain('OPENROUTER_API_KEY');
    expect(stdoutText()).toContain('Outcome: ERROR');
    expect(contextCalls).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(d.createGateway).not.toHaveBeenCalled();
  });

  it('prints Outcome: ERROR and the constructor name for an unexpected throw', async () => {
    vi.mocked(run).mockRejectedValueOnce(new RangeError(`secret ${KEY}`));
    const code = await runRunCommand([], deps());
    expect(code).toBe(1);
    expect(stdoutText()).toBe('Outcome: ERROR\n');
    expect(stderrText()).toBe('RangeError\n');
    expect(stderrText()).not.toContain(KEY);
  });

  it('prints the reason and the Surface on stderr for an ERROR without a Stage_Error', async () => {
    const result = {
      kind: 'resolved',
      outcome: 'ERROR',
      reason: 'no-observation',
      surface: 'browser_ui',
      exitCode: 1,
    } as unknown as RunResult;
    vi.mocked(run).mockResolvedValueOnce(result);
    const code = await runRunCommand([], deps());
    expect(code).toBe(1);
    expect(stdoutText()).toBe('Outcome: ERROR\n');
    expect(stderrText()).toBe('Reason: no-observation\nSurface: browser_ui\n');
  });
});
