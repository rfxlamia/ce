import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import { arbResolveInput, arbRuntimeResult } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import type { ResolveInput } from './types.js';

/** Extra Assessment fields the resolver must not read. */
const arbAssessmentExtras = fc.record({
  claimStatus: fc.string(),
  subjects: fc.array(fc.string(), { maxLength: 3 }),
  perClaim: fc.array(
    fc.record({
      runtimeObservable: fc.boolean(),
      checksAdequate: fc.boolean(),
      surfaceConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
      needed: fc.boolean(),
      uncertain: fc.boolean(),
    }),
    { maxLength: 4 },
  ),
  decidedBy: fc.constantFrom('classifier', 'policy', 'other'),
  record: fc.record({
    probabilities: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 4 }),
    note: fc.string(),
  }),
});

const arbErrorExtras = fc.record({
  message: fc.string(),
  cause: fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(new TypeError('x'))),
});

/** Same stage, different message and cause. */
function withDifferentError(
  error: StageError,
  extras: { message: string; cause: unknown },
): StageError {
  const changed = new StageError(error.stage, extras.cause);
  Object.defineProperty(changed, 'message', { value: extras.message });
  return changed;
}

function withExtras(input: ResolveInput, extras: object): ResolveInput {
  if (input.assessment === undefined) return { ...input };
  // Attach extra Assessment fields past the narrowed type.
  const assessment = { ...input.assessment, ...extras } as ResolveInput['assessment'];
  return { ...input, assessment };
}

describe('outcome-resolver: field independence', () => {
  // Feature: outcome-resolver, Property 7: Outcome ignores fields other than error.stage, assessment.required and assessment.surface
  // **Validates: Requirements 4.3, 6.8**
  it('Property 7: differing extra assessment and error fields give deeply equal Resolutions', () => {
    fc.assert(
      fc.property(
        arbResolveInput,
        arbAssessmentExtras,
        arbAssessmentExtras,
        arbErrorExtras,
        (base, extrasA, extrasB, errorExtras) => {
          const a = withExtras(base, extrasA);
          const b = withExtras(base, extrasB);
          if (base.error !== undefined) {
            a.error = base.error;
            b.error = withDifferentError(base.error, errorExtras);
          }
          expect(resolveOutcome(b)).toEqual(resolveOutcome(a));
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: outcome-resolver, Property 8: runtime is irrelevant once the Outcome is SKIPPED or UNSUPPORTED
  // **Validates: Requirements 4.4, 6.11**
  it('Property 8: replacing or removing runtime leaves a SKIPPED or UNSUPPORTED Resolution unchanged', () => {
    fc.assert(
      fc.property(
        arbResolveInput,
        arbRuntimeResult,
        fc.boolean(),
        (base, otherRuntime, remove) => {
          const resolution = resolveOutcome(base);
          fc.pre(resolution.outcome === 'SKIPPED' || resolution.outcome === 'UNSUPPORTED');
          const changed: ResolveInput = { ...base };
          if (remove) delete changed.runtime;
          else changed.runtime = otherRuntime;
          expect(resolveOutcome(changed)).toEqual(resolution);
        },
      ),
      { numRuns: 300 },
    );
  });
});
