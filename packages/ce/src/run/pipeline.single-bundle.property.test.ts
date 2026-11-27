import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assess } from '../assessment/index.js';
import { loadConfig } from '../config/load.js';
import type { BundleFs } from '../evidence/bundle.js';
import { resolveContext } from '../context/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import type { EvidenceSummary, Outcome, RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry, EMPTY_REGISTRY } from './capabilities.js';
import { run } from './pipeline.js';
import type { CapabilityRegistry, ResolvedRunWithBundle, RuntimeHook } from './types.js';

const KEY = 'sk-or-fake-key-0123456789abcdef';
const TITLE = 'Add login form';

type Providers = NonNullable<ResolveContextOptions['providers']>;

const exec = () => ({ error: Object.assign(new Error('no git'), { code: '1' }) });

function providers(throwInContext: boolean): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: TITLE }, status: { name: 'github', status: 'used' } }),
    cli: () => {
      if (throwInContext) throw new Error('provider failed');
      return { claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
    },
    junit: () => ({ checks: [], status: { name: 'junit', status: 'unavailable', reason: 'not-configured' } }),
  } as Providers;
}

function scriptedAnswerer(required: boolean): JevGateway {
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
          answers[name] = { type: 'noul', noul: required ? 0.95 : 0.05 };
        } else if (name === 'checks_adequate') {
          answers[name] = { type: 'noul', noul: required ? 0.05 : 0.95 };
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

/** Records the scripted answers for the exact context `run()` will build, then replays them with FakeJevGateway. */
async function fakeGateway(cwd: string, required: boolean): Promise<FakeJevGateway> {
  const env = { OPENROUTER_API_KEY: KEY };
  const loaded = loadConfig({ cwd, flags: {}, env });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({
    config: loaded.config,
    cliOptions: {},
    env,
    cwd,
    providers: providers(false),
    exec,
  });
  const recordings: Recording[] = [];
  const answerer = scriptedAnswerer(required);
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
  return new FakeJevGateway(recordings);
}

function runtimeResult(observations: EvidenceSummary['observations']): RuntimeResult {
  return {
    finalState: 'reached',
    evidence: {
      change: { title: TITLE, files: [] },
      claim: { status: 'not_identified' },
      subject: { url: 'http://localhost:3000' },
      actions: [],
      observations,
      artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
    },
  };
}

function registryFor(hook: RuntimeHook): CapabilityRegistry {
  return createCapabilityRegistry([{ name: 'browser', run: hook, surfaces: ['browser_ui'] as const }]);
}

type Scenario = 'skipped' | 'unsupported' | 'evidenced' | 'error-hook-throws' | 'error-no-observation' | 'error-context' | 'error-assessment';
type FsMode = 'ok' | 'rename-fails-once' | 'rename-always-fails';

const EXPECTED: Record<Scenario, Outcome> = {
  skipped: 'SKIPPED',
  unsupported: 'UNSUPPORTED',
  evidenced: 'EVIDENCED',
  'error-hook-throws': 'ERROR',
  'error-no-observation': 'ERROR',
  'error-context': 'ERROR',
  'error-assessment': 'ERROR',
};

const scenarioArb = fc.constantFrom<Scenario>(
  'skipped',
  'unsupported',
  'evidenced',
  'error-hook-throws',
  'error-no-observation',
  'error-context',
  'error-assessment',
);
const fsModeArb = fc.constantFrom<FsMode>('ok', 'ok', 'rename-fails-once', 'rename-always-fails');

function faultyFs(mode: FsMode): BundleFs {
  let failures = 0;
  return {
    mkdir: (dir, options) => fsPromises.mkdir(dir, options),
    readdir: (dir) => fsPromises.readdir(dir),
    writeFile: (file, data, encoding) => fsPromises.writeFile(file, data, encoding),
    rm: (file, options) => fsPromises.rm(file, options),
    async rename(from, to) {
      if (mode === 'rename-always-fails' || (mode === 'rename-fails-once' && failures === 0)) {
        failures += 1;
        throw new Error('rename failed');
      }
      await fsPromises.rename(from, to);
    },
  };
}

async function runScenario(cwd: string, scenario: Scenario, mode: FsMode, offsetMs: number): Promise<ResolvedRunWithBundle> {
  const required = scenario !== 'skipped';
  const hook: RuntimeHook = async () => {
    if (scenario === 'error-hook-throws') throw new Error(`hook failed ${KEY}`);
    if (scenario === 'error-no-observation') return runtimeResult([]);
    return runtimeResult([{ step: 1, screenshot: 'step-1.png' }]);
  };
  const gateway =
    scenario === 'error-assessment' || scenario === 'error-context'
      ? new FakeJevGateway([])
      : await fakeGateway(cwd, required);
  const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 0) + offsetMs);
  const result = await run({
    cwd,
    env: { OPENROUTER_API_KEY: KEY },
    gateway,
    contextProviders: providers(scenario === 'error-context'),
    exec,
    now: () => now,
    stderr: { write: () => true },
    capabilities: scenario === 'unsupported' ? EMPTY_REGISTRY : registryFor(hook),
    bundleFs: faultyFs(mode),
  });
  if (result.kind !== 'resolved') throw new Error('expected a resolved run');
  return result;
}

function countRunJson(runDir: string): number {
  if (!existsSync(runDir)) return 0;
  return readdirSync(runDir).filter((name) => name === 'run.json').length;
}

// Feature: evidence-bundle, Property 19: Exactly one run.json exists after any run
describe('Property 19: Exactly one run.json exists after any run', () => {
  /**
   * **Validates: Requirements 6.7**
   */
  it('leaves exactly one run.json in the Run_Dir, or zero when every write attempt failed', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, fsModeArb, fc.integer({ min: 0, max: 100_000 }), async (scenario, mode, offsetMs) => {
        const cwd = mkdtempSync(join(tmpdir(), 'ce-single-bundle-'));
        try {
          const result = await runScenario(cwd, scenario, mode, offsetMs);
          const count = countRunJson(result.runDir);

          if (result.bundleWritten) {
            expect(count).toBe(1);
            expect(existsSync(join(result.runDir, 'run.json.tmp'))).toBe(false);
          } else {
            expect(count).toBe(0);
          }
          if (mode === 'ok') {
            expect(result.bundleWritten).toBe(true);
            expect(result.outcome).toBe(EXPECTED[scenario]);
          } else if (mode === 'rename-always-fails') {
            expect(result.bundleWritten).toBe(false);
          } else {
            // The first write fails: a second resolution and a Minimal_Bundle replace it.
            expect(result.bundleWritten).toBe(true);
            expect(result.outcome).toBe('ERROR');
          }
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
