import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assess } from '../assessment/index.js';
import { loadConfig } from '../config/load.js';
import { resolveContext } from '../context/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import type { BundleFs } from '../evidence/bundle.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import { resolveOutcome } from '../outcome/index.js';
import type { EvidenceSummary, FinalState, RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry } from './capabilities.js';
import { run } from './pipeline.js';
import type { RuntimeHook } from './types.js';

// Spy wrapper over the real function: counts calls, changes nothing.
vi.mock('../outcome/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outcome/index.js')>();
  return { ...actual, resolveOutcome: vi.fn(actual.resolveOutcome) };
});

const KEY = 'sk-or-fake-key-0123456789abcdef';
const NOW = new Date('2026-01-02T03:04:05.678Z');
const TITLE = 'Add login form';

type Providers = NonNullable<ResolveContextOptions['providers']>;

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

const exec = () => ({ error: Object.assign(new Error('no git'), { code: '1' }) });

/** Answers: surface browser_ui, runtime required, checks inadequate, no Claim. */
const answerer: JevGateway = {
  async ask(request: Jev_Request): Promise<Jev_Response> {
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(request.questions)) {
      if (name === 'surface') {
        answers[name] = {
          type: 'choice',
          probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0])),
        };
      } else if (name === 'runtime_observable') answers[name] = { type: 'noul', noul: 0.95 };
      else if (name === 'checks_adequate') answers[name] = { type: 'noul', noul: 0.05 };
      else answers[name] = { type: 'noul', noul: 0.01 };
    }
    return {
      model: 'stub-model',
      answers: answers as Jev_Response['answers'],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  },
};

let cwd: string;
let recordings: Recording[];

beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-resolve-call-count-'));
  const env = { OPENROUTER_API_KEY: KEY };
  const loaded = loadConfig({ cwd, flags: {}, env });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({ config: loaded.config, cliOptions: {}, env, cwd, providers: providers(), exec });
  recordings = [];
  const capturing: JevGateway = {
    async ask(request, options) {
      const response = await answerer.ask(request, options);
      const hash = stateHash(request.state);
      for (const [name, built] of Object.entries(request.questions)) {
        const answer = response.answers[name];
        if (answer !== undefined) recordings.push({ idVersion: built.idVersion, stateHash: hash, question: name, answer });
      }
      return response;
    },
  };
  await assess(context, loaded.config, capturing);
});

afterAll(() => rmSync(cwd, { recursive: true, force: true }));

type Scenario = 'success' | 'stage-error' | 'evidence-failure' | 'thrown-late';

/** A bundle fs where every write step fails. */
function brokenFs(message: string): BundleFs {
  const boom = async (): Promise<never> => {
    throw new Error(message);
  };
  return { mkdir: boom, readdir: async () => [], writeFile: boom, rename: boom, rm: async () => undefined };
}

function runtimeWith(finalState: FinalState): RuntimeResult {
  const evidence: EvidenceSummary = {
    change: { title: TITLE, files: [] },
    claim: { status: 'not_identified' },
    subject: { url: 'http://localhost:3000/' },
    actions: [],
    observations: [{ step: 1, screenshot: 'a.png' }],
    artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
  };
  return { finalState, evidence };
}

// Feature: evidence-bundle, Property 31: resolveOutcome is called at most twice, and never redundantly after a final resolution exists
describe('Property 31: resolveOutcome is called at most twice, and never redundantly after a final resolution exists', () => {
  /**
   * **Validates: Requirements 9.8**
   */
  it('counts resolveOutcome calls per scenario and bounds them', async () => {
    const spy = vi.mocked(resolveOutcome);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Scenario>('success', 'stage-error', 'evidence-failure', 'thrown-late'),
        fc.constantFrom<FinalState>('reached', 'not_reached'),
        fc.stringMatching(/^[a-f0-9]{8}$/),
        async (scenario, finalState, hex) => {
          const hook = vi.fn<RuntimeHook>(async () => {
            if (scenario === 'stage-error') throw new Error(`hook failure ${hex}`);
            return runtimeWith(finalState);
          });
          const registry = createCapabilityRegistry([{ name: 'stub', surfaces: ['browser_ui'], run: hook }]);
          const stderrWrites: string[] = [];
          const stderr = {
            write: (text: string) => {
              stderrWrites.push(text);
              // Late throw: reporting the failed Minimal_Bundle throws after the final resolution exists.
              // Every write throws: run() must still return and never rethrow.
              if (scenario === 'thrown-late') throw new Error(`stderr closed ${hex}`);
              return true;
            },
          };

          spy.mockClear();
          const result = await run({
            cwd,
            env: { OPENROUTER_API_KEY: KEY },
            contextProviders: providers(),
            exec,
            now: () => NOW,
            stderr,
            gateway: new FakeJevGateway(recordings),
            capabilities: registry,
            ...(scenario === 'evidence-failure' || scenario === 'thrown-late'
              ? { bundleFs: brokenFs(`disk failure ${hex}`) }
              : {}),
          });
          const calls = spy.mock.calls.length;

          expect(hook).toHaveBeenCalledTimes(1);
          expect(calls).toBeLessThanOrEqual(2);
          switch (scenario) {
            case 'success':
              expect(calls).toBe(1);
              expect(result.outcome).toBe('EVIDENCED');
              break;
            case 'stage-error':
              expect(calls).toBe(1);
              expect(result.outcome).toBe('ERROR');
              expect(result.errorStage).toBe('runtime');
              break;
            case 'evidence-failure':
              expect(calls).toBe(2);
              expect(result.errorStage).toBe('evidence');
              break;
            case 'thrown-late':
              // Two calls before the throw; the outermost catch adds none.
              expect(stderrWrites.length).toBeGreaterThanOrEqual(1);
              expect(calls).toBe(2);
              expect(result.errorStage).toBe('evidence');
              break;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
