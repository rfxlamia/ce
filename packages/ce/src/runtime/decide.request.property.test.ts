import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isImageRequest } from '../jev/gateway.js';
import { buildDecisionRequest, type Option, type StepHistoryEntry } from './decide.js';
import type { Observation } from './observe.js';

// Feature: observe-decide-execute-loop, Property 6: Decision request is text-only and carries the two fixed questions
// **Validates: Requirements 3.1, 3.2, 3.10**

const ORIGIN = 'http://localhost:4000';

const textArb = fc.string({ maxLength: 40 });

const optionArb: fc.Arbitrary<Option> = fc.record({
  kind: fc.constantFrom<Option['kind']>('element', 'fill', 'navigation'),
  description: textArb,
  ref: fc.constant('e1'),
  proximityScore: fc.nat({ max: 5 }),
});

const historyArb: fc.Arbitrary<StepHistoryEntry[]> = fc.array(
  fc.record({
    step: fc.nat({ max: 20 }),
    kind: fc.constantFrom<StepHistoryEntry['kind']>('click', 'fill', 'goto', 'done', 'give_up'),
    description: textArb,
    result: fc.constantFrom<StepHistoryEntry['result']>('changed', 'unchanged', 'refused'),
  }),
  { maxLength: 5 },
);

const observationArb: fc.Arbitrary<Observation> = fc.record({
  step: fc.nat({ max: 20 }),
  url: fc.string({ maxLength: 30 }).map((p) => `${ORIGIN}/${p.replace(/[^A-Za-z0-9/_-]/g, '')}`),
  title: textArb,
  domDigest: fc.string({ maxLength: 10 }),
  elements: fc.constant([]),
  navigation: fc.constant([]),
  screenshot: fc.constant('step-0.png'),
});

describe('buildDecisionRequest properties', () => {
  it('is text-only and carries exactly next_action and state_reached_dom, for any options (including none)', () => {
    fc.assert(
      fc.property(
        textArb,
        observationArb,
        fc.array(optionArb, { maxLength: 30 }),
        historyArb,
        (claim, observation, options, history) => {
          const request = buildDecisionRequest({
            claim,
            observation,
            options,
            history,
            targetOrigin: ORIGIN,
            fixtureValues: [],
          });
          expect(request.stage).toBe('runtime');
          expect(Object.keys(request.questions).sort()).toEqual(['next_action', 'state_reached_dom']);
          expect(request.questions['next_action']!.id).toBe('runtime.next_action');
          expect(request.questions['state_reached_dom']!.id).toBe('runtime.state_reached_dom');
          expect(typeof request.state).toBe('string');
          expect(isImageRequest(request)).toBe(false);
          for (const question of Object.values(request.questions)) {
            expect(question.requiresImage).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('still produces a request for an empty Option list, keeping done and give_up answerable', () => {
    const request = buildDecisionRequest({
      claim: 'the menu opens',
      observation: {
        step: 0,
        url: `${ORIGIN}/`,
        title: 'Demo',
        domDigest: 'd',
        elements: [],
        navigation: [],
        screenshot: 'step-0.png',
      },
      options: [],
      history: [],
      targetOrigin: ORIGIN,
      fixtureValues: [],
    });
    const criteria = JSON.stringify(request.questions['next_action']!.question);
    expect(criteria).toContain('done');
    expect(criteria).toContain('give_up');
    expect(isImageRequest(request)).toBe(false);
  });
});
