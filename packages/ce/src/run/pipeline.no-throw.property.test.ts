import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Surface } from '../assessment/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import type { Stage } from '../errors.js';
import { StageError } from '../errors.js';
import type { BundleFs } from '../evidence/bundle.js';
import { FakeJevGateway } from '../jev/fake.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import type { RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry } from './capabilities.js';
import { run } from './pipeline.js';
import type { RuntimeHook } from './types.js';

// loadConfig is wrapped so the config stage can be made to throw an arbitrary value.
const hooks = vi.hoisted(() => ({ configThrow: undefined as { value: unknown } | undefined }));
vi.mock('../config/load.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/load.js')>();
  return {
    ...actual,
    loadConfig: ((...args: Parameters<typeof actual.loadConfig>) => {
      if (hooks.configThrow !== undefined) throw hooks.configThrow.value;
      return actual.loadConfig(...args);
    }) as typeof actual.loadConfig,
  };
});

type Providers = NonNullable<ResolveContextOptions['providers']>;
type Injected = { value: unknown };

const FAULT_STAGES: readonly Stage[] = ['config', 'context', 'assessment', 'runtime', 'evidence'];
const SURFACE: Surface = 'browser_ui';
const NOW = new Date('2026-01-02T03:04:05.678Z');

/** Gateway that answers "evidence required on browser_ui" so the run reaches the runtime hook. */
function workingGateway(): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === SURFACE ? 1 : 0])),
          };
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: 0.95 };
        } else if (name === 'checks_adequate') {
          answers[name] = { type: 'noul', noul: 0.05 };
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

/** A FakeJevGateway whose ask throws the injected value. */
class ThrowingFakeGateway extends FakeJevGateway {
  readonly #thrown: Injected;
  constructor(thrown: Injected) {
    super([]);
    this.#thrown = thrown;
  }
  override async ask(): Promise<Jev_Response> {
    throw this.#thrown.value;
  }
}

function providers(thrown: Injected | undefined): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: 'Add login form' }, status: { name: 'github', status: 'used' } }),
    cli: () => {
      if (thrown !== undefined) throw thrown.value;
      return { claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
    },
    junit: () => ({ checks: [], status: { name: 'junit', status: 'unavailable', reason: 'not-configured' } }),
  } as Providers;
}

const GOOD_RUNTIME: RuntimeResult = {
  finalState: 'reached',
  evidence: {
    change: { title: 'Add login form', files: [] },
    claim: { status: 'not_identified' },
    subject: { url: 'http://localhost:3000' },
    actions: [],
    observations: [{ step: 1, screenshot: 'step-1.png' }],
    artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
  },
};

/** File system that accepts every write and keeps nothing. */
const nullFs: BundleFs = {
  mkdir: async () => undefined,
  readdir: async () => [],
  writeFile: async () => undefined,
  rename: async () => undefined,
  rm: async () => undefined,
};

function throwingFs(thrown: Injected): BundleFs {
  return {
    ...nullFs,
    mkdir: async () => {
      throw thrown.value;
    },
    writeFile: async () => {
      throw thrown.value;
    },
  };
}

/** Thrown values of any shape except StageError (wrapStage keeps a StageError's own stage). */
const thrownArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.bigInt(),
  fc.constant(Symbol('boom')),
  fc.string().map((m) => new Error(m)),
  fc.string().map((m) => new TypeError(m)),
  fc.constant(Object.create(null) as object),
  fc.constant({ constructor: 5 }),
  fc.constant({ constructor: { name: 42 } }),
  fc.constant(() => 'fn'),
  fc.constant(
    Object.defineProperty({}, 'constructor', {
      get() {
        throw new Error('hostile constructor getter');
      },
    }),
  ),
);

let cwd: string;
beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-no-throw-'));
});
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function runWithFault(stage: Stage, thrown: Injected) {
  hooks.configThrow = stage === 'config' ? thrown : undefined;
  const hook: RuntimeHook = async () => {
    if (stage === 'runtime') throw thrown.value;
    return GOOD_RUNTIME;
  };
  try {
    return await run({
      cwd,
      env: { OPENROUTER_API_KEY: 'sk-or-fake-key-0123456789abcdef' },
      contextProviders: providers(stage === 'context' ? thrown : undefined),
      exec: () => ({ error: Object.assign(new Error('no git'), { code: '1' }) }),
      gateway: stage === 'assessment' ? new ThrowingFakeGateway(thrown) : workingGateway(),
      capabilities: createCapabilityRegistry([{ name: 'browser', surfaces: [SURFACE], run: hook }]),
      now: () => NOW,
      stderr: { write: () => true },
      bundleFs: stage === 'evidence' ? throwingFs(thrown) : nullFs,
    });
  } finally {
    hooks.configThrow = undefined;
  }
}

// Feature: evidence-bundle, Property 23: run() never throws, and the caught stage names where it failed
describe('Property 23: run() never throws, and the caught stage names where it failed', () => {
  /**
   * **Validates: Requirements 11.1, 11.2, 11.3**
   */
  it('resolves to ERROR with the injected stage for any thrown value at any stage', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...FAULT_STAGES), thrownArb, async (stage, value) => {
        const result = await runWithFault(stage, { value });
        expect(result.kind).toBe('resolved');
        expect(result.outcome).toBe('ERROR');
        expect(result.errorStage).toBe(stage);
        expect(result.error).toBeInstanceOf(StageError);
        expect(result.error?.stage).toBe(stage);
        expect(result.exitCode).toBe(1);
      }),
      { numRuns: 150 },
    );
  });
});
