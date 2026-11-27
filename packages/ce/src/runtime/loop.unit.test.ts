import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop, type LoopResult } from './loop.js';
import type { ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Unit tests for runLoop (task 8.11). Helpers are private to this file (prefix `lu`).
// Requirements: 3.8, 5.8, 8.1, 8.5, 8.6, 8.7, 10.2, 10.3, 10.6, 10.9, 12.6, 12.7

const ORIGIN = 'http://localhost:4000';
const OFF_ORIGIN = 'http://elsewhere.example:5000/';

interface LuPageOptions {
  /** URL reported once at least one click ran. */
  urlAfterClick?: string;
  /** Throw from `evaluate` once at least one click ran (page crash). */
  crashAfterClick?: boolean;
  /** Throw from `screenshot` on the Nth call (1-based). */
  screenshotFailsOn?: number;
}

interface LuPage {
  page: PlaywrightPage;
  /** Ordered trace of `on:<event>` and `evaluate` calls. */
  trace: string[];
  screenshotPaths: string[];
  clicks: () => number;
}

function luSnapshots(clicks: number): ActionableElementSnapshot[] {
  return [
    { tag: 'button', role: 'button', name: `Alpha ${clicks}`, visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(1)', id: 'alpha' },
    { tag: 'button', role: 'button', name: 'Beta', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(2)', id: 'beta' },
  ];
}

function luFakePage(options: LuPageOptions = {}): LuPage {
  const trace: string[] = [];
  const screenshotPaths: string[] = [];
  let clicks = 0;
  let shots = 0;
  const locator = {
    count: async () => 1,
    click: async () => {
      clicks += 1;
    },
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page = {
    url: () => (clicks > 0 && options.urlAfterClick !== undefined ? options.urlAfterClick : `${ORIGIN}/`),
    title: async () => 'Unit',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => {
      trace.push('evaluate');
      if (clicks > 0 && options.crashAfterClick === true) throw new Error('Target page, context or browser has been closed');
      return luSnapshots(clicks);
    },
    screenshot: async (opts?: { path?: string }) => {
      shots += 1;
      if (options.screenshotFailsOn === shots) throw new Error('disk full');
      const bytes = new Uint8Array([137, 80, 78, 71]);
      if (opts?.path !== undefined) {
        screenshotPaths.push(opts.path);
        await writeFile(opts.path, bytes);
      }
      return bytes;
    },
    route: async () => undefined,
    unroute: async () => undefined,
    on: (event: string) => {
      trace.push(`on:${event}`);
    },
    off: () => undefined,
    close: async () => undefined,
    isClosed: () => false,
  };
  return { page: page as unknown as PlaywrightPage, trace, screenshotPaths, clicks: () => clicks };
}

type LuAnswer = 'click' | 'done' | 'give_up';

/** Scripted text gateway. After the script ends, the last answer repeats. */
function luScriptedGateway(script: LuAnswer[], opts: { failOn?: number; reachedOn?: number } = {}): JevGateway & { asked: number } {
  const gateway = {
    asked: 0,
    async ask(_request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
      const n = gateway.asked++;
      if (opts.failOn === n) throw new Error('gateway exploded');
      const answer = script[Math.min(n, script.length - 1)]!;
      const probabilities =
        answer === 'click'
          ? { '0': 0.9, '1': 0.05, done: 0.02, give_up: 0.02 }
          : answer === 'done'
            ? { '0': 0.05, '1': 0.05, done: 0.9, give_up: 0.02 }
            : { '0': 0.05, '1': 0.05, done: 0.02, give_up: 0.9 };
      return {
        model: 'typesafe/jev-1.14-test',
        answers: {
          next_action: { type: 'choice', probabilities },
          state_reached_dom: { type: 'noul', noul: opts.reachedOn === n ? 0.95 : 0.05 },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Jev_Response;
    },
  };
  return gateway;
}

function luClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

async function luExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

describe('runLoop unit tests', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-unit-'));
  });
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  const luRun = (
    fake: LuPage,
    gateway: JevGateway,
    extra: { maxSteps?: number } = {},
  ): Promise<LoopResult> =>
    runLoop({
      page: fake.page,
      gateway,
      claim: 'the button works',
      changeTerms: new Set(),
      targetOrigin: ORIGIN,
      routes: [],
      fixtures: {},
      maxSteps: extra.maxSteps ?? 5,
      timeBudgetMs: 1_000_000,
      runDir,
      clock: luClock(),
    });

  it('registers dialog, download and popup handlers before the first Observation', async () => {
    const fake = luFakePage();
    await luRun(fake, new GatewayTestSupport({ inner: luScriptedGateway(['done']) }));
    const firstEvaluate = fake.trace.indexOf('evaluate');
    expect(firstEvaluate).toBeGreaterThan(0);
    const before = fake.trace.slice(0, firstEvaluate);
    expect(before).toEqual(expect.arrayContaining(['on:dialog', 'on:download', 'on:popup']));
  });

  it('writes the step-0 screenshot under runDir, with the step number in its name, before the first decision', async () => {
    const fake = luFakePage();
    let step0ExistedAtFirstDecision = false;
    const inner = luScriptedGateway(['done']);
    const gateway = new GatewayTestSupport({
      inner: {
        ask: async (request, options) => {
          step0ExistedAtFirstDecision = await luExists(path.join(runDir, 'step-0.png'));
          return inner.ask(request, options);
        },
      },
    });
    const result = await luRun(fake, gateway);
    expect(step0ExistedAtFirstDecision).toBe(true);
    const first = result.observations[0]!;
    expect(first.screenshot).toBe('step-0.png');
    expect(path.isAbsolute(first.screenshot)).toBe(false);
  });

  it('raises StageError(runtime) and stops when the decision request fails', async () => {
    const fake = luFakePage();
    const inner = luScriptedGateway(['click', 'click'], { failOn: 1 });
    const gateway = new GatewayTestSupport({ inner });
    const error = await luRun(fake, gateway).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('runtime');
    // One click ran for the first decision; the failed second decision ran nothing and nothing followed.
    expect(fake.clicks()).toBe(1);
    expect(inner.asked).toBe(2);
    expect(gateway.finalImageRequests).toHaveLength(0);
  });

  describe('final screenshot and Final_Image_Request per stop reason', () => {
    const cases: Array<{ name: string; script: LuAnswer[]; opts?: { reachedOn?: number }; maxSteps?: number; stop: string }> = [
      { name: 'done', script: ['done'], stop: 'done' },
      { name: 'give_up', script: ['give_up'], stop: 'give_up' },
      { name: 'reached', script: ['click'], opts: { reachedOn: 0 }, stop: 'reached' },
      { name: 'max-steps', script: ['click'], maxSteps: 1, stop: 'max-steps' },
    ];
    for (const c of cases) {
      it(`takes a final screenshot and sends one combined image request on ${c.name}`, async () => {
        const fake = luFakePage();
        const gateway = new GatewayTestSupport({ inner: luScriptedGateway(c.script, c.opts) });
        const result = await luRun(fake, gateway, c.maxSteps === undefined ? {} : { maxSteps: c.maxSteps });
        expect(result.stopReason).toBe(c.stop);
        expect(result.finalScreenshot).toBeDefined();
        expect(await luExists(path.join(runDir, result.finalScreenshot!))).toBe(true);
        expect(gateway.imageRequests).toHaveLength(1);
        expect(gateway.finalImageRequests).toHaveLength(1);
        expect(gateway.finalImageRequests[0]!.questionNames.sort()).toEqual(['locate_subject', 'state_reached']);
        expect(result.subjectBox).toBeDefined();
        expect(result.finalImageModel).toBeDefined();
      });
    }
  });

  it('sends no image in any step request', async () => {
    const fake = luFakePage();
    const gateway = new GatewayTestSupport({ inner: luScriptedGateway(['click', 'click', 'done']) });
    await luRun(fake, gateway);
    expect(gateway.textRequests.length).toBeGreaterThanOrEqual(3);
    for (const r of gateway.textRequests) {
      expect(r.hasImage).toBe(false);
      expect(r.questionNames).toEqual(expect.arrayContaining(['next_action', 'state_reached_dom']));
    }
    expect(gateway.imageRequests).toHaveLength(1);
  });

  it('stops with a refusal when the page is off-origin after an Action, keeping the last on-origin screenshot', async () => {
    const fake = luFakePage({ urlAfterClick: OFF_ORIGIN });
    const gateway = new GatewayTestSupport({ inner: luScriptedGateway(['click']) });
    const result = await luRun(fake, gateway);
    expect(result.stopReason).toBe('give_up');
    expect(result.eventLog.some((e) => e.kind === 'refusal')).toBe(true);
    // No Observation or screenshot of the off-origin page.
    expect(result.observations).toHaveLength(1);
    expect(fake.screenshotPaths.map((p) => path.basename(p))).toEqual(['step-0.png']);
    expect(result.observations[0]!.screenshot).toBe('step-0.png');
    // No final screenshot, hence no Final_Image_Request (Requirement 10.9).
    expect(result.finalScreenshot).toBeUndefined();
    expect(gateway.imageRequests).toHaveLength(0);
  });

  it('raises StageError(runtime) when the step-0 screenshot cannot be written', async () => {
    const fake = luFakePage({ screenshotFailsOn: 1 });
    const gateway = new GatewayTestSupport({ inner: luScriptedGateway(['done']) });
    const error = await luRun(fake, gateway).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('runtime');
    expect(gateway.requests).toHaveLength(0);
  });

  it('raises StageError(runtime) when a later screenshot cannot be written, keeping earlier Observations', async () => {
    const fake = luFakePage({ screenshotFailsOn: 2 });
    const gateway = new GatewayTestSupport({ inner: luScriptedGateway(['click', 'done']) });
    const error = await luRun(fake, gateway).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('runtime');
    const partial = (error as StageError & { partial?: Pick<LoopResult, 'observations'> }).partial;
    expect(partial?.observations).toHaveLength(1);
    expect(await luExists(path.join(runDir, 'step-0.png'))).toBe(true);
  });

  it('raises StageError(runtime) on a page crash and keeps the earlier Observations', async () => {
    const fake = luFakePage({ crashAfterClick: true });
    const gateway = new GatewayTestSupport({ inner: luScriptedGateway(['click']) });
    const error = await luRun(fake, gateway).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('runtime');
    const partial = (error as StageError & { partial?: Pick<LoopResult, 'observations' | 'steps'> }).partial;
    expect(partial?.observations.length).toBeGreaterThanOrEqual(1);
    expect(partial?.steps.length).toBeGreaterThanOrEqual(1);
    expect(await luExists(path.join(runDir, 'step-0.png'))).toBe(true);
  });

  it('turns a multipart 400 JevImageError into finalImageError, no Box and a Text_Signals finalState', async () => {
    const fake = luFakePage();
    const gateway = new GatewayTestSupport({
      inner: luScriptedGateway(['done']),
      finalImage: { failure: 'multipart-400' },
    });
    const result = await luRun(fake, gateway);
    expect(result.finalImageError).toBe('bad_request');
    expect(result.subjectBox).toBeUndefined();
    expect(result.finalImageModel).toBeUndefined();
    expect(result.finalSignals.stateReached).toBeUndefined();
    // Ended `done`: Text_Signals say reached.
    expect(result.finalState).toBe('reached');
    expect(gateway.finalImageRequests).toHaveLength(1);
    expect(gateway.finalImageRequests[0]!.failed).toBe(true);
  });

  it('derives not_reached from Text_Signals when the image request fails and nothing signalled reached', async () => {
    const fake = luFakePage();
    const gateway = new GatewayTestSupport({
      inner: luScriptedGateway(['give_up']),
      finalImage: { failure: 'multipart-400' },
    });
    const result = await luRun(fake, gateway);
    expect(result.finalImageError).toBe('bad_request');
    expect(result.finalState).toBe('not_reached');
  });
});
