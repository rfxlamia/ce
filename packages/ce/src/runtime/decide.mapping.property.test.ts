import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mapAnswerToAction, type Option } from './decide.js';

// Feature: observe-decide-execute-loop, Property 7: Answer-to-Action mapping is total, correctly typed and safe on invalid keys

const optionArb: fc.Arbitrary<Option> = fc.oneof(
  fc.record({
    kind: fc.constant('element' as const),
    description: fc.string(),
    ref: fc.stringMatching(/^e[0-9]{1,3}$/),
    proximityScore: fc.nat(5),
  }),
  fc.record({
    kind: fc.constant('fill' as const),
    description: fc.string(),
    ref: fc.stringMatching(/^e[0-9]{1,3}$/),
    fixtureKey: fc.stringMatching(/^[a-z]{1,8}$/),
    proximityScore: fc.nat(5),
  }),
  fc.record({
    kind: fc.constant('navigation' as const),
    description: fc.string(),
    url: fc.stringMatching(/^[a-z]{1,8}$/).map((p) => `http://localhost:3000/${p}`),
    proximityScore: fc.nat(5),
  }),
);

const optionsArb = fc.array(optionArb, { maxLength: 12 });

/** Keys that are neither an Option index in range, `done`, nor `give_up`. */
function invalidKeyArb(count: number): fc.Arbitrary<string> {
  return fc.oneof(
    fc.nat(50).map((n) => String(count + n)),
    fc.nat(50).map((n) => `-${n + 1}`),
    fc.nat(9).map((n) => `0${n}`),
    fc.constantFrom('1.5', 'abc', '', ' ', 'Done', 'GIVE_UP', 'NaN', '1e1'),
    fc.string().filter((s) => s !== 'done' && s !== 'give_up' && !/^(0|[1-9][0-9]*)$/.test(s)),
  );
}

describe('Property 7: Answer-to-Action mapping is total, correctly typed and safe on invalid keys', () => {
  /**
   * **Validates: Requirements 3.4, 3.5, 3.6, 12.3**
   */
  it('a valid index maps to the Action type of that Option', () => {
    fc.assert(
      fc.property(
        optionsArb.filter((o) => o.length > 0),
        fc.nat(),
        (options, seed) => {
          const index = seed % options.length;
          const option = options[index]!;
          const action = mapAnswerToAction({ options, probabilities: { [String(index)]: 1 } });
          if (option.kind === 'fill') {
            expect(action).toEqual({ kind: 'fill', ref: option.ref, fixtureKey: option.fixtureKey });
          } else if (option.kind === 'navigation') {
            expect(action).toEqual({ kind: 'goto', url: option.url });
          } else {
            expect(action).toEqual({ kind: 'click', ref: option.ref });
          }
        },
      ),
    );
  });

  /**
   * **Validates: Requirements 3.4, 3.5, 3.6, 12.3**
   */
  it('done and give_up map to their own kind, for any option list', () => {
    fc.assert(
      fc.property(optionsArb, (options) => {
        expect(mapAnswerToAction({ options, probabilities: { done: 1 } })).toEqual({ kind: 'done' });
        expect(mapAnswerToAction({ options, probabilities: { give_up: 1 } })).toEqual({
          kind: 'give_up',
          reason: 'invalid-answer',
        });
      }),
    );
  });

  /**
   * **Validates: Requirements 3.4, 3.5, 3.6, 12.3**
   */
  it('any winning key outside the Option indices, done and give_up maps to give_up invalid-answer', () => {
    fc.assert(
      fc.property(
        optionsArb.chain((options) => fc.tuple(fc.constant(options), invalidKeyArb(options.length))),
        ([options, key]) => {
          const action = mapAnswerToAction({ options, probabilities: { [key]: 0.9 } });
          expect(action).toEqual({ kind: 'give_up', reason: 'invalid-answer' });
        },
      ),
    );
  });

  /**
   * **Validates: Requirements 3.4, 3.5, 3.6, 12.3**
   */
  it('is total: always returns exactly one known Action for arbitrary probability maps', () => {
    fc.assert(
      fc.property(
        optionsArb,
        fc.dictionary(fc.oneof(fc.nat(15).map(String), fc.constantFrom('done', 'give_up'), fc.string()), fc.double({ noNaN: false })),
        (options, probabilities) => {
          const action = mapAnswerToAction({ options, probabilities });
          expect(['click', 'fill', 'goto', 'done', 'give_up']).toContain(action.kind);
          if (action.kind === 'give_up') expect(action.reason).toBe('invalid-answer');
        },
      ),
    );
  });
});
