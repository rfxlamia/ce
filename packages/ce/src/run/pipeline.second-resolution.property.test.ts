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
import type { EvidenceSummary, FinalState, RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry } from './capabilities.js';
import { run } from './pipeline.js';
import { resolveAfterAssessment } from './resolve.js';
import type { RuntimeHook } from './types.js';

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
  cwd = mkdtempSync(join(tmpdir(), 'ce-second-resolution-'));
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

type FailAt = 'mkdir' | 'writeFile' | 'rename';

function failingFs(at: FailAt, message: string): BundleFs {
  const boom = (): never => {
    throw new Error(message);
  };
  return {
    mkdir: async () => (at === 'mkdir' ? boom() : undefined),
    readdir: async () => [],
    writeFile: async () => (at === 'writeFile' ? boom() : undefined),
    rename: async () => (at === 'rename' ? boom() : undefined),
    rm: async () => undefined,
  };
}

function runtimeWith(marker: string, finalState: FinalState): RuntimeResult {
  const evidence: EvidenceSummary = {
    change: { title: TITLE, files: [] },
    claim: { status: 'not_identified' },
    subject: { url: `http://localhost:3000/${marker}` },
    actions: [],
    observations: [{ step: 1, screenshot: `${marker}.png` }],
    artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
  };
  return { finalState, evidence };
}

// Feature: evidence-bundle, Property 7: A second resolution replaces the first and the stale one does not leak
describe('Property 7: A second resolution replaces the first and the stale one does not leak', () => {
  /**
   * **Validates: Requirements 4.6, 9.8**
   */
  it('a failed evidence write turns an EVIDENCED first resolution into the second-resolution ERROR', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<FailAt>('mkdir', 'writeFile', 'rename'),
        fc.constantFrom<FinalState>('reached', 'not_reached'),
        fc.stringMatching(/^[a-f0-9]{12}$/),
        async (failAt, finalState, hex) => {
          const marker = `stale-${hex}`;
          const hook = vi.fn<RuntimeHook>(async () => runtimeWith(marker, finalState));
          const registry = createCapabilityRegistry([{ name: 'stub', surfaces: ['browser_ui'], run: hook }]);

          const result = await run({
            cwd,
            env: { OPENROUTER_API_KEY: KEY },
            contextProviders: providers(),
            exec,
            now: () => NOW,
            stderr: { write: () => undefined },
            gateway: new FakeJevGateway(recordings),
            capabilities: registry,
            bundleFs: failingFs(failAt, `disk failure ${hex}`),
          });

          // The runtime ran and would have resolved EVIDENCED; the evidence stage then failed.
          expect(hook).toHaveBeenCalledTimes(1);
          expect(result.error?.stage).toBe('evidence');
          expect(result.bundleWritten).toBe(false);

          // The final result equals a fresh resolveOutcome call with the evidence StageError.
          const second = resolveAfterAssessment({
            registry,
            ...(result.assessment !== undefined ? { assessment: result.assessment } : {}),
            error: result.error!,
          });
          expect(result.outcome).toBe(second.outcome);
          expect(result.outcome).toBe('ERROR');
          expect(result.reason).toBe(second.reason);
          expect(result.errorStage).toBe(second.errorStage);
          expect(result.errorStage).toBe('evidence');

          // Nothing that came only from the first resolution survives.
          expect(result.finalState).toBeUndefined();
          expect(result.finalState).toBe(second.finalState);
          expect(JSON.stringify(result)).not.toContain(marker);
        },
      ),
      { numRuns: 100 },
    );
  });
});
