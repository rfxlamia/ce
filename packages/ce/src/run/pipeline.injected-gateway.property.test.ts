import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assess } from '../assessment/index.js';
import { loadConfig } from '../config/load.js';
import { resolveContext } from '../context/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import { RunRecordSchema } from '../evidence/schema.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import type { RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry, EMPTY_REGISTRY } from './capabilities.js';
import { run, runDirName } from './pipeline.js';
import type { RuntimeHook } from './types.js';

const KEY = 'sk-or-fake-key-0123456789abcdef';
const TITLE = 'Add login form';

type Providers = NonNullable<ResolveContextOptions['providers']>;

const exec = () => ({ error: Object.assign(new Error('no git'), { code: '1' }) });

function providers(): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: TITLE }, status: { name: 'github', status: 'used' } }),
    cli: () => ({ claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } }),
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

/** Records scripted answers for the exact context `run()` will build, then replays them with FakeJevGateway. */
async function fakeGateway(cwd: string, required: boolean): Promise<FakeJevGateway> {
  const env = { OPENROUTER_API_KEY: KEY };
  const loaded = loadConfig({ cwd, flags: {}, env });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({ config: loaded.config, cliOptions: {}, env, cwd, providers: providers(), exec });
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

function runtimeResult(): RuntimeResult {
  return {
    finalState: 'reached',
    evidence: {
      change: { title: TITLE, files: [] },
      claim: { status: 'not_identified' },
      subject: { url: 'http://localhost:3000' },
      actions: [],
      observations: [{ step: 1, screenshot: 'step-1.png' }],
      artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
    },
  };
}

type Scenario = 'skipped' | 'unsupported' | 'evidenced' | 'error-hook-throws' | 'error-assessment';
const scenarioArb = fc.constantFrom<Scenario>('skipped', 'unsupported', 'evidenced', 'error-hook-throws', 'error-assessment');

// Feature: evidence-bundle, Property 30: An injected gateway still produces a bundle in the computed run directory
describe('Property 30: An injected gateway still produces a bundle in the computed run directory', () => {
  /**
   * **Validates: Requirements 9.9**
   */
  it('writes a schema-valid run.json into the run directory run() computed, for every resolution', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, fc.integer({ min: 0, max: 100_000 }), async (scenario, offsetMs) => {
        const cwd = mkdtempSync(join(tmpdir(), 'ce-injected-gateway-'));
        try {
          const hook: RuntimeHook = async () => {
            if (scenario === 'error-hook-throws') throw new Error(`hook failed ${KEY}`);
            return runtimeResult();
          };
          const gateway =
            scenario === 'error-assessment' ? new FakeJevGateway([]) : await fakeGateway(cwd, scenario !== 'skipped');
          const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 0) + offsetMs);
          const result = await run({
            cwd,
            env: { OPENROUTER_API_KEY: KEY },
            gateway,
            contextProviders: providers(),
            exec,
            now: () => now,
            stderr: { write: () => true },
            capabilities:
              scenario === 'unsupported'
                ? EMPTY_REGISTRY
                : createCapabilityRegistry([{ name: 'browser', run: hook, surfaces: ['browser_ui'] as const }]),
          });
          if (result.kind !== 'resolved') throw new Error('expected a resolved run');

          const expectedDir = resolve(cwd, '.ce/runs', runDirName(now));
          expect(result.runDir).toBe(expectedDir);
          expect(result.bundleWritten).toBe(true);
          const file = join(expectedDir, 'run.json');
          expect(existsSync(file)).toBe(true);
          const parsed = RunRecordSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
          expect(parsed.success).toBe(true);
          if (parsed.success) expect(parsed.data.outcome).toBe(result.outcome);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
