import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbResolveInput } from './arbitraries.js';
import { exitCodeFor, type FailOnEntry } from './exit-code.js';
import { resolveOutcome } from './resolve.js';
import type { Resolution } from './types.js';

const arbResolution: fc.Arbitrary<Resolution> = arbResolveInput.map((input) =>
  resolveOutcome(input),
);

describe('outcome-resolver: exit-code properties', () => {
  // Feature: outcome-resolver, Property 19: Exit code with no failOn equals exit code with the default list
  // **Validates: Requirements 9.2**
  it('exitCodeFor(resolution, undefined) equals exitCodeFor(resolution, ["error"])', () => {
    fc.assert(
      fc.property(arbResolution, (resolution) => {
        expect(exitCodeFor(resolution, undefined)).toBe(exitCodeFor(resolution, ['error']));
      }),
      { numRuns: 200 },
    );
  });
});

const ALL_FAIL_ON: readonly FailOnEntry[] = ['error', 'unsupported', 'evidenced-not-reached'];

const arbFailOnSubset: fc.Arbitrary<FailOnEntry[]> = fc.subarray([...ALL_FAIL_ON]);

describe('outcome-resolver: exit-code table property', () => {
  // Feature: outcome-resolver, Property 20: Exit code matches the outcome/fail-on table exactly
  // **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.10**
  it('returns 1, 2, 3 or 0 exactly as the outcome/fail-on table says', () => {
    fc.assert(
      fc.property(arbResolution, arbFailOnSubset, (resolution, failOn) => {
        const outcome: string = resolution.outcome;
        const finalState: string | undefined = resolution.finalState;

        let expected: number = 0;
        if (outcome === 'ERROR' && failOn.includes('error')) {
          expected = 1;
        } else if (outcome === 'UNSUPPORTED' && failOn.includes('unsupported')) {
          expected = 2;
        } else if (
          outcome === 'EVIDENCED' &&
          finalState === 'not_reached' &&
          failOn.includes('evidenced-not-reached')
        ) {
          expected = 3;
        }

        expect(exitCodeFor(resolution, failOn)).toBe(expected);
        if (outcome === 'SKIPPED' || (outcome === 'EVIDENCED' && finalState === 'reached')) {
          expect(exitCodeFor(resolution, failOn)).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});

const arbFailOnWithRepeats: fc.Arbitrary<FailOnEntry[]> = fc.array(fc.constantFrom(...ALL_FAIL_ON), {
  maxLength: 10,
});

describe('outcome-resolver: exit-code order and duplicates property', () => {
  // Feature: outcome-resolver, Property 21: Exit code ignores order and duplicates
  // **Validates: Requirements 9.7, 9.8**
  it('shuffling or duplicating failOn entries does not change exitCodeFor', () => {
    fc.assert(
      fc.property(
        arbResolution,
        arbFailOnWithRepeats,
        fc.infiniteStream(fc.nat()),
        fc.nat({ max: 3 }),
        (resolution, failOn, randoms, extraCopies) => {
          const baseline = exitCodeFor(resolution, failOn);

          // Fisher-Yates shuffle driven by generated numbers.
          const shuffled = [...failOn];
          const it = randoms[Symbol.iterator]();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = (it.next().value as number) % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          expect(exitCodeFor(resolution, shuffled)).toBe(baseline);

          // Duplicate every entry extraCopies more times, then reverse.
          const duplicated = failOn.flatMap((e) => Array<FailOnEntry>(extraCopies + 1).fill(e));
          expect(exitCodeFor(resolution, duplicated)).toBe(baseline);
          expect(exitCodeFor(resolution, [...duplicated].reverse())).toBe(baseline);
        },
      ),
      { numRuns: 300 },
    );
  });
});
