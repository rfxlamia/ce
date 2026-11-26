import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import { arbResolveInput } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import { V0_SUPPORTED_SURFACES, type Outcome } from './types.js';

const NUM_RUNS = 1000;

function effective(supported: readonly Surface[] | undefined): readonly Surface[] {
  return supported ?? V0_SUPPORTED_SURFACES;
}

describe('outcome-resolver presence and converse properties', () => {
  // Feature: outcome-resolver, Property 12: finalState and errorStage presence are exact iff-conditions
  // **Validates: Requirements 2.4, 3.2, 5.3, 6.9**
  it('finalState present iff outcome is EVIDENCED, errorStage present iff reason is stage-error', () => {
    fc.assert(
      fc.property(arbResolveInput, (input) => {
        const r = resolveOutcome(input);
        const outcome: Outcome = r.outcome;
        const reason: string = r.reason;
        expect(r.finalState !== undefined).toBe(outcome === 'EVIDENCED');
        expect(r.errorStage !== undefined).toBe(reason === 'stage-error');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 13: SKIPPED and UNSUPPORTED are exact converses and never overlap
  // **Validates: Requirements 6.4, 6.5, 6.6**
  it('without an error and with an assessment, SKIPPED iff required=false and UNSUPPORTED iff required and surface unsupported', () => {
    fc.assert(
      fc.property(
        arbResolveInput.filter((i) => i.error === undefined && i.assessment !== undefined),
        (input) => {
          const { required, surface } = input.assessment!;
          const outside = !effective(input.supportedSurfaces).includes(surface);
          const outcome: Outcome = resolveOutcome(input).outcome;
          const isSkipped: boolean = outcome === 'SKIPPED';
          const isUnsupported: boolean = outcome === 'UNSUPPORTED';

          expect(isSkipped).toBe(required === false);
          expect(isUnsupported).toBe(required === true && outside);
          expect(isSkipped && isUnsupported).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 13: SKIPPED implies an assessment is present and not required
  // **Validates: Requirements 6.4, 6.5, 6.6**
  it('over arbResolveInput, SKIPPED implies assessment present and required=false', () => {
    fc.assert(
      fc.property(arbResolveInput, (input) => {
        if (resolveOutcome(input).outcome !== 'SKIPPED') return;
        expect(input.assessment).toBeDefined();
        expect(input.assessment?.required).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
