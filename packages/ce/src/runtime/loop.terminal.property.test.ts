import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop } from './loop.js';
import type { ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 19: A reached or terminal answer stops the loop without a further action
// **Validates: Requirements 9.4**

const ORIGIN = 'http://localhost:4000';

type Terminal = 'reached' | 'done' | 'give_up';

/** Helpers below are private to this file (prefix `term`). */
const termSnapshots: ActionableElementSnapshot[] = [
  { tag: 'button', role: 'button', name: 'Alpha', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(1)', id: 'alpha' },
  { tag: 'button', role: 'button', name: 'Beta', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(2)', id: 'beta' },
];

function termFakePage(counters: { clicks: number; fills: number; gotos: number }): PlaywrightPage {
  const locator = {
    count: async () => 1,
    click: async () => {
      counters.clicks += 1;
    },
    fill: async () => {
      counters.fills += 1;
    },
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page = {
    url: () => `${ORIGIN}/`,
    title: async () => 'Terminal',
    locator: () => locator,
    goto: async () => {
      counters.gotos += 1;
    },
    evaluate: async () => termSnapshots,
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

interface TermScript {
  /** Number of click answers before the terminal answer. */
  clicksBefore: number;
  terminal: Terminal;
  /** For `reached`: the competing next_action answer in the same response. */
  competing: 'click' | 'done' | 'give_up';
  reachedProbability: number;
  maxStepsExtra: number;
}

/** Scripted text gateway: answers request N from the script, never decides anything itself. */
function termScriptedGateway(script: TermScript): JevGateway & { asked: number } {
  const gateway = {
    asked: 0,
    async ask(_request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
      const n = gateway.asked++;
      const isTerminal = n >= script.clicksBefore;
      let probabilities: Record<string, number>;
      let stateReachedDom = 0.05;
      if (!isTerminal) {
        probabilities = { '0': 0.9, '1': 0.05, done: 0.02, give_up: 0.02 };
      } else if (script.terminal === 'reached') {
        stateReachedDom = script.reachedProbability;
        probabilities =
          script.competing === 'click'
            ? { '0': 0.9, '1': 0.05, done: 0.02, give_up: 0.02 }
            : script.competing === 'done'
              ? { '0': 0.05, '1': 0.05, done: 0.9, give_up: 0.02 }
              : { '0': 0.05, '1': 0.05, done: 0.02, give_up: 0.9 };
      } else if (script.terminal === 'done') {
        probabilities = { '0': 0.05, '1': 0.05, done: 0.9, give_up: 0.02 };
      } else {
        probabilities = { '0': 0.05, '1': 0.05, done: 0.02, give_up: 0.9 };
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
  return gateway;
}

function termFakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const scriptArb: fc.Arbitrary<TermScript> = fc.record({
  clicksBefore: fc.integer({ min: 0, max: 3 }),
  terminal: fc.constantFrom<Terminal>('reached', 'done', 'give_up'),
  competing: fc.constantFrom<'click' | 'done' | 'give_up'>('click', 'done', 'give_up'),
  reachedProbability: fc.double({ min: 0.7, max: 1, noNaN: true }),
  maxStepsExtra: fc.integer({ min: 1, max: 5 }),
});

describe('Property 19: terminal answers stop the loop', () => {
  it('stops at the first reached/done/give_up answer and executes no further Action', async () => {
    await fc.assert(
      fc.asyncProperty(scriptArb, async (script) => {
        const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-term-'));
        try {
          const counters = { clicks: 0, fills: 0, gotos: 0 };
          const inner = termScriptedGateway(script);
          const gateway = new GatewayTestSupport({ inner });
          const result = await runLoop({
            page: termFakePage(counters),
            gateway,
            claim: 'the button works',
            changeTerms: new Set(),
            targetOrigin: ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps: script.clicksBefore + script.maxStepsExtra,
            timeBudgetMs: 1_000_000,
            runDir,
            clock: termFakeClock(),
          });

          const expectedStop: Terminal = script.terminal;
          expect(result.stopReason).toBe(expectedStop);

          // One decision request per step, none after the terminal answer.
          expect(inner.asked).toBe(script.clicksBefore + 1);
          expect(gateway.textRequests).toHaveLength(script.clicksBefore + 1);

          // Exactly the pre-terminal clicks ran; the terminal step ran nothing.
          expect(counters.clicks).toBe(script.clicksBefore);
          expect(counters.fills).toBe(0);
          expect(counters.gotos).toBe(0);

          // The step log ends at the terminal step, whose Action is not an executable one.
          expect(result.steps).toHaveLength(script.clicksBefore + 1);
          const last = result.steps[result.steps.length - 1]!;
          expect(last.action.kind).toBe(script.terminal === 'give_up' ? 'give_up' : 'done');
          for (const step of result.steps.slice(0, -1)) expect(step.action.kind).toBe('click');

          // No Observation is taken after the terminal step.
          expect(result.observations).toHaveLength(script.clicksBefore + 1);
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 19: example', () => {
  it('a reached answer wins over a competing click and runs no Action', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-term-'));
    try {
      const counters = { clicks: 0, fills: 0, gotos: 0 };
      const result = await runLoop({
        page: termFakePage(counters),
        gateway: new GatewayTestSupport({
          inner: termScriptedGateway({
            clicksBefore: 0,
            terminal: 'reached',
            competing: 'click',
            reachedProbability: 0.7,
            maxStepsExtra: 3,
          }),
        }),
        claim: 'c',
        changeTerms: new Set(),
        targetOrigin: ORIGIN,
        routes: [],
        fixtures: {},
        maxSteps: 3,
        timeBudgetMs: 1_000_000,
        runDir,
        clock: termFakeClock(),
      });
      expect(result.stopReason).toBe('reached');
      expect(counters.clicks).toBe(0);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
