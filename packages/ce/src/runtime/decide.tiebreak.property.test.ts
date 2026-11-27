import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mapAnswerToAction, type Option } from './decide.js';

// Feature: observe-decide-execute-loop, Property 8: Tie-break on equal top probability is deterministic

function makeOptions(kinds: readonly Option['kind'][]): Option[] {
  return kinds.map((kind, i) => {
    if (kind === 'fill') {
      return { kind, description: `o${i}`, ref: `e${i}`, fixtureKey: `key${i}`, proximityScore: 0 };
    }
    if (kind === 'navigation') {
      return { kind, description: `o${i}`, url: `http://localhost/p${i}`, proximityScore: 0 };
    }
    return { kind, description: `o${i}`, ref: `e${i}`, proximityScore: 0 };
  });
}

const kindsArb = fc.array(fc.constantFrom<Option['kind']>('element', 'fill', 'navigation'), {
  minLength: 1,
  maxLength: 12,
});

function expectedFor(options: readonly Option[], index: number) {
  const o = options[index]!;
  if (o.kind === 'fill') return { kind: 'fill', ref: o.ref, fixtureKey: o.fixtureKey };
  if (o.kind === 'navigation') return { kind: 'goto', url: o.url };
  return { kind: 'click', ref: o.ref };
}

describe('Property 8: Tie-break on equal top probability is deterministic', () => {
  /**
   * **Validates: Requirements 3.7, 12.3**
   */
  it('chooses the lowest Option index among tied top keys', () => {
    fc.assert(
      fc.property(
        kindsArb,
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.uniqueArray(fc.nat(), { minLength: 2, maxLength: 6 }),
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 0.09, noNaN: true }),
        (kinds, top, rawIdx, withGiveUp, withDone, low) => {
          const options = makeOptions(kinds);
          const tiedIdx = [...new Set(rawIdx.map((n) => n % options.length))];
          const probs: Record<string, number> = {};
          options.forEach((_, i) => {
            probs[String(i)] = low;
          });
          for (const i of tiedIdx) probs[String(i)] = top;
          if (withGiveUp) probs['give_up'] = top;
          if (withDone) probs['done'] = top;
          const action = mapAnswerToAction({ options, probabilities: probs });
          expect(action).toEqual(expectedFor(options, Math.min(...tiedIdx)));
        },
      ),
    );
  });

  /**
   * **Validates: Requirements 3.7, 12.3**
   */
  it('prefers give_up over done when no Option index is tied at the top', () => {
    fc.assert(
      fc.property(
        kindsArb,
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.09, noNaN: true }),
        (kinds, top, low) => {
          const options = makeOptions(kinds);
          const probs: Record<string, number> = { give_up: top, done: top };
          options.forEach((_, i) => {
            probs[String(i)] = low;
          });
          expect(mapAnswerToAction({ options, probabilities: probs })).toEqual({
            kind: 'give_up',
            reason: 'invalid-answer',
          });
          delete probs['give_up'];
          expect(mapAnswerToAction({ options, probabilities: probs })).toEqual({ kind: 'done' });
        },
      ),
    );
  });

  /**
   * **Validates: Requirements 3.7, 12.3**
   */
  it('is independent of the key insertion order of the probabilities', () => {
    fc.assert(
      fc.property(
        kindsArb,
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.uniqueArray(fc.nat(), { minLength: 2, maxLength: 6 }),
        fc.boolean(),
        (kinds, top, rawIdx, reverse) => {
          const options = makeOptions(kinds);
          const keys = [...new Set(rawIdx.map((n) => String(n % options.length)))].concat(['give_up', 'done']);
          const ordered = reverse ? [...keys].reverse() : keys;
          const probs: Record<string, number> = {};
          for (const k of ordered) probs[k] = top;
          const baseline: Record<string, number> = {};
          for (const k of keys) baseline[k] = top;
          expect(mapAnswerToAction({ options, probabilities: probs })).toEqual(
            mapAnswerToAction({ options, probabilities: baseline }),
          );
        },
      ),
    );
  });
});
