import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import type { DecidedAction } from './decide.js';
import { execute } from './execute.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop } from './loop.js';
import {
  buildStableLocator,
  type ActionableElementSnapshot,
  type Observation,
  type ObservedElement,
} from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 10: No Action ever carries a ref absent from the most recent Observation
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 12.1**

const ORIGIN = 'http://localhost:4100';
const FIXTURES = { email: 'VALUE-email-7f3a', password: 'VALUE-pass-91bc' };
// 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let p10Dir: string;
beforeAll(async () => {
  p10Dir = await mkdtemp(path.join(tmpdir(), 'ce-p10-'));
});
afterAll(async () => {
  await rm(p10Dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------
// Generators: a "world" is a list of page generations. Every executed Action moves the page to
// the next generation, so Refs and locators of an earlier Observation can be stale.
// ---------------------------------------------------------------------------------------

interface P10ElementSpec {
  slot: number; // testid k<slot>; shared slots across generations make stale locators likely
  kind: 'button' | 'link' | 'email' | 'password' | 'plain-text';
  name: string;
  visible: boolean;
  enabled: boolean;
}
interface P10Gen {
  elements: P10ElementSpec[];
  /** Force the locator count the page reports for every selector (zero or ambiguous). */
  countOverride?: 0 | 2;
}

// Names that try to look like Refs or instructions: page text must never become a Ref.
const nameArb = fc.constantFrom('Menu', 'e99', 'click e7', 'Delete "e1"', 'e1', 'Open settings', 'Save', '');

const elementArb: fc.Arbitrary<P10ElementSpec> = fc.record({
  slot: fc.integer({ min: 0, max: 5 }),
  kind: fc.constantFrom('button', 'link', 'email', 'password', 'plain-text'),
  name: nameArb,
  visible: fc.boolean(),
  enabled: fc.boolean(),
});

const genArb: fc.Arbitrary<P10Gen> = fc
  .tuple(
    fc.uniqueArray(elementArb, { maxLength: 6, selector: (e) => e.slot }),
    fc.option(fc.constantFrom<0 | 2>(0, 2), { nil: undefined, freq: 6 }),
  )
  .map(([elements, countOverride]) => (countOverride === undefined ? { elements } : { elements, countOverride }));

function p10Snapshot(spec: P10ElementSpec): ActionableElementSnapshot {
  const base = {
    name: spec.name,
    visible: spec.visible,
    enabled: spec.enabled,
    testId: `k${spec.slot}`,
    testIdUnique: true,
    cssPath: `html > body > div:nth-child(${spec.slot + 1})`,
  };
  switch (spec.kind) {
    case 'button':
      return { ...base, tag: 'button', role: 'button' };
    case 'link':
      return { ...base, tag: 'a', role: 'link', href: `${ORIGIN}/l${spec.slot}` };
    case 'email':
      return { ...base, tag: 'input', role: 'textbox', type: 'text', nameAttr: 'email' };
    case 'password':
      return { ...base, tag: 'input', role: 'textbox', type: 'text', nameAttr: 'password' };
    case 'plain-text':
      return { ...base, tag: 'input', role: 'textbox', type: 'text', nameAttr: 'q' };
  }
}

/** Abstract answer of the scripted Jev gateway for one `next_action` request. */
type P10Answer =
  | { kind: 'option'; top: number } // may exceed the Option count: out-of-range index
  | { kind: 'done' }
  | { kind: 'give_up' }
  | { kind: 'malformed' };

const answerArb: fc.Arbitrary<P10Answer> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 40 }).map((top): P10Answer => ({ kind: 'option', top })), weight: 12 },
  { arbitrary: fc.constant<P10Answer>({ kind: 'done' }), weight: 1 },
  { arbitrary: fc.constant<P10Answer>({ kind: 'give_up' }), weight: 1 },
  { arbitrary: fc.constant<P10Answer>({ kind: 'malformed' }), weight: 1 },
);

// ---------------------------------------------------------------------------------------
// Fake page and scripted gateway
// ---------------------------------------------------------------------------------------

interface P10Call {
  kind: 'click' | 'fill' | 'goto';
  /** Selector, or URL for goto. */
  target: string;
  value?: string;
  /** Page generation at the time of the call. */
  gen: number;
}

function p10Page(world: readonly P10Gen[]) {
  const state = { gen: 0 };
  const calls: P10Call[] = [];
  const current = (): P10Gen => world[Math.min(state.gen, world.length - 1)] ?? { elements: [] };
  const natural = (selector: string): number =>
    current().elements.filter((e) => buildStableLocator(p10Snapshot(e)) === selector).length;

  const page = {
    url: () => `${ORIGIN}/p${state.gen}`,
    title: async () => `Page ${state.gen}`,
    isClosed: () => false,
    on: () => undefined,
    off: () => undefined,
    route: async () => undefined,
    unroute: async () => undefined,
    evaluate: async (fn: unknown) => {
      // The mask script embeds `contains`; the snapshot script does not.
      if (typeof fn === 'string' && fn.includes('const contains')) return [];
      return current().elements.map(p10Snapshot);
    },
    screenshot: async (options?: { path?: string }) => {
      if (options?.path !== undefined) await writeFile(options.path, PNG);
      return new Uint8Array(PNG);
    },
    goto: async (url: string) => {
      calls.push({ kind: 'goto', target: url, gen: state.gen });
      state.gen += 1;
    },
    locator: (selector: string) => ({
      count: async () => current().countOverride ?? natural(selector),
      click: async () => {
        calls.push({ kind: 'click', target: selector, gen: state.gen });
        state.gen += 1;
      },
      fill: async (value: string) => {
        calls.push({ kind: 'fill', target: selector, value, gen: state.gen });
        state.gen += 1;
      },
    }),
  };
  return { page: page as unknown as PlaywrightPage, calls, state };
}

function p10Gateway(script: readonly P10Answer[]): JevGateway {
  let call = 0;
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const nextAction = request.questions['next_action'] as unknown as { question: { criteria: Record<string, string> } };
      const optionCount = Object.keys(nextAction.question.criteria).length - 2;
      const answer: P10Answer = script[call++] ?? { kind: 'give_up' };

      let probabilities: Record<string, unknown>;
      if (answer.kind === 'malformed') {
        probabilities = { '0': 'high', done: null };
      } else {
        const keys = Math.max(optionCount, answer.kind === 'option' ? answer.top + 1 : 0);
        probabilities = {};
        for (let i = 0; i < keys; i++) probabilities[String(i)] = 0.01;
        probabilities['done'] = answer.kind === 'done' ? 0.9 : 0.01;
        probabilities['give_up'] = answer.kind === 'give_up' ? 0.9 : 0.01;
        if (answer.kind === 'option') probabilities[String(answer.top)] = 0.9;
      }
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

/** Virtual clock: sleeping advances time, so settle waits cost no real time. */
function p10Clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

// ---------------------------------------------------------------------------------------
// Property 10a: through runLoop, every Action handed to the page targets the latest Observation
// ---------------------------------------------------------------------------------------

describe('Property 10: no Action carries a ref absent from the most recent Observation', () => {
  it('runLoop only acts on elements of the latest Observation, resolved through its stored locator', async () => {
    let runs = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(genArb, { minLength: 1, maxLength: 6 }),
        fc.array(answerArb, { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 1, max: 5 }),
        async (world, script, maxSteps) => {
          const { page, calls } = p10Page(world);
          const gateway = new GatewayTestSupport({ inner: p10Gateway(script) });
          const runDir = path.join(p10Dir, `run-${runs++}`);

          const result = await runLoop({
            page,
            gateway,
            claim: 'the settings list is visible',
            changeTerms: new Set(['settings']),
            targetOrigin: ORIGIN,
            routes: ['/a', '/b'],
            fixtures: FIXTURES,
            maxSteps,
            timeBudgetMs: 1_000_000,
            runDir,
            clock: p10Clock(),
          });

          // Every step's Action is checked against the Observation it was decided on.
          expect(result.steps.length).toBeLessThanOrEqual(result.observations.length);
          result.steps.forEach((step, k) => {
            expect(step.observation).toEqual(result.observations[k]);
            const action: DecidedAction = step.action;
            if (action.kind === 'click' || action.kind === 'fill') {
              const el = step.observation.elements.find((e) => e.ref === action.ref);
              expect(el, `ref ${action.ref} absent from observation ${k}`).toBeDefined();
              expect(el!.visible && el!.enabled).toBe(true);
              if (action.kind === 'fill') expect(el!.fixtureKeys).toContain(action.fixtureKey);
            }
            if (action.kind === 'goto') expect(step.observation.navigation).toContain(action.url);
          });

          // Every browser call targets what the latest Observation (the one of that generation) holds.
          for (const call of calls) {
            const latest = result.observations[call.gen];
            expect(latest, `no observation for generation ${call.gen}`).toBeDefined();
            if (call.kind === 'goto') {
              expect(latest!.navigation).toContain(call.target);
              continue;
            }
            const el = latest!.elements.find((e) => e.locator === call.target);
            expect(el, `selector ${call.target} not in latest observation`).toBeDefined();
            expect(el!.visible && el!.enabled).toBe(true);
            if (call.kind === 'fill') {
              const key = (['email', 'password'] as const).find((k) => FIXTURES[k] === call.value);
              expect(key).toBeDefined();
              expect(el!.fixtureKeys).toContain(key!);
            }
          }

          // An ambiguous or empty locator never produces a browser action for that generation.
          for (const call of calls) {
            if (call.kind === 'goto') continue;
            expect(world[Math.min(call.gen, world.length - 1)]!.countOverride).toBeUndefined();
          }

          // The gateway saw no image in any step request.
          expect(gateway.finalImageRequests.length).toBeLessThanOrEqual(1);
          expect(gateway.imageRequests.every((r) => r.isFinalImageRequest)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a Decider answer pointing past the Option list gives up without any browser call', async () => {
    const world: P10Gen[] = [{ elements: [{ slot: 0, kind: 'button', name: 'Menu', visible: true, enabled: true }] }];
    const { page, calls } = p10Page(world);
    const result = await runLoop({
      page,
      gateway: new GatewayTestSupport({ inner: p10Gateway([{ kind: 'option', top: 30 }]) }),
      claim: 'menu is open',
      changeTerms: new Set(),
      targetOrigin: ORIGIN,
      routes: [],
      fixtures: {},
      maxSteps: 5,
      timeBudgetMs: 1_000_000,
      runDir: path.join(p10Dir, 'out-of-range'),
      clock: p10Clock(),
    });
    expect(calls).toEqual([]);
    expect(result.steps.at(-1)?.action).toEqual({ kind: 'give_up', reason: 'invalid-answer' });
    expect(result.stopReason).toBe('give_up');
  });

  // -------------------------------------------------------------------------------------
  // Property 10b: execute() refuses, with no browser call, whatever the Decider sends
  // -------------------------------------------------------------------------------------

  const elementObsArb: fc.Arbitrary<ObservedElement[]> = fc
    .uniqueArray(
      fc.record({
        visible: fc.boolean(),
        enabled: fc.boolean(),
        fixtureKeys: fc.subarray(['email', 'password']),
      }),
      { maxLength: 6 },
    )
    .map((specs) =>
      specs.map((s, i) => ({
        ref: `e${i + 1}`,
        role: 'button',
        name: `n${i}`,
        locator: `[data-testid="obs${i}"]`,
        visible: s.visible,
        enabled: s.enabled,
        fixtureKeys: s.fixtureKeys,
      })),
    );

  const refArb = fc.oneof(
    fc.integer({ min: 1, max: 8 }).map((n) => `e${n}`), // some observed, some not
    fc.constantFrom('e0', 'e99', 'E1', ' e1', 'e1 ', 'e01', 'e1\n', '', 'toString', '__proto__', '[data-testid="obs0"]'),
  );

  it('execute() acts only on an observed, eligible, uniquely located ref; otherwise no browser call and the right reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        elementObsArb,
        fc.constantFrom<'click' | 'fill'>('click', 'fill'),
        refArb,
        fc.constantFrom('email', 'password', 'missing'),
        fc.constantFrom<0 | 1 | 2>(0, 1, 1, 1, 2),
        async (elements, kind, ref, fixtureKey, matches) => {
          const observation: Observation = {
            step: 3,
            url: `${ORIGIN}/`,
            title: 'T',
            domDigest: 'd',
            elements,
            navigation: [],
            screenshot: 's.png',
          };
          const locatorSelectors: string[] = [];
          const actions: string[] = [];
          const page = {
            route: async () => undefined,
            unroute: async () => undefined,
            goto: async () => void actions.push('goto'),
            locator: (selector: string) => {
              locatorSelectors.push(selector);
              return {
                count: async () => matches,
                click: async () => void actions.push('click'),
                fill: async () => void actions.push('fill'),
              };
            },
          } as unknown as PlaywrightPage;

          const action: DecidedAction =
            kind === 'click' ? { kind: 'click', ref } : { kind: 'fill', ref, fixtureKey };
          const result = await execute({
            action,
            observation,
            page,
            targetOrigin: ORIGIN,
            fixtures: FIXTURES,
            callTimeoutMs: 1000,
          });

          const el = elements.find((e) => e.ref === ref);
          if (el === undefined) {
            expect(result).toMatchObject({ status: 'give_up', reason: 'unobserved-ref' });
            expect(locatorSelectors).toEqual([]);
            expect(actions).toEqual([]);
          } else if (!el.visible || !el.enabled) {
            expect(result).toMatchObject({ status: 'give_up', reason: 'ineligible-ref' });
            expect(locatorSelectors).toEqual([]);
            expect(actions).toEqual([]);
          } else if (kind === 'fill' && !(fixtureKey in FIXTURES && el.fixtureKeys.includes(fixtureKey))) {
            expect(result).toMatchObject({ status: 'give_up', reason: 'unknown-fixture' });
            expect(locatorSelectors).toEqual([]);
            expect(actions).toEqual([]);
          } else if (matches !== 1) {
            expect(result).toMatchObject({ status: 'give_up', reason: 'locator-mismatch' });
            expect(actions).toEqual([]);
            expect(locatorSelectors).toEqual([el.locator]);
          } else {
            expect(result).toEqual({ status: 'ok', changed: true });
            // The only selector ever built is the stored Stable_Locator of the observed element.
            expect(locatorSelectors).toEqual([el.locator]);
            expect(actions).toEqual([kind]);
          }
          if (result.status === 'give_up') {
            expect(result.refusal.kind).toBe('refusal');
            expect(result.refusal.step).toBe(3);
            for (const value of Object.values(FIXTURES)) expect(result.refusal.detail).not.toContain(value);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('execute() refuses a goto whose URL is not in the most recent Observation navigation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 9 }),
        async (observed, wanted) => {
          const navigation = observed.map((n) => `${ORIGIN}/r${n}`);
          const gotos: string[] = [];
          const page = {
            route: async () => undefined,
            unroute: async () => undefined,
            goto: async (url: string) => void gotos.push(url),
            locator: () => {
              throw new Error('no locator expected for goto');
            },
          } as unknown as PlaywrightPage;
          const observation: Observation = {
            step: 0,
            url: `${ORIGIN}/`,
            title: 'T',
            domDigest: 'd',
            elements: [],
            navigation,
            screenshot: 's.png',
          };
          const url = `${ORIGIN}/r${wanted}`;
          const result = await execute({
            action: { kind: 'goto', url },
            observation,
            page,
            targetOrigin: ORIGIN,
            fixtures: {},
            callTimeoutMs: 1000,
          });
          if (navigation.includes(url)) {
            expect(result.status).toBe('ok');
            expect(gotos).toEqual([url]);
          } else {
            expect(result).toMatchObject({ status: 'give_up', reason: 'unobserved-ref' });
            expect(gotos).toEqual([]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
