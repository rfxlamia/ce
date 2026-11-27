import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { GatewayTestSupport, type FinalImageAnswer } from './gateway.testsupport.js';
import { runLoop, type StopReason } from './loop.js';
import type { ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 20: The loop always resolves to a Loop_Result when at least one Observation exists
// **Validates: Requirements 9.9**

const ORIGIN = 'http://localhost:4000';

type Trigger =
  | 'done'
  | 'reached'
  | 'give_up'
  | 'max-steps'
  | 'time-budget'
  | 'aborted'
  | 'executor-give-up'
  | 'invalid-answer';

const resSnapshots: ActionableElementSnapshot[] = [
  { tag: 'button', role: 'button', name: 'Alpha', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(1)', id: 'alpha' },
  { tag: 'button', role: 'button', name: 'Beta', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(2)', id: 'beta' },
];

/** `locatorCount` 0 makes every Executor locator check fail (a give-up, not a throw). */
function resFakePage(locatorCount: number): PlaywrightPage {
  const locator = {
    count: async () => locatorCount,
    click: async () => undefined,
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page = {
    url: () => `${ORIGIN}/`,
    title: async () => 'Result',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => resSnapshots,
    screenshot: async (options?: { path?: string }) => {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      if (options?.path !== undefined) await writeFile(options.path, bytes);
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

function resClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function resTextGateway(
  trigger: Trigger,
  clock: ReturnType<typeof resClock>,
  controller: AbortController,
  clicksBefore: number,
): JevGateway {
  let asked = 0;
  const click = { '0': 0.9, '1': 0.05, done: 0.02, give_up: 0.02 };
  return {
    async ask(_request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
      const n = asked++;
      let probabilities: Record<string, number> = click;
      let stateReachedDom = 0.05;
      const terminalNow = n >= clicksBefore;
      if (terminalNow) {
        switch (trigger) {
          case 'done':
            probabilities = { '0': 0.05, '1': 0.05, done: 0.9, give_up: 0.02 };
            break;
          case 'reached':
            stateReachedDom = 0.95;
            break;
          case 'give_up':
            probabilities = { '0': 0.05, '1': 0.05, done: 0.02, give_up: 0.9 };
            break;
          case 'invalid-answer':
            probabilities = {};
            break;
          case 'time-budget':
            clock.advance(10_000_000);
            break;
          case 'aborted':
            controller.abort(new Error('outside abort'));
            await new Promise<never>(() => undefined);
            break;
          default:
            break; // max-steps, executor-give-up: keep answering click
        }
      }
      return {
        model: 'typesafe/jev-1.14-test',
        answers: {
          next_action: { type: 'choice', probabilities },
          state_reached_dom: { type: 'noul', noul: stateReachedDom },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Jev_Response;
    },
  };
}

const finalImageArb: fc.Arbitrary<FinalImageAnswer> = fc.oneof(
  fc.record({ stateReached: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.constantFrom<FinalImageAnswer>(
    { failure: 'multipart-400' },
    { failure: 'timeout' },
    { failure: 'rate-limit' },
  ),
);

const caseArb = fc.record({
  trigger: fc.constantFrom<Trigger>(
    'done',
    'reached',
    'give_up',
    'max-steps',
    'time-budget',
    'aborted',
    'executor-give-up',
    'invalid-answer',
  ),
  clicksBefore: fc.integer({ min: 0, max: 3 }),
  maxSteps: fc.integer({ min: 1, max: 4 }),
  finalImage: finalImageArb,
});

const expectedStops: Record<Trigger, readonly StopReason[]> = {
  done: ['done'],
  reached: ['reached'],
  give_up: ['give_up'],
  'max-steps': ['max-steps'],
  'time-budget': ['time-budget'],
  aborted: ['aborted'],
  'executor-give-up': ['give_up'],
  'invalid-answer': ['give_up'],
};

describe('Property 20: the loop resolves to a Loop_Result once an Observation exists', () => {
  it('returns a LoopResult with at least one Observation for every stop reason, never throwing for not-reached', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ trigger, clicksBefore, maxSteps: rawMaxSteps, finalImage }) => {
        // Non-budget triggers must fire before the step budget does.
        const maxSteps = trigger === 'max-steps' ? rawMaxSteps : Math.max(rawMaxSteps, clicksBefore + 1);
        const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-res-'));
        try {
          const clock = resClock();
          const controller = new AbortController();
          // max-steps needs the loop to run past maxSteps; the others stop at the scripted answer.
          const before = trigger === 'max-steps' ? maxSteps + 1 : trigger === 'executor-give-up' ? 0 : clicksBefore;
          const gateway = new GatewayTestSupport({
            inner: resTextGateway(trigger, clock, controller, before),
            finalImage,
          });
          const result = await runLoop({
            page: resFakePage(trigger === 'executor-give-up' ? 0 : 1),
            gateway,
            claim: 'the button works',
            changeTerms: new Set(),
            targetOrigin: ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps,
            timeBudgetMs: 1_000_000,
            runDir,
            signal: controller.signal,
            clock,
          });

          expect(result.observations.length).toBeGreaterThanOrEqual(1);
          expect(expectedStops[trigger]).toContain(result.stopReason);
          expect(['reached', 'not_reached']).toContain(result.finalState);
          expect(Array.isArray(result.steps)).toBe(true);
          expect(Array.isArray(result.eventLog)).toBe(true);
          // At most one image request, whatever happened.
          expect(gateway.imageRequests.length).toBeLessThanOrEqual(1);
          // A failed image request degrades to text signals instead of failing the run.
          if (result.finalImageError !== undefined) expect(result.subjectBox).toBeUndefined();
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 20: example', () => {
  it('a never-reached claim stopped by max-steps still resolves with finalState not_reached', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-res-'));
    try {
      const clock = resClock();
      const result = await runLoop({
        page: resFakePage(1),
        gateway: new GatewayTestSupport({
          inner: resTextGateway('max-steps', clock, new AbortController(), 99),
          finalImage: { stateReached: 0.1 },
        }),
        claim: 'c',
        changeTerms: new Set(),
        targetOrigin: ORIGIN,
        routes: [],
        fixtures: {},
        maxSteps: 2,
        timeBudgetMs: 1_000_000,
        runDir,
        clock,
      });
      expect(result.stopReason).toBe('max-steps');
      expect(result.finalState).toBe('not_reached');
      expect(result.observations.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
