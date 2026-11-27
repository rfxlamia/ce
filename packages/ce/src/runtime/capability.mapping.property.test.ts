import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Claim } from '../assessment/index.js';
import type { ChangeContext } from '../context/types.js';
import { satisfiesMinimumEvidence } from '../outcome/evidence.js';
import { mapLoopResultToRuntimeResult, type SelectedClaim } from './capability.js';
import type { DecidedAction } from './decide.js';
import type { LoopResult, StepLogEntry } from './loop.js';
import { createRedactor, type Observation, type ObservedElement } from './observe.js';

// Feature: observe-decide-execute-loop, Property 24: Loop_Result to RuntimeResult mapping is total and loses no required field
// **Validates: Requirements 13.8, 13.10**

const word = fc.stringMatching(/^[a-z]{1,8}$/);
const nonBlank = fc.stringMatching(/^[a-z0-9]{1,10}$/);
const fixtureValue = fc.stringMatching(/^FX[A-Z0-9]{4,8}$/);

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
    .tuple(fc.integer({ min: 1, max: 4 }), nonBlank)
    .chain(([count, shot]) =>
      fc.tuple(...Array.from({ length: count }, (_, i) => elementArb(i, fixtures))).map(
        (elements): Observation => ({
          step,
          url: 'http://localhost:4000/',
          title: 'T',
          domDigest: `d${step}`,
          elements,
          navigation: [],
          screenshot: `screenshots/${shot}-${step}.png`,
        }),
      ),
    );

const actionArb = (obs: Observation, fixtures: readonly string[]): fc.Arbitrary<DecidedAction> =>
  fc.oneof(
    fc.constantFrom(...obs.elements).map((e): DecidedAction => ({ kind: 'click', ref: e.ref })),
    fc
      .tuple(fc.constantFrom(...obs.elements), nonBlank)
      .map(([e, key]): DecidedAction => ({ kind: 'fill', ref: e.ref, fixtureKey: key })),
    fc
      .tuple(word, fc.constantFrom(...fixtures, ''))
      .map(([p, f]): DecidedAction => ({ kind: 'goto', url: `http://localhost:4000/${p}${f}` })),
    fc.constant<DecidedAction>({ kind: 'done' }),
    fc.constant<DecidedAction>({ kind: 'give_up', reason: 'invalid-answer' }),
  );

const claimArb: fc.Arbitrary<Claim> = fc.record({
  id: nonBlank,
  text: nonBlank,
  probability: fc.constant(0.9),
  declared: fc.boolean(),
  provenance: fc.constant({ provider: 'cli' as const }),
});

const selectedArb: fc.Arbitrary<SelectedClaim> = fc.oneof(
  claimArb.map((claim): SelectedClaim => ({ status: 'identified', claim, text: claim.text })),
  fc.constant<SelectedClaim>({ status: 'not_identified', text: 'subject text' }),
);

const changeArb: fc.Arbitrary<ChangeContext['change']> = fc
  .record({
    title: fc.option(nonBlank, { nil: undefined }),
    description: fc.option(nonBlank, { nil: undefined }),
    base: fc.option(nonBlank, { nil: undefined }),
    head: fc.option(nonBlank, { nil: undefined }),
    paths: fc.array(nonBlank, { minLength: 1, maxLength: 3 }),
  })
  .map(({ title, description, base, head, paths }) => {
    const change: ChangeContext['change'] = {
      files: paths.map((p) => ({
        path: p,
        status: 'modified' as const,
        patch: '',
        provenance: { provider: 'git' as const },
      })),
      commits: [],
      claims: [],
      provenance: [],
    };
    if (title !== undefined) change.title = title;
    if (description !== undefined) change.description = description;
    if (base !== undefined) change.base = base;
    if (head !== undefined) change.head = head;
    return change;
  });

const scenarioArb = fc
  .uniqueArray(fixtureValue, { minLength: 1, maxLength: 3 })
  .chain((fixtures) =>
    fc.integer({ min: 1, max: 5 }).chain((count) =>
      fc
        .tuple(...Array.from({ length: count }, (_, i) => observationArb(i, fixtures)))
        .chain((observations) =>
          fc
            .tuple(...observations.map((o) => actionArb(o, fixtures)))
            .map((actions) => ({ fixtures, observations, actions })),
        ),
    ),
  )
  .chain((base) =>
    fc
      .tuple(selectedArb, changeArb, nonBlank, nonBlank, fc.constantFrom('reached', 'not_reached' as const))
      .map(([selectedClaim, change, host, dir, finalState]) => ({
        ...base,
        selectedClaim,
        change,
        baseUrl: `http://${host}.test:4000`,
        runDir: `/tmp/${dir}`,
        finalState: finalState as 'reached' | 'not_reached',
      })),
  );

describe('observe-decide-execute-loop Property 24: Loop_Result to RuntimeResult mapping', () => {
  it('is a direct, non-fabricating, redacted function of the LoopResult and satisfies minimum evidence', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const steps: StepLogEntry[] = s.observations.map((observation, i) => ({
          observation,
          action: s.actions[i] as DecidedAction,
          probabilities: {},
        }));
        const loopResult: LoopResult = {
          finalState: s.finalState,
          observations: s.observations,
          steps,
          eventLog: [],
          finalSignals: {},
          stopReason: 'done',
        };
        const input = {
          loopResult,
          selectedClaim: s.selectedClaim,
          change: s.change,
          baseUrl: s.baseUrl,
          runDir: s.runDir,
          fixtureValues: s.fixtures,
        };
        const before = JSON.stringify(input);
        const result = mapLoopResultToRuntimeResult(input);
        const redact = createRedactor(s.fixtures);

        // Pure: input is not mutated, output is repeatable.
        expect(JSON.stringify(input)).toBe(before);
        expect(mapLoopResultToRuntimeResult(input)).toEqual(result);

        expect(result.finalState).toBe(s.finalState);
        const ev = result.evidence;
        expect(ev.subject.url).toBe(s.baseUrl);
        expect(ev.artifacts).toEqual({ runDir: s.runDir, reportPath: path.join(s.runDir, 'report.html') });
        expect(ev.observations).toEqual(s.observations.map((o) => ({ step: o.step, screenshot: o.screenshot })));
        expect(ev.change.files).toEqual(s.change.files.map((f) => f.path));

        if (s.selectedClaim.status === 'identified') {
          expect(ev.claim).toEqual({
            status: 'identified',
            id: s.selectedClaim.claim.id,
            text: s.selectedClaim.claim.text,
            provenance: s.selectedClaim.claim.provenance,
          });
        } else {
          expect(ev.claim).toEqual({ status: 'not_identified' });
        }

        // Every executed click/fill/goto appears once, in order, redacted; done/give_up never appear.
        const expected: { kind: string; description: string }[] = [];
        steps.forEach((step, i) => {
          const a = step.action;
          if (a.kind === 'goto') {
            expected.push({ kind: 'goto', description: redact(a.url) });
          } else if (a.kind === 'click' || a.kind === 'fill') {
            const el = s.observations[i]!.elements.find((e) => e.ref === a.ref)!;
            const target = `${el.role} "${el.name}"`;
            expected.push({
              kind: a.kind,
              description: redact(a.kind === 'fill' ? `${target} from fixture "${a.fixtureKey}"` : target),
            });
          }
        });
        expect(ev.actions).toEqual(expected);

        // No fixture value leaks into the mapped result.
        const serialized = JSON.stringify(result);
        for (const value of s.fixtures) expect(serialized).not.toContain(value);

        expect(satisfiesMinimumEvidence(ev)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('keeps an unobserved ref as the description instead of fabricating a role and name', () => {
    const observation: Observation = {
      step: 0,
      url: 'http://localhost:4000/',
      title: 'T',
      domDigest: 'd',
      elements: [],
      navigation: [],
      screenshot: 'screenshots/0.png',
    };
    const result = mapLoopResultToRuntimeResult({
      loopResult: {
        finalState: 'not_reached',
        observations: [observation],
        steps: [{ observation, action: { kind: 'click', ref: 'e9' }, probabilities: {} }],
        eventLog: [],
        finalSignals: {},
        stopReason: 'max-steps',
      },
      selectedClaim: { status: 'not_identified', text: 'x' },
      change: { title: 'x', files: [], commits: [], claims: [], provenance: [] },
      baseUrl: 'http://localhost:4000',
      runDir: '/tmp/run',
    });
    expect(result.evidence.actions).toEqual([{ kind: 'click', description: 'e9' }]);
  });
});
