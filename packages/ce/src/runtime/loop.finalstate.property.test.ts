import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JevImageError, type JevImageErrorReason } from '../jev/errors.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { REACHED_THRESHOLD } from './constants.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop, type LoopResult } from './loop.js';
import type { ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 22: Final state resolution is a deterministic function of the image result and the text signals
// **Validates: Requirements 9.6, 10.5, 10.6, 10.7, 10.11**

const ORIGIN = 'http://localhost:4000';

type FsTerminal = 'reached' | 'done' | 'give_up' | 'max-steps';

const fsSnapshots: ActionableElementSnapshot[] = [
  { tag: 'button', role: 'button', name: 'Alpha', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(1)', id: 'alpha' },
  { tag: 'button', role: 'button', name: 'Beta', visible: true, enabled: true, cssPath: 'html > body > button:nth-of-type(2)', id: 'beta' },
];

function fsFakePage(): PlaywrightPage {
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
    url: () => `${ORIGIN}/`,
    title: async () => 'Final state',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: async () => fsSnapshots,
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

function fsFakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

interface FsScript {
  /** state_reached_dom probability of each click step (always below the threshold). */
  earlyDom: number[];
  terminal: FsTerminal;
  /** state_reached_dom of the terminal step when `terminal` is `reached` (at or above threshold). */
  reachedDom: number;
}

/** Scripted text gateway. Early steps click; the last step ends as `script.terminal`. */
function fsScriptedGateway(script: FsScript): JevGateway {
  let n = 0;
  return {
    async ask(_request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
      const i = n++;
      const early = i < script.earlyDom.length;
      let dom = early ? script.earlyDom[i]! : 0.05;
      let probabilities: Record<string, number> = { '0': 0.9, '1': 0.05, done: 0.02, give_up: 0.02 };
      if (!early) {
        if (script.terminal === 'reached') dom = script.reachedDom;
        else if (script.terminal === 'done') probabilities = { '0': 0.05, '1': 0.05, done: 0.9, give_up: 0.02 };
        else if (script.terminal === 'give_up') probabilities = { '0': 0.05, '1': 0.05, done: 0.02, give_up: 0.9 };
      }
      return {
        model: 'typesafe/jev-1.14-test',
        answers: {
          next_action: { type: 'choice', probabilities },
          state_reached_dom: { type: 'noul', noul: dom },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Jev_Response;
    },
  };
}

type FsImage =
  | { kind: 'success'; stateReached: number }
  | { kind: 'error'; reason: JevImageErrorReason };

const fsReasons: JevImageErrorReason[] = [
  'bad_request',
  'rate_limited',
  'timeout',
  'connection',
  'server',
  'invalid_image',
  'invalid_response',
  'client',
];

const fsScriptArb: fc.Arbitrary<FsScript> = fc.record({
  earlyDom: fc.array(fc.double({ min: 0, max: 0.69, noNaN: true }), { minLength: 0, maxLength: 3 }),
  terminal: fc.constantFrom<FsTerminal>('reached', 'done', 'give_up', 'max-steps'),
  reachedDom: fc.double({ min: REACHED_THRESHOLD, max: 1, noNaN: true }),
});

const fsImageArb: fc.Arbitrary<FsImage> = fc.oneof(
  fc.record({
    kind: fc.constant('success' as const),
    stateReached: fc.oneof(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.constantFrom(0, REACHED_THRESHOLD, 0.6999, 1),
    ),
  }),
  fc.record({ kind: fc.constant('error' as const), reason: fc.constantFrom(...fsReasons) }),
);

async function fsRun(script: FsScript, image: FsImage, timeBudgetMs = 1_000_000): Promise<LoopResult> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-final-'));
  try {
    const gateway = new GatewayTestSupport({
      inner: fsScriptedGateway(script),
      finalImage:
        image.kind === 'success'
          ? { stateReached: image.stateReached }
          : { failure: new JevImageError(image.reason) },
    });
    const result = await runLoop({
      page: fsFakePage(),
      gateway,
      claim: 'the button works',
      changeTerms: new Set(),
      targetOrigin: ORIGIN,
      routes: [],
      fixtures: {},
      // `max-steps` ends after the early clicks; the others end by their terminal answer.
      maxSteps: script.terminal === 'max-steps' ? Math.max(1, script.earlyDom.length) : script.earlyDom.length + 5,
      timeBudgetMs,
      runDir,
      clock: fsFakeClock(),
    });
    expect(gateway.finalImageRequests).toHaveLength(1);
    return result;
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

describe('Property 22: final state resolution', () => {
  it('resolves finalState from the image result, else from the text signals', async () => {
    await fc.assert(
      fc.asyncProperty(fsScriptArb, fsImageArb, async (script, image) => {
        // Text_Signals: any step at or above the threshold, or the loop ended `done`.
        const textReached = script.terminal === 'reached' || script.terminal === 'done';
        const result = await fsRun(script, image);

        if (image.kind === 'success') {
          expect(result.finalState).toBe(image.stateReached >= REACHED_THRESHOLD ? 'reached' : 'not_reached');
          expect(result.subjectBox).toBeDefined();
          expect(result.finalImageError).toBeUndefined();
          expect(result.finalImageModel).toBeDefined();
          expect(result.finalSignals.stateReached).toBe(image.stateReached);
        } else {
          expect(result.finalState).toBe(textReached ? 'reached' : 'not_reached');
          expect(result.subjectBox).toBeUndefined();
          expect(result.finalImageError).toBe(image.reason);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic: the same inputs give the same finalState and error', async () => {
    await fc.assert(
      fc.asyncProperty(fsScriptArb, fsImageArb, async (script, image) => {
        const a = await fsRun(script, image);
        const b = await fsRun(script, image);
        expect(b.finalState).toBe(a.finalState);
        expect(b.finalImageError).toBe(a.finalImageError);
        expect(b.subjectBox).toEqual(a.subjectBox);
      }),
      { numRuns: 25 },
    );
  });

  it("reports 'time-budget' when the loop's own deadline aborted the image request, with Text_Signals deciding", async () => {
    await fc.assert(
      fc.asyncProperty(fsScriptArb, fc.constantFrom(...fsReasons), async (script, reason) => {
        const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-final-'));
        try {
          const scripted = fsScriptedGateway(script);
          const budget = 1_000_000;
          const lastTextIndex = script.terminal === 'max-steps' ? Math.max(1, script.earlyDom.length) - 1 : script.earlyDom.length;
          let asked = 0;
          let virtual = 0;
          let jumped: { at: number } | undefined;
          const clock = {
            now: () => (jumped === undefined ? virtual : budget - 1_000 + (virtual - jumped.at)),
            sleep: async (ms: number) => {
              virtual += ms;
            },
          };
          const inner: JevGateway = {
            async ask(request, options) {
              const response = await scripted.ask(request, options);
              // After the last decision, jump the clock so only about 1 s of budget remains.
              if (asked++ === lastTextIndex) jumped = { at: virtual };
              return response;
            },
          };
          // Image request never answers on its own; it fails only once the loop's abort signal fires.
          const gateway: JevGateway = {
            async ask(request, options) {
              const isImage = Object.values(request.questions).some((q) => q.id === 'runtime.state_reached');
              if (!isImage) return inner.ask(request, options);
              await new Promise<void>((resolve) => {
                if (options?.signal?.aborted === true) resolve();
                else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
              });
              throw new JevImageError(reason);
            },
          };
          const result = await runLoop({
            page: fsFakePage(),
            gateway,
            claim: 'the button works',
            changeTerms: new Set(),
            targetOrigin: ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps: script.terminal === 'max-steps' ? Math.max(1, script.earlyDom.length) : script.earlyDom.length + 5,
            timeBudgetMs: budget,
            runDir,
            clock,
          });
          const textReached = script.terminal === 'reached' || script.terminal === 'done';
          expect(result.finalImageError).toBe('time-budget');
          expect(result.subjectBox).toBeUndefined();
          expect(result.finalState).toBe(textReached ? 'reached' : 'not_reached');
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 6 },
    );
  }, 60_000);
});

describe('Property 22: examples', () => {
  it('multipart 400 with a reached text signal keeps `reached` and drops the Box', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-final-'));
    try {
      const gateway = new GatewayTestSupport({
        inner: fsScriptedGateway({ earlyDom: [], terminal: 'reached', reachedDom: 0.8 }),
        finalImage: { failure: 'multipart-400' },
      });
      const result = await runLoop({
        page: fsFakePage(),
        gateway,
        claim: 'c',
        changeTerms: new Set(),
        targetOrigin: ORIGIN,
        routes: [],
        fixtures: {},
        maxSteps: 3,
        timeBudgetMs: 1_000_000,
        runDir,
        clock: fsFakeClock(),
      });
      expect(result.finalState).toBe('reached');
      expect(result.finalImageError).toBe('bad_request');
      expect(result.subjectBox).toBeUndefined();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
