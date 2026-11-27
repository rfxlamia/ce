import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assessment, Claim, PerClaimAssessment, Surface } from '../assessment/index.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { satisfiesMinimumEvidence } from '../outcome/evidence.js';
import { createCapabilityRegistry } from '../run/capabilities.js';
import { run } from '../run/pipeline.js';
import type { RuntimeHookInput } from '../run/types.js';
import {
  createBrowserCapability,
  RunDirMissingError,
  selectClaim,
  type BrowserLike,
} from './capability.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import type { LoopResult } from './loop.js';
import type { ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';
import type { TargetHandle, TargetOptions } from './target.js';

// Unit tests for the Browser_Capability (task 10.6).
// Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9, 13.11, 13.12, 13.13, 13.14

const BASE_URL = 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const snapshots: ActionableElementSnapshot[] = [
  { tag: 'button', role: 'button', name: 'Alpha', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(1)', id: 'alpha' },
];

function fakePage(): PlaywrightPage {
  const locator = {
    count: async () => 1,
    click: async () => undefined,
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page = {
    url: () => `${BASE_URL}/`,
    title: async () => 'Fake',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => snapshots,
    screenshot: async (opts?: { path?: string }) => {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      if (opts?.path !== undefined) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(opts.path, bytes);
      }
      return bytes;
    },
    route: async () => undefined,
    unroute: async () => undefined,
    on: () => undefined,
    off: () => undefined,
    close: async () => undefined,
    isClosed: () => false,
  };
  return page as unknown as PlaywrightPage;
}

function fakeBrowser() {
  const browser = {
    closed: 0,
    newPage: async () => fakePage(),
    close: async () => {
      browser.closed += 1;
    },
  };
  return browser satisfies BrowserLike & { closed: number };
}

function fakeTarget() {
  const handle = {
    stopped: 0,
    baseUrl: BASE_URL,
    mode: 'attach',
    lastStatus: 200,
    logs: '',
    warnings: [] as string[],
    stop: async () => {
      handle.stopped += 1;
    },
  };
  return handle as unknown as TargetHandle & { stopped: number };
}

/** Scripted text gateway: always answers option 0 for `next_action` or the given terminal answer. */
function scriptedGateway(answer: 'done' | 'click' | 'throw' = 'done'): JevGateway {
  return {
    async ask(_request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
      if (answer === 'throw') throw new Error('gateway exploded');
      const probabilities =
        answer === 'done'
          ? { '0': 0.05, done: 0.9, give_up: 0.02 }
          : { '0': 0.9, done: 0.02, give_up: 0.02 };
      return {
        model: 'typesafe/jev-1.14-test',
        answers: {
          next_action: { type: 'choice', probabilities },
          state_reached_dom: { type: 'noul', noul: 0.05 },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Jev_Response;
    },
  };
}

function claim(id: string, text: string): Claim {
  return { id, text, probability: 0.9, declared: false, provenance: { provider: 'cli' } } as unknown as Claim;
}

function perClaim(claimId: string, surface: Surface, needed: boolean, observable: number): PerClaimAssessment {
  return {
    claimId,
    runtimeObservable: observable,
    checksAdequate: 0,
    surface,
    surfaceConfidence: 1,
    needed,
    uncertain: false,
  };
}

function assessmentOf(rows: PerClaimAssessment[], changeText = 'change subject text'): Assessment {
  return {
    claimStatus: rows.length > 0 ? 'identified' : 'not_identified',
    subjects: [{ id: 'change', kind: 'change', text: changeText, provenance: { source: 'title' } }],
    perClaim: rows,
    required: true,
    decidedBy: 'classifier',
    surface: 'browser_ui',
    record: {},
  } as unknown as Assessment;
}

const context: ChangeContext = {
  change: {
    title: 'Add settings modal',
    files: [{ path: 'src/settings.ts', status: 'modified', patch: '+const settingsModal = 1;', provenance: { provider: 'git' } }],
    commits: [],
    claims: [],
    provenance: [],
  },
} as unknown as ChangeContext;

const config = { target: { url: BASE_URL } } as unknown as EffectiveConfig;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBrowserCapability', () => {
  let runDir: string;
  let target: ReturnType<typeof fakeTarget>;
  let browser: ReturnType<typeof fakeBrowser>;
  let openTarget: ReturnType<typeof vi.fn<(o: TargetOptions) => Promise<TargetHandle>>>;
  let launchBrowser: ReturnType<typeof vi.fn<() => Promise<BrowserLike>>>;

  beforeEach(async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-capability-'));
    target = fakeTarget();
    browser = fakeBrowser();
    openTarget = vi.fn(async () => target);
    launchBrowser = vi.fn(async () => browser);
  });
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  const capability = (onLoopResult?: (r: LoopResult) => void) =>
    createBrowserCapability({
      cwd: runDir,
      env: {},
      openTarget,
      launchBrowser,
      ...(onLoopResult === undefined ? {} : { onLoopResult }),
    });

  const input = (extra: Partial<RuntimeHookInput> = {}): RuntimeHookInput => {
    const claims = [claim('c1', 'the settings modal opens')];
    return {
      context,
      claims,
      assessment: assessmentOf([perClaim('c1', 'browser_ui', true, 0.9)]),
      config,
      gateway: new GatewayTestSupport({ inner: scriptedGateway('done') }),
      runDir,
      ...extra,
    };
  };

  it('has the structural shape of a browser_ui CapabilityEntry', () => {
    const entry = capability();
    expect(entry.name).toBe('browser_ui');
    expect(entry.surfaces).toEqual(['browser_ui']);
    expect(typeof entry.run).toBe('function');
  });

  it('stops the target and closes the browser on success, and maps to minimum evidence', async () => {
    const result = await capability().run(input());
    expect(target.stopped).toBe(1);
    expect(browser.closed).toBe(1);
    expect(openTarget).toHaveBeenCalledTimes(1);
    expect(openTarget.mock.calls[0]![0].runDir).toBe(runDir);
    expect(result.evidence.subject.url).toBe(BASE_URL);
    expect(result.evidence.claim).toMatchObject({ status: 'identified', id: 'c1', text: 'the settings modal opens' });
    expect(result.evidence.artifacts).toEqual({ runDir, reportPath: path.join(runDir, 'report.html') });
    expect(result.evidence.observations.length).toBeGreaterThanOrEqual(1);
    expect(satisfiesMinimumEvidence(result.evidence)).toBe(true);
  });

  it('stops the target and closes the browser when the loop raises, and propagates the error', async () => {
    const error = await capability()
      .run(input({ gateway: new GatewayTestSupport({ inner: scriptedGateway('throw') }) }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { stage?: string }).stage).toBe('runtime');
    expect(target.stopped).toBe(1);
    expect(browser.closed).toBe(1);
  });

  it('stops the target and closes the browser when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await capability()
      .run(input({ signal: controller.signal }))
      .catch(() => undefined);
    expect(target.stopped).toBe(1);
    expect(browser.closed).toBe(1);
  });

  it('stops the target when the browser fails to launch', async () => {
    launchBrowser.mockRejectedValueOnce(new Error('no chromium'));
    await expect(capability().run(input())).rejects.toThrow('no chromium');
    expect(target.stopped).toBe(1);
    expect(browser.closed).toBe(0);
  });

  it('throws RunDirMissingError before opening a target or launching a browser when runDir is absent', async () => {
    const { runDir: _omit, ...withoutRunDir } = input();
    await expect(capability().run(withoutRunDir)).rejects.toBeInstanceOf(RunDirMissingError);
    expect(openTarget).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('invokes the Loop_Sink with the raw LoopResult', async () => {
    const sink = vi.fn();
    await capability(sink).run(input());
    expect(sink).toHaveBeenCalledTimes(1);
    const loopResult = sink.mock.calls[0]![0] as LoopResult;
    expect(loopResult.stopReason).toBe('done');
    expect(loopResult.observations.length).toBeGreaterThanOrEqual(1);
  });

  it('works on the Claim chosen by selectClaim and passes its text to the loop', async () => {
    const seen: string[] = [];
    const inner = scriptedGateway('done');
    const gateway: JevGateway = {
      ask: async (request, options) => {
        seen.push(JSON.stringify(request));
        return inner.ask(request, options);
      },
    };
    await capability().run(
      input({
        claims: [claim('c1', 'first claim text'), claim('c2', 'second claim text')],
        assessment: assessmentOf([perClaim('c1', 'browser_ui', false, 0.5), perClaim('c2', 'browser_ui', true, 0.6)]),
        gateway,
      }),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((s) => s.includes('second claim text'))).toBe(true);
    expect(seen.some((s) => s.includes('first claim text'))).toBe(false);
  });
});

describe('selectClaim', () => {
  const claims = [claim('a', 'claim a'), claim('b', 'claim b'), claim('c', 'claim c')];

  it('prefers a needed browser_ui Claim over a higher-scoring one that is not needed', () => {
    const assessment = assessmentOf([
      perClaim('a', 'browser_ui', false, 0.99),
      perClaim('b', 'browser_ui', true, 0.4),
      perClaim('c', 'http_api', true, 0.95),
    ]);
    expect(selectClaim(claims, assessment)).toMatchObject({ status: 'identified', text: 'claim b' });
  });

  it('falls back to the highest runtimeObservable browser_ui Claim when none is needed', () => {
    const assessment = assessmentOf([
      perClaim('a', 'browser_ui', false, 0.3),
      perClaim('b', 'browser_ui', false, 0.8),
      perClaim('c', 'http_api', false, 0.99),
    ]);
    expect(selectClaim(claims, assessment)).toMatchObject({ status: 'identified', text: 'claim b' });
  });

  it('breaks a tie by the first Claim in claims order', () => {
    const assessment = assessmentOf([
      perClaim('a', 'browser_ui', true, 0.7),
      perClaim('b', 'browser_ui', true, 0.7),
      perClaim('c', 'browser_ui', true, 0.7),
    ]);
    expect(selectClaim(claims, assessment)).toMatchObject({ status: 'identified', text: 'claim a' });
  });

  it('uses the change subject text and marks the Claim not identified when claims is empty', () => {
    expect(selectClaim([], assessmentOf([], 'Add settings modal'))).toEqual({
      status: 'not_identified',
      text: 'Add settings modal',
    });
  });

  it('maps an empty-claims run to a not_identified evidence claim that still satisfies minimum evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ce-capability-empty-'));
    try {
      const entry = createBrowserCapability({
        cwd: dir,
        env: {},
        openTarget: async () => fakeTarget(),
        launchBrowser: async () => fakeBrowser(),
      });
      const result = await entry.run({
        context,
        claims: [],
        assessment: assessmentOf([], 'Add settings modal'),
        config,
        gateway: new GatewayTestSupport({ inner: scriptedGateway('done') }),
        runDir: dir,
      });
      expect(result.evidence.claim).toEqual({ status: 'not_identified' });
      expect(satisfiesMinimumEvidence(result.evidence)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Browser_Capability wired through run()', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'ce-capability-run-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const NOW = new Date('2026-01-02T03:04:05.678Z');

  /** Answers the assessment questions only; every run in this block stops before any loop request. */
  function assessmentGateway(observable: number, adequate: number): JevGateway {
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
            answers[name] = { type: 'noul', noul: observable };
          } else if (name === 'checks_adequate') {
            answers[name] = { type: 'noul', noul: adequate };
          } else {
            answers[name] = { type: 'noul', noul: 0.01 };
          }
        }
        return { model: 'stub', answers, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Jev_Response;
      },
    };
  }

  const runOptions = (gateway: JevGateway, openTarget: (o: TargetOptions) => Promise<TargetHandle>) => ({
    cwd,
    env: { OPENROUTER_API_KEY: 'sk-or-fake-key-0123456789abcdef' },
    gateway,
    now: () => NOW,
    stderr: { write: () => true },
    exec: () => ({ error: Object.assign(new Error('no git'), { code: '1' }) }),
    capabilities: createCapabilityRegistry([
      createBrowserCapability({
        cwd,
        env: {},
        openTarget,
        launchBrowser: async () => {
          throw new Error('stop after openTarget');
        },
      }),
    ]),
    contextProviders: {
      git: () => ({ files: [], commits: [], truncated: [], status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' } }),
      github: () => ({ pullRequest: { title: 'Add login form' }, status: { name: 'github', status: 'used' } }),
      cli: () => ({ claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } }),
      junit: () => ({ checks: [], status: { name: 'junit', status: 'unavailable', reason: 'not-configured' } }),
    },
  });

  it('never calls the capability when the Assessment is not required', async () => {
    const openTarget = vi.fn(async () => fakeTarget());
    const result = await run(runOptions(assessmentGateway(0.05, 0.95), openTarget) as unknown as Parameters<typeof run>[0]);
    expect(result).toMatchObject({ kind: 'resolved', outcome: 'SKIPPED' });
    expect(openTarget).not.toHaveBeenCalled();
  });

  it('computes runDir for the capability even when a gateway is supplied', async () => {
    const target = fakeTarget();
    const openTarget = vi.fn(async (_o: TargetOptions) => target);
    await run(runOptions(assessmentGateway(0.95, 0.05), openTarget) as unknown as Parameters<typeof run>[0]);
    expect(openTarget).toHaveBeenCalledTimes(1);
    const options = openTarget.mock.calls[0]![0];
    expect(options.runDir).toBe(path.resolve(cwd, '.ce/runs', 'run-2026-01-02T03-04-05-678Z'));
    expect(target.stopped).toBe(1);
  });
});
