import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arbResolveInput } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import { OUTCOMES, type Outcome, type ResolveInput } from './types.js';

// Feature: outcome-resolver, Property 1: Resolution is always exactly one Outcome
// **Validates: Requirements 1.2, 1.3, 6.2, 6.3**

describe('Feature: outcome-resolver, Property 1: Resolution is always exactly one Outcome', () => {
  it('returns without throwing, with an outcome in OUTCOMES and exactly one equality true', () => {
    const seen = new Set<Outcome>();

    fc.assert(
      fc.property(arbResolveInput, (input) => {
        const { outcome } = resolveOutcome(input);
        seen.add(outcome);

        expect(OUTCOMES as readonly string[]).toContain(outcome);

        const predicates = [
          outcome === 'SKIPPED',
          outcome === 'EVIDENCED',
          outcome === 'UNSUPPORTED',
          outcome === 'ERROR',
        ];
        expect(predicates.filter(Boolean)).toHaveLength(1);
      }),
      { numRuns: 1000 },
    );

    for (const o of OUTCOMES) {
      expect(seen.has(o), `outcome ${o} was never generated`).toBe(true);
    }
  });
});

// Feature: outcome-resolver, Property 2: Determinism and non-mutation
// **Validates: Requirements 1.4, 6.10**

/** Deep copy of a ResolveInput. StageError is an Error, so it is copied field by field. */
function snapshotInput(input: ResolveInput): unknown {
  const { error, ...rest } = input;
  return {
    rest: structuredClone(rest),
    hasError: 'error' in input,
    error:
      error === undefined
        ? error
        : {
            ref: error,
            name: error.name,
            message: error.message,
            stage: error.stage,
            cause: error.cause,
            callError: error.callError,
          },
  };
}

describe('Feature: outcome-resolver, Property 2: Determinism and non-mutation', () => {
  it('returns deeply equal Resolutions on repeated calls and leaves the input unchanged', () => {
    fc.assert(
      fc.property(arbResolveInput, (input) => {
        const before = snapshotInput(input);

        const first = resolveOutcome(input);
        expect(snapshotInput(input)).toEqual(before);

        const second = resolveOutcome(input);
        expect(snapshotInput(input)).toEqual(before);

        expect(second).toEqual(first);
      }),
      { numRuns: 500 },
    );
  });
});
