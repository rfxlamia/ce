import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ChangeContext } from '../context/types.js';
import { describeAction, mapLoopResultToRuntimeResult } from './capability.js';
import type { DecidedAction } from './decide.js';
import type { LoopResult, StepLogEntry, StopReason } from './loop.js';
import { createRedactor, type Observation, type ObservedElement } from './observe.js';

// Feature: evidence-bundle, Property 21: The capability's trace mirrors its LoopResult field-for-field
// **Validates: Requirements 10.2, 10.4**

const word = fc.stringMatching(/^[a-z]{1,8}$/);
const fixtureValue = fc.stringMatching(/^FX[A-Z0-9]{4,8}$/);

const stopReasonArb: fc.Arbitrary<StopReason> = fc.constantFrom(
  'done',
  'reached',
  'give_up',
  'max-steps',
  'time-budget',
  'aborted',
);

const elementArb = (index: number, fixtures: readonly string[]): fc.Arbitrary<ObservedElement> =>
  fc
    .record({
      role: fc.constantFrom('button', 'link', 'textbox'),
      base: word,
      withFixture: fc.boolean(),
      fixture: fc.constantFrom(...fixtures),
    })
    .map(({ role, base, withFixture, fixture }) => ({
      ref: `e${index + 1}`,
      role,
      name: withFixture ? `${base} ${fixture}` : base,
      locator: `css=#e${index + 1}`,
      visible: true,
      enabled: true,
      fixtureKeys: [],
    }));

const observationArb = (step: number, fixtures: readonly string[]): fc.Arbitrary<Observation> =>
  fc
    .tuple(fc.integer({ min: 0, max: 3 }), word, word)
    .chain(([count, title, shot]) =>
      fc.tuple(...Array.from({ length: count }, (_, i) => elementArb(i, fixtures))).map(
        (elements): Observation => ({
          step,
          url: `http://localhost:4000/${shot}`,
          title,
          domDigest: `d${step}`,
          elements,
          navigation: [],
          screenshot: `screenshots/${shot}-${step}.png`,
        }),
      ),
    );

const actionArb = (obs: Observation, fixtures: readonly string[]): fc.Arbitrary<DecidedAction> => {
  const refs = obs.elements.map((e) => e.ref);
  const arbs: fc.Arbitrary<DecidedAction>[] = [
    fc.constant<DecidedAction>({ kind: 'done' }),
    fc.constant<DecidedAction>({ kind: 'give_up', reason: 'invalid-answer' }),
    fc
      .tuple(word, fc.constantFrom(...fixtures, ''))
      .map(([p, f]): DecidedAction => ({ kind: 'goto', url: `http://localhost:4000/${p}${f}` })),
    // A ref that was never observed: the description falls back to the ref itself.
    word.map((w): DecidedAction => ({ kind: 'click', ref: `x-${w}` })),
  ];
  if (refs.length > 0) {
    arbs.push(
      fc.constantFrom(...refs).map((ref): DecidedAction => ({ kind: 'click', ref })),
      fc.tuple(fc.constantFrom(...refs), word).map(([ref, fixtureKey]): DecidedAction => ({ kind: 'fill', ref, fixtureKey })),
    );
  }
  return fc.oneof(...arbs);
};

const probabilitiesArb = fc.dictionary(fc.constantFrom('0', '1', '2', 'done', 'give_up'), fc.double({ min: 0, max: 1, noNaN: true }));

const eventArb = fc.record({
  step: fc.nat({ max: 10 }),
  kind: fc.constantFrom('dialog', 'download', 'popup', 'settle', 'refusal' as const),
  detail: word,
});

const scenarioArb = fc.uniqueArray(fixtureValue, { minLength: 1, maxLength: 3 }).chain((fixtures) =>
  fc.integer({ min: 0, max: 5 }).chain((count) =>
    fc
      .tuple(...Array.from({ length: count }, (_, i) => observationArb(i, fixtures)))
      .chain((observations) =>
        fc
          .tuple(
            ...observations.map((o) =>
              fc.tuple(actionArb(o, fixtures), probabilitiesArb, fc.constantFrom<boolean | undefined>(true, false, undefined)),
            ),
          )
          .chain((perStep) =>
            fc.record({
              eventLog: fc.array(eventArb, { maxLength: 4 }),
              stopReason: stopReasonArb,
              modelIds: fc.array(word, { maxLength: 4 }),
              finalState: fc.constantFrom<'reached' | 'not_reached'>('reached', 'not_reached'),
              finalScreenshot: fc.option(word.map((w) => `screenshots/final-${w}.png`), { nil: undefined }),
              finalImageModel: fc.option(word, { nil: undefined }),
              finalImageError: fc.option(fc.constantFrom('timeout', 'bad_request', 'rate_limited', 'time-budget' as const), {
                nil: undefined,
              }),
            }).map((rest) => ({ fixtures, observations, perStep, ...rest })),
          ),
      ),
  ),
);

const change: ChangeContext['change'] = { files: [], commits: [], claims: [], provenance: [] };

describe('evidence-bundle Property 21: trace mirrors LoopResult', () => {
  it('copies every field of the LoopResult into the trace, redacting action descriptions', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const steps: StepLogEntry[] = s.observations.map((observation, i) => {
          const [action, probabilities, executed] = s.perStep[i]!;
          const entry: StepLogEntry = { observation, action, probabilities, alternatives: [] };
          if (executed !== undefined) entry.executed = executed;
          return entry;
        });
        const loopResult: LoopResult = {
          finalState: s.finalState,
          observations: s.observations,
          steps,
          eventLog: s.eventLog,
          finalSignals: {},
          stopReason: s.stopReason,
          modelIds: s.modelIds,
        };
        if (s.finalScreenshot !== undefined) loopResult.finalScreenshot = s.finalScreenshot;
        if (s.finalImageModel !== undefined) loopResult.finalImageModel = s.finalImageModel;
        if (s.finalImageError !== undefined) loopResult.finalImageError = s.finalImageError;

        const input = {
          loopResult,
          selectedClaim: { status: 'not_identified' as const, text: 'x' },
          change,
          baseUrl: 'http://localhost:4000',
          runDir: '/tmp/run',
          fixtureValues: s.fixtures,
        };
        const before = JSON.stringify(input);
        const trace = mapLoopResultToRuntimeResult(input).trace;
        const redact = createRedactor(s.fixtures);

        expect(trace).toBeDefined();
        const t = trace!;
        expect(JSON.stringify(input)).toBe(before); // input not mutated

        // Steps: one per LoopResult step, in order, nothing dropped (including not-executed ones).
        expect(t.steps).toEqual(
          steps.map((st) => ({
            step: st.observation.step,
            url: st.observation.url,
            title: st.observation.title,
            screenshot: st.observation.screenshot,
            action: { kind: st.action.kind, description: describeAction(st, redact) },
            executed: st.executed === true,
            probabilities: st.probabilities,
            alternatives: [],
          })),
        );
        expect(t.eventLog).toEqual(s.eventLog);
        expect(t.stopReason).toBe(s.stopReason);
        expect(t.modelIds).toEqual(s.modelIds);
        expect(t.finalSignals).toEqual({});
        expect('finalBox' in t).toBe(false);

        // Optional fields are present exactly when present in the LoopResult.
        expect('finalScreenshot' in t).toBe(s.finalScreenshot !== undefined);
        expect('finalImageModel' in t).toBe(s.finalImageModel !== undefined);
        expect('finalImageError' in t).toBe(s.finalImageError !== undefined);
        if (s.finalScreenshot !== undefined) expect(t.finalScreenshot).toBe(s.finalScreenshot);
        if (s.finalImageModel !== undefined) expect(t.finalImageModel).toBe(s.finalImageModel);
        if (s.finalImageError !== undefined) expect(t.finalImageError).toBe(s.finalImageError);

        // No fixture value in any action description; no payload fields leak into the trace.
        for (const step of t.steps) for (const value of s.fixtures) expect(step.action.description).not.toContain(value);
        expect(Object.keys(t).every((k) =>
          ['steps', 'eventLog', 'finalScreenshot', 'finalImageModel', 'finalImageError', 'finalBox', 'finalSignals', 'stopReason', 'modelIds'].includes(k),
        )).toBe(true);
        for (const step of t.steps) {
          expect(Object.keys(step).sort()).toEqual(
            ['action', 'alternatives', 'executed', 'probabilities', 'screenshot', 'step', 'title', 'url'],
          );
        }

        // Defensive copies: mutating the trace does not touch the LoopResult.
        t.modelIds.push('zzz');
        expect(loopResult.modelIds).toEqual(s.modelIds);
      }),
      { numRuns: 100 },
    );
  });
});
