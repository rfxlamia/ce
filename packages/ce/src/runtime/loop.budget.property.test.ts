import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isImageRequest } from '../jev/gateway.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { loopDeadlineMs } from './constants.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop, type LoopClock, type LoopResult } from './loop.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 18: The loop never exceeds its step or time budget, under any stop trigger
// **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.11, 12.5**

const ORIGIN = 'http://localhost:4173';

type Trigger = 'click' | 'done' | 'give_up' | 'reached' | 'abort' | 'hang';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BUDGET_SNAPSHOTS = [
  { tag: 'button', role: 'button', name: 'Go', visible: true, enabled: true, cssPath: 'body > button:nth-of-type(1)' },
  { tag: 'button', role: 'button', name: 'More', visible: true, enabled: true, cssPath: 'body > button:nth-of-type(2)' },
];

interface BudgetPage {
  page: PlaywrightPage;
  clicks: () => number;
}

function makeBudgetPage(): BudgetPage {
  let clicks = 0;
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
    url: () => `${ORIGIN}/`,
    title: async () => 'Budget page',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => BUDGET_SNAPSHOTS,
    screenshot: async (options?: { path?: string }) => {
      if (options?.path !== undefined) await writeFile(options.path, PNG_BYTES);
      return PNG_BYTES;
    },
    route: async () => undefined,
    unroute: async () => undefined,
    on: () => undefined,
    off: () => undefined,
    close: async () => undefined,
    isClosed: () => false,
  };
  return { page: page as unknown as PlaywrightPage, clicks: () => clicks };
}

function budgetAnswer(trigger: Trigger): Jev_Response {
  const probabilities =
    trigger === 'done'
      ? { done: 0.9, '0': 0.05, give_up: 0.05 }
      : trigger === 'give_up'
        ? { give_up: 0.9, '0': 0.05, done: 0.05 }
        : { '0': 0.9, done: 0.05, give_up: 0.05 };
  return {
    model: 'budget-test-model',
    answers: {
      next_action: { type: 'choice', probabilities },
      state_reached_dom: { type: 'noul', noul: trigger === 'reached' ? 0.95 : 0.1 },
    } as unknown as Jev_Response['answers'],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

interface BudgetTextGateway extends JevGateway {
  startedAt: number[];
  clickAnswers: () => number;
  sawAbort: () => boolean;
}

/** Scripted text gateway. `advance` moves a virtual clock by the simulated step duration. */
function makeBudgetTextGateway(options: {
  script: Trigger[];
  durations: number[];
  now: () => number;
  advance: (ms: number) => void;
  onAbortTrigger?: () => void;
}): BudgetTextGateway {
  let call = 0;
  let clickAnswers = 0;
  let sawAbort = false;
  const startedAt: number[] = [];
  return {
    startedAt,
    clickAnswers: () => clickAnswers,
    sawAbort: () => sawAbort,
    async ask(_request: Jev_Request, askOptions?: AskOptions): Promise<Jev_Response> {
      const index = call++;
      startedAt.push(options.now());
      const trigger = options.script[index] ?? 'click';
      if (trigger === 'hang') {
        return new Promise<Jev_Response>((_resolve, reject) => {
          const signal = askOptions?.signal;
          const onAbort = (): void => {
            sawAbort = true;
            reject(new Error('aborted'));
          };
          if (signal?.aborted === true) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      options.advance(options.durations[index] ?? 0);
      if (trigger === 'abort') options.onAbortTrigger?.();
      if (trigger === 'click' || trigger === 'reached') clickAnswers += trigger === 'click' ? 1 : 0;
      return budgetAnswer(trigger === 'abort' ? 'click' : trigger);
    },
  };
}

let baseDir: string;
let dirCounter = 0;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), 'ce-loop-budget-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const triggerArb = fc.constantFrom<Trigger>('click', 'click', 'click', 'done', 'give_up', 'reached', 'abort');

describe('runLoop step and time budgets', () => {
  it('Property 18: never exceeds Max_Steps or the Loop_Deadline, and always reaches the final capture (virtual clock)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 20_000, max: 60_000 }),
        fc.array(triggerArb, { minLength: 0, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 2500 }), { minLength: 12, maxLength: 12 }),
        async (maxSteps, timeBudgetMs, script, durations) => {
          let virtualNow = 1_000_000;
          const clock: LoopClock = {
            now: () => virtualNow,
            sleep: async (ms) => {
              virtualNow += ms;
            },
          };
          const outer = new AbortController();
          const runDir = path.join(baseDir, `virtual-${dirCounter++}`);
          const { page, clicks } = makeBudgetPage();
          const text = makeBudgetTextGateway({
            script,
            durations,
            now: clock.now,
            advance: (ms) => {
              virtualNow += ms;
            },
            onAbortTrigger: () => outer.abort(),
          });
          const gateway = new GatewayTestSupport({ inner: text });
          const startedAt = virtualNow;

          const result: LoopResult = await runLoop({
            page,
            gateway,
            claim: 'the go button works',
            changeTerms: new Set(),
            targetOrigin: ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps,
            timeBudgetMs,
            runDir,
            signal: outer.signal,
            clock,
          });

          // Step budget: no more than Max_Steps Actions reach the browser.
          expect(clicks()).toBeLessThanOrEqual(maxSteps);
          expect(clicks()).toBeLessThanOrEqual(text.clickAnswers());
          expect(result.steps.filter((s) => s.action.kind === 'click').length).toBeLessThanOrEqual(maxSteps);

          // Time budget: no decision request starts at or after the Loop_Deadline.
          const deadlineAt = startedAt + loopDeadlineMs(timeBudgetMs);
          for (const t of text.startedAt) expect(t).toBeLessThan(deadlineAt);

          // At most one image request, and never inside a step request.
          expect(gateway.finalImageRequests.length).toBeLessThanOrEqual(1);
          expect(gateway.imageRequests.length).toBe(gateway.finalImageRequests.length);
          expect(gateway.textRequests.every((r) => !r.hasImage)).toBe(true);

          // The final capture happens within the Final_Reserve whatever fired the stop.
          expect(result.finalScreenshot).toBeDefined();
          expect(gateway.finalImageRequests.length).toBe(1);
          expect(virtualNow).toBeLessThanOrEqual(startedAt + timeBudgetMs);

          // The stop reason is consistent with the step budget.
          if (result.stopReason === 'max-steps') expect(clicks()).toBe(maxSteps);
          expect(result.observations.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 18: a hanging gateway request is aborted at the Loop_Deadline and the final capture still runs (real clock)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1800, max: 2400 }),
        fc.integer({ min: 0, max: 1 }),
        async (timeBudgetMs, hangAt) => {
          const runDir = path.join(baseDir, `real-${dirCounter++}`);
          const { page, clicks } = makeBudgetPage();
          const script: Trigger[] = hangAt === 0 ? ['hang'] : ['click', 'hang'];
          const text = makeBudgetTextGateway({
            script,
            durations: [],
            now: () => Date.now(),
            advance: () => undefined,
          });
          const gateway = new GatewayTestSupport({ inner: text });
          const started = Date.now();

          const result = await runLoop({
            page,
            gateway,
            claim: 'the go button works',
            changeTerms: new Set(),
            targetOrigin: ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps: 5,
            timeBudgetMs,
            runDir,
          });
          const elapsed = Date.now() - started;

          expect(result.stopReason).toBe('time-budget');
          expect(text.sawAbort()).toBe(true);
          expect(clicks()).toBe(hangAt);
          expect(elapsed).toBeLessThanOrEqual(timeBudgetMs + 250);
          expect(result.finalScreenshot).toBeDefined();
          expect(gateway.finalImageRequests.length).toBe(1);
          expect(gateway.requests.filter((r) => r.hasImage && !r.isFinalImageRequest).length).toBe(0);
          expect(isImageRequest).toBeTypeOf('function');
        },
      ),
      { numRuns: 4 },
    );
  }, 60_000);
});
