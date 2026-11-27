import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Surface } from '../assessment/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { CallLog } from '../jev/log.js';
import type { Jev_Request } from '../jev/types.js';
import type { EvidenceSummary, RuntimeResult } from '../outcome/index.js';
import { resolveOutcome } from '../outcome/index.js';
import { createCapabilityRegistry, EMPTY_REGISTRY, selectCapability } from './capabilities.js';
import { run, runDirName } from './pipeline.js';
import type { CapabilityRegistry, CreateGateway, ResolvedRun, RuntimeHook } from './types.js';

vi.mock('../outcome/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outcome/index.js')>();
  return { ...actual, resolveOutcome: vi.fn(actual.resolveOutcome) };
});
vi.mock('./capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./capabilities.js')>();
  return { ...actual, selectCapability: vi.fn(actual.selectCapability) };
});

const KEY = 'sk-or-fake-key-0123456789abcdef';
const NOW = new Date('2026-01-02T03:04:05.678Z');
const RUN_DIR_NAME = 'run-2026-01-02T03-04-05-678Z';
const TITLE = 'Add login form';

type Providers = NonNullable<ResolveContextOptions['providers']>;

interface Script {
  runtimeObservable: number;
  checksAdequate: number;
  surface: Surface;
}
const REQUIRED_BROWSER: Script = { runtimeObservable: 0.95, checksAdequate: 0.05, surface: 'browser_ui' };
const NOT_REQUIRED: Script = { runtimeObservable: 0.05, checksAdequate: 0.95, surface: 'browser_ui' };

let cwd: string;
let order: string[];
let err: string[];
let asks: number;

function scriptedGateway(script: Script, callLog?: CallLog): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      order.push('assess');
      asks += 1;
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === script.surface ? 1 : 0])),
          };
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: script.runtimeObservable };
        } else if (name === 'checks_adequate') {
          answers[name] = { type: 'noul', noul: script.checksAdequate };
        } else {
          answers[name] = { type: 'noul', noul: 0.01 }; // is_behavior: no Claim
        }
      }
      if (callLog !== undefined) {
        await callLog.append({
          timestamp: '2026-01-01T00:00:00.000Z',
          stage: 'assessment',
          transport: 'fake',
          provider: 'openrouter',
          requestedModel: 'stub-model',
          model: 'stub-model',
          questions: [],
          answers: {},
          latencyMs: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          stateHash: 'a'.repeat(64),
          status: 'ok',
          attempts: 0,
        });
      }
      return {
        model: 'stub-model',
        answers: answers as Jev_Response['answers'],
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}

function throwingGateway(): JevGateway {
  return {
    async ask(): Promise<Jev_Response> {
      order.push('assess');
      throw new Error(`boom ${KEY}`);
    },
  };
}

function fixedProviders(overrides: Partial<Providers> = {}): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({
      pullRequest: { title: TITLE },
      status: { name: 'github', status: 'used' },
    }),
    cli: () => {
      order.push('context');
      return { claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
    },
    junit: () => ({
      checks: [],
      status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
    }),
    ...overrides,
  } as Providers;
}

const exec = vi.fn(() => ({ error: Object.assign(new Error('no git'), { code: '1' }) }));

function evidence(observations: EvidenceSummary['observations']): EvidenceSummary {
  return {
    change: { title: TITLE, files: [] },
    claim: { status: 'not_identified' },
    subject: { url: 'http://localhost:3000' },
    actions: [],
    observations,
    artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
  };
}

function runtimeResult(observations: EvidenceSummary['observations']): RuntimeResult {
  return { finalState: 'reached', evidence: evidence(observations) };
}

const GOOD_RUNTIME = runtimeResult([{ step: 1, screenshot: 'step-1.png' }]);

function hookReturning(result: RuntimeResult): ReturnType<typeof vi.fn<RuntimeHook>> {
  return vi.fn<RuntimeHook>(async () => {
    order.push('hook');
    return result;
  });
}

function registryOf(...entries: { name: string; run: RuntimeHook }[]): CapabilityRegistry {
  return createCapabilityRegistry(entries.map((e) => ({ ...e, surfaces: ['browser_ui'] as const })));
}

function base(extra: Parameters<typeof run>[0] = {}): Parameters<typeof run>[0] {
  return {
    cwd,
    env: { OPENROUTER_API_KEY: KEY },
    contextProviders: fixedProviders(),
    exec,
    now: () => NOW,
    stderr: { write: (t: string) => err.push(t) },
    ...extra,
  };
}

async function resolved(options: Parameters<typeof run>[0]): Promise<ResolvedRun> {
  const result = await run(options);
  if (result.kind !== 'resolved') throw new Error('expected a resolved run');
  return result;
}

function collapsed(list: string[]): string[] {
  return list.filter((v, i) => i === 0 || list[i - 1] !== v);
}

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-pipeline-'));
  order = [];
  err = [];
  asks = 0;
  exec.mockClear();
  const actual = await vi.importActual<typeof import('../outcome/index.js')>('../outcome/index.js');
  vi.mocked(resolveOutcome)
    .mockReset()
    .mockImplementation((input) => {
      order.push('resolve');
      return actual.resolveOutcome(input);
    });
  const actualCaps = await vi.importActual<typeof import('./capabilities.js')>('./capabilities.js');
  vi.mocked(selectCapability)
    .mockReset()
    .mockImplementation((a, r) => {
      order.push('select');
      return actualCaps.selectCapability(a, r);
    });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('run() resolved outcomes', () => {
  it('resolves SKIPPED with exit 0 and does not call the hook', async () => {
    const hook = hookReturning(GOOD_RUNTIME);
    const result = await resolved(
      base({ gateway: scriptedGateway(NOT_REQUIRED), capabilities: registryOf({ name: 'browser', run: hook }) }),
    );
    expect(result.outcome).toBe('SKIPPED');
    expect(result.reason).toBe('not-required');
    expect(result.exitCode).toBe(0);
    expect(hook).not.toHaveBeenCalled();
    expect(result.capability).toBeUndefined();
  });

  it('resolves UNSUPPORTED for browser_ui on an empty registry, exit 2 with fail-on unsupported', async () => {
    const result = await resolved(
      base({
        gateway: scriptedGateway(REQUIRED_BROWSER),
        capabilities: EMPTY_REGISTRY,
        flags: { 'output.fail-on': ['unsupported'] },
      }),
    );
    expect(result.outcome).toBe('UNSUPPORTED');
    expect(result.reason).toBe('surface-unsupported');
    expect(result.surface).toBe('browser_ui');
    expect(result.exitCode).toBe(2);
  });

  it('resolves ERROR with errorStage context when a provider throws, without selecting or hooking', async () => {
    const hook = hookReturning(GOOD_RUNTIME);
    const result = await resolved(
      base({
        gateway: scriptedGateway(REQUIRED_BROWSER),
        capabilities: registryOf({ name: 'browser', run: hook }),
        contextProviders: fixedProviders({
          cli: () => {
            throw new Error('provider failed');
          },
        }),
      }),
    );
    expect(result.outcome).toBe('ERROR');
    expect(result.errorStage).toBe('context');
    expect(result.error).toBeInstanceOf(StageError);
    expect(result.exitCode).toBe(1);
    expect(selectCapability).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(asks).toBe(0);
  });

  it('resolves ERROR with errorStage assessment when the gateway throws, without selecting or hooking', async () => {
    const hook = hookReturning(GOOD_RUNTIME);
    const result = await resolved(
      base({ gateway: throwingGateway(), capabilities: registryOf({ name: 'browser', run: hook }) }),
    );
    expect(result.outcome).toBe('ERROR');
    expect(result.errorStage).toBe('assessment');
    expect(result.exitCode).toBe(1);
    expect(selectCapability).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(result.error?.message).not.toContain(KEY);
  });
});

describe('run() with a browser_ui capability', () => {
  it('calls the hook once with a RuntimeHookInput holding the gateway and resolves EVIDENCED', async () => {
    const gateway = scriptedGateway(REQUIRED_BROWSER);
    const hook = hookReturning(GOOD_RUNTIME);
    const result = await resolved(base({ gateway, capabilities: registryOf({ name: 'browser', run: hook }) }));

    expect(hook).toHaveBeenCalledTimes(1);
    const input = hook.mock.calls[0]![0];
    expect(input.gateway).toBe(gateway);
    expect(input.context.change.title).toBe(TITLE);
    expect(input.claims).toEqual([]);
    expect(input.assessment).toMatchObject({ required: true, surface: 'browser_ui' });
    expect(input.config).toBeDefined();
    expect(input.runDir).toBe(join(cwd, '.ce/runs', runDirName(NOW)));

    expect(result.outcome).toBe('EVIDENCED');
    expect(result.reason).toBe('evidence-collected');
    expect(result.finalState).toBe('reached');
    expect(result.exitCode).toBe(0);
    expect(result.capability).toBe('browser');
  });

  it('passes the created gateway and the run directory to the hook when no gateway is supplied', async () => {
    const hook = hookReturning(GOOD_RUNTIME);
    let created: JevGatewayLike | undefined;
    const createGateway: CreateGateway = (_l, _e, { callLog }) => {
      created = scriptedGateway(REQUIRED_BROWSER, callLog);
      return { ok: true, gateway: created };
    };
    await resolved(base({ createGateway, capabilities: registryOf({ name: 'browser', run: hook }) }));
    const input = hook.mock.calls[0]![0];
    expect(input.gateway).toBe(created);
    expect(input.runDir).toBe(join(cwd, '.ce', 'runs', RUN_DIR_NAME));
  });

  it('resolves ERROR no-observation when the hook returns no observations', async () => {
    const hook = hookReturning(runtimeResult([]));
    const result = await resolved(
      base({ gateway: scriptedGateway(REQUIRED_BROWSER), capabilities: registryOf({ name: 'browser', run: hook }) }),
    );
    expect(result.outcome).toBe('ERROR');
    expect(result.reason).toBe('no-observation');
    expect(result.exitCode).toBe(1);
    expect(result.capability).toBe('browser');
  });

  it('resolves ERROR with errorStage runtime when the hook throws, and keeps the capability name', async () => {
    const hook = vi.fn<RuntimeHook>(async () => {
      throw new Error(`hook failed ${KEY}`);
    });
    const result = await resolved(
      base({ gateway: scriptedGateway(REQUIRED_BROWSER), capabilities: registryOf({ name: 'browser', run: hook }) }),
    );
    expect(result.outcome).toBe('ERROR');
    expect(result.reason).toBe('stage-error');
    expect(result.errorStage).toBe('runtime');
    expect(result.capability).toBe('browser');
    expect(result.error?.message).not.toContain(KEY);
  });

  it('calls only the first of two capabilities on one Surface', async () => {
    const first = hookReturning(GOOD_RUNTIME);
    const second = hookReturning(GOOD_RUNTIME);
    const result = await resolved(
      base({
        gateway: scriptedGateway(REQUIRED_BROWSER),
        capabilities: registryOf({ name: 'first', run: first }, { name: 'second', run: second }),
      }),
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.capability).toBe('first');
  });
});

describe('run() stage order and resolveOutcome', () => {
  it('runs context, assessment, selection, hook, then resolution', async () => {
    const hook = hookReturning(GOOD_RUNTIME);
    await resolved(
      base({ gateway: scriptedGateway(REQUIRED_BROWSER), capabilities: registryOf({ name: 'browser', run: hook }) }),
    );
    expect(collapsed(order)).toEqual(['context', 'assess', 'select', 'hook', 'resolve']);
  });

  it('calls resolveOutcome exactly once per resolved run', async () => {
    await resolved(base({ gateway: scriptedGateway(NOT_REQUIRED) }));
    expect(resolveOutcome).toHaveBeenCalledTimes(1);

    vi.mocked(resolveOutcome).mockClear();
    await resolved(base({ gateway: throwingGateway() }));
    expect(resolveOutcome).toHaveBeenCalledTimes(1);
  });
});

describe('run() config failures', () => {
  function expectNoStages(): void {
    expect(order).toEqual(['resolve']);
    expect(asks).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(resolveOutcome).toHaveBeenCalledTimes(1);
    expect(selectCapability).not.toHaveBeenCalled();
  }

  it('resolves to ERROR with errorStage config and exit 1 for an invalid config value', async () => {
    const result = await run(base({ gateway: scriptedGateway(NOT_REQUIRED), flags: { 'jev.provider': 'bogus' } }));
    expect(result).toMatchObject({ kind: 'resolved', outcome: 'ERROR', reason: 'stage-error', errorStage: 'config', exitCode: 1 });
    expect(err.join('')).toContain('jev.provider');
    expect(err.join('')).not.toContain(KEY);
    expectNoStages();
  });

  it('resolves to ERROR with errorStage config and exit 1 for a missing API key', async () => {
    const createGateway = vi.fn<CreateGateway>();
    const result = await run(base({ env: {}, createGateway }));
    expect(result).toMatchObject({ kind: 'resolved', outcome: 'ERROR', reason: 'stage-error', errorStage: 'config', exitCode: 1 });
    expect(err.join('')).toContain('OPENROUTER_API_KEY');
    expect(createGateway).not.toHaveBeenCalled();
    expectNoStages();
  });

  it('resolves to ERROR with errorStage config and exit 1 when createGateway fails, without leaking the key', async () => {
    const createGateway: CreateGateway = () => ({
      ok: false,
      errors: [{ path: 'jev.model', value: KEY, expected: 'a valid model', source: 'env' }],
    });
    const result = await run(base({ createGateway }));
    expect(result).toMatchObject({ kind: 'resolved', outcome: 'ERROR', reason: 'stage-error', errorStage: 'config', exitCode: 1 });
    expect(err.join('')).toContain('jev.model');
    expect(err.join('')).not.toContain(KEY);
    expect(inspect(result, { depth: null, showHidden: true })).not.toContain(KEY);
    expectNoStages();
  });
});

describe('run() artifacts', () => {
  it('creates no run directory and no call log when a gateway is supplied', async () => {
    await resolved(base({ gateway: scriptedGateway(NOT_REQUIRED) }));
    expect(existsSync(join(cwd, '.ce'))).toBe(false);
  });

  it('writes only jev-calls.jsonl in the run directory when it creates the gateway', async () => {
    const createGateway: CreateGateway = (_l, _e, { callLog }) => ({
      ok: true,
      gateway: scriptedGateway(NOT_REQUIRED, callLog),
    });
    const result = await resolved(base({ createGateway }));
    expect(result.outcome).toBe('SKIPPED');
    expect(readdirSync(join(cwd, '.ce', 'runs'))).toEqual([RUN_DIR_NAME]);
    expect(readdirSync(join(cwd, '.ce', 'runs', RUN_DIR_NAME))).toEqual(['jev-calls.jsonl']);
  });
});

type JevGatewayLike = JevGateway;
