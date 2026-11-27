import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop, type LoopClock } from './loop.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 21: Per-call timeout is the minimum of the Playwright default and the remaining budget
// **Validates: Requirements 9.12**

const TIMEOUT_ORIGIN = 'http://localhost:4173';
const TIMEOUT_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TIMEOUT_SNAPSHOTS = [
  { tag: 'button', role: 'button', name: 'Go', visible: true, enabled: true, cssPath: 'body > button:nth-of-type(1)' },
];

interface TimeoutCall {
  kind: 'click' | 'screenshot';
  timeout: number | undefined;
  /** Virtual time at which the Playwright call was made. */
  at: number;
}

function makeTimeoutPage(now: () => number, calls: TimeoutCall[]): PlaywrightPage {
  const locator = {
    count: async () => 1,
    click: async (options?: { timeout?: number }) => {
      calls.push({ kind: 'click', timeout: options?.timeout, at: now() });
    },
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page = {
    url: () => `${TIMEOUT_ORIGIN}/`,
    title: async () => 'Timeout page',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => TIMEOUT_SNAPSHOTS,
    screenshot: async (options?: { path?: string; timeout?: number }) => {
      calls.push({ kind: 'screenshot', timeout: options?.timeout, at: now() });
      if (options?.path !== undefined) await writeFile(options.path, TIMEOUT_PNG);
      return TIMEOUT_PNG;
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

/** Always answers "click option 0", never reached; advances the virtual clock per request. */
function makeTimeoutGateway(advance: (ms: number) => void, durations: number[]): JevGateway {
  let call = 0;
  return {
    async ask(): Promise<Jev_Response> {
      advance(durations[call++] ?? 0);
      return {
        model: 'timeout-test-model',
        answers: {
          next_action: { type: 'choice', probabilities: { '0': 0.9, done: 0.05, give_up: 0.05 } },
          state_reached_dom: { type: 'noul', noul: 0.1 },
        } as unknown as Jev_Response['answers'],
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}

let timeoutBaseDir: string;
let timeoutDirCounter = 0;

beforeAll(async () => {
  timeoutBaseDir = await mkdtemp(path.join(tmpdir(), 'ce-loop-timeouts-'));
});

afterAll(async () => {
  await rm(timeoutBaseDir, { recursive: true, force: true });
});

describe('runLoop per-call timeouts', () => {
  it('Property 21: every Playwright call gets max(1, min(playwright default, time remaining until the Time_Budget))', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 20_000, max: 60_000 }),
        fc.integer({ min: 500, max: 70_000 }),
        fc.array(fc.integer({ min: 0, max: 4000 }), { minLength: 12, maxLength: 12 }),
        async (maxSteps, timeBudgetMs, playwrightDefaultTimeoutMs, durations) => {
          let virtualNow = 2_000_000;
          const clock: LoopClock = {
            now: () => virtualNow,
            sleep: async (ms) => {
              virtualNow += ms;
            },
          };
          const calls: TimeoutCall[] = [];
          const page = makeTimeoutPage(clock.now, calls);
          const gateway = new GatewayTestSupport({
            inner: makeTimeoutGateway((ms) => {
              virtualNow += ms;
            }, durations),
          });
          const startedAt = virtualNow;

          await runLoop({
            page,
            gateway,
            claim: 'the go button works',
            changeTerms: new Set(),
            targetOrigin: TIMEOUT_ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps,
            timeBudgetMs,
            runDir: path.join(timeoutBaseDir, `run-${timeoutDirCounter++}`),
            clock,
            playwrightDefaultTimeoutMs,
          });

          expect(calls.some((c) => c.kind === 'click')).toBe(true);
          expect(calls.some((c) => c.kind === 'screenshot')).toBe(true);
          for (const call of calls) {
            const remaining = startedAt + timeBudgetMs - call.at;
            const expected = Math.max(1, Math.min(playwrightDefaultTimeoutMs, remaining));
            expect(call.timeout).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses the Playwright default when plenty of budget remains and the remaining time when it is smaller', async () => {
    let virtualNow = 0;
    const clock: LoopClock = {
      now: () => virtualNow,
      sleep: async (ms) => {
        virtualNow += ms;
      },
    };
    const calls: TimeoutCall[] = [];
    const page = makeTimeoutPage(clock.now, calls);
    // The first decision takes 15 s: later calls see only 5 s of the 20 s budget left.
    const gateway = new GatewayTestSupport({
      inner: makeTimeoutGateway((ms) => {
        virtualNow += ms;
      }, [0, 15_000]),
    });

    await runLoop({
      page,
      gateway,
      claim: 'the go button works',
      changeTerms: new Set(),
      targetOrigin: TIMEOUT_ORIGIN,
      routes: [],
      fixtures: {},
      maxSteps: 1,
      timeBudgetMs: 60_000,
      runDir: path.join(timeoutBaseDir, `run-${timeoutDirCounter++}`),
      clock,
      playwrightDefaultTimeoutMs: 30_000,
    });

    expect(calls[0]?.timeout).toBe(30_000);
    expect(calls.every((c) => (c.timeout ?? 0) <= 30_000)).toBe(true);
  });
});
