import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import {
  arbFailingNonEmptySummary,
  arbResolveInput,
  arbRuntimeResult,
  arbSupportedSurfaces,
} from './arbitraries.js';
import { satisfiesMinimumEvidence } from './evidence.js';
import { resolveOutcome } from './resolve.js';
import { V0_SUPPORTED_SURFACES } from './types.js';
import type { ResolveInput, RuntimeResult } from './types.js';

const NUM_RUNS = 1000;

function effective(supported: readonly Surface[] | undefined): readonly Surface[] {
  return supported ?? V0_SUPPORTED_SURFACES;
}

/**
 * No error, required = true, a surface in the effective supported list, and a
 * runtime with at least one observation (evidence may pass or fail the check).
 */
const arbSupportedRequiredWithObservation: fc.Arbitrary<ResolveInput> = fc
  .tuple(arbSupportedSurfaces, arbRuntimeResult)
  .filter(
    ([supported, runtime]) =>
      effective(supported).length > 0 && runtime.evidence.observations.length > 0,
  )
  .chain(([supported, runtime]) =>
    fc.constantFrom(...effective(supported)).map((surface) => {
      const input: ResolveInput = {
        assessment: { required: true, surface },
        runtime: runtime as RuntimeResult,
      };
      if (supported !== undefined) input.supportedSurfaces = supported;
      return input;
    }),
  );

/**
 * No error, required = true, a surface in the effective supported list, and
 * either no runtime or a runtime whose observations are empty (the rest of the
 * evidence is arbitrary).
 */
const arbSupportedRequiredNoObservation: fc.Arbitrary<ResolveInput> = fc
  .tuple(
    arbSupportedSurfaces.filter((s) => effective(s).length > 0),
    fc.option(arbRuntimeResult, { nil: undefined }),
  )
  .chain(([supported, runtime]) =>
    fc.constantFrom(...effective(supported)).map((surface) => {
      const input: ResolveInput = { assessment: { required: true, surface } };
      if (runtime !== undefined) {
        input.runtime = {
          ...runtime,
          evidence: { ...runtime.evidence, observations: [] },
        };
      }
      if (supported !== undefined) input.supportedSurfaces = supported;
      return input;
    }),
  );

/**
 * No error, required = true, a surface in the effective supported list, and a
 * runtime with a non-empty Evidence_Summary that fails satisfiesMinimumEvidence.
 */
const arbSupportedRequiredIncompleteEvidence: fc.Arbitrary<ResolveInput> = fc
  .tuple(
    arbSupportedSurfaces.filter((s) => effective(s).length > 0),
    arbRuntimeResult,
    arbFailingNonEmptySummary,
  )
  .chain(([supported, runtime, evidence]) =>
    fc.constantFrom(...effective(supported)).map((surface) => {
      const input: ResolveInput = {
        assessment: { required: true, surface },
        runtime: { ...runtime, evidence },
      };
      if (supported !== undefined) input.supportedSurfaces = supported;
      return input;
    }),
  );

describe('outcome-resolver evidenced properties', () => {
  // Feature: outcome-resolver, Property 11: A non-empty but incomplete Evidence_Summary gives evidence-incomplete
  // **Validates: Requirements 5.5, 8.3**
  it('Property 11: non-empty observations failing the check return ERROR/evidence-incomplete', () => {
    fc.assert(
      fc.property(arbSupportedRequiredIncompleteEvidence, (input) => {
        expect(input.runtime!.evidence.observations.length).toBeGreaterThan(0);
        expect(satisfiesMinimumEvidence(input.runtime!.evidence)).toBe(false);
        const resolution = resolveOutcome(input);
        expect(resolution.outcome).toBe('ERROR');
        expect(resolution.reason).toBe('evidence-incomplete');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 10: Empty observations always give no-observation, even over an otherwise-incomplete summary
  // **Validates: Requirements 5.4, 8.3**
  it('Property 10: absent runtime or empty observations returns ERROR/no-observation', () => {
    fc.assert(
      fc.property(arbSupportedRequiredNoObservation, (input) => {
        const resolution = resolveOutcome(input);
        expect(resolution.outcome).toBe('ERROR');
        expect(resolution.reason).toBe('no-observation');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 9: EVIDENCED iff required, supported, and the evidence passes the check
  // **Validates: Requirements 5.1, 5.2, 8.1, 8.2**
  it('Property 9: returns EVIDENCED/evidence-collected iff satisfiesMinimumEvidence passes', () => {
    fc.assert(
      fc.property(arbSupportedRequiredWithObservation, (input) => {
        const runtime = input.runtime!;
        const passes = satisfiesMinimumEvidence(runtime.evidence);
        const resolution = resolveOutcome(input);

        expect(resolution.outcome === 'EVIDENCED').toBe(passes);
        if (passes) {
          expect(resolution.reason).toBe('evidence-collected');
          expect(resolution.finalState).toBe(runtime.finalState);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 9: EVIDENCED implies the evidence check passes
  // **Validates: Requirements 5.1, 5.2, 8.1, 8.2**
  it('Property 9: over arbResolveInput, EVIDENCED implies the evidence check passes', () => {
    fc.assert(
      fc.property(arbResolveInput, (input) => {
        const resolution = resolveOutcome(input);
        if (resolution.outcome !== 'EVIDENCED') return;
        expect(input.error).toBeUndefined();
        expect(input.assessment?.required).toBe(true);
        expect(effective(input.supportedSurfaces)).toContain(input.assessment!.surface);
        expect(input.runtime!.evidence.observations.length).toBeGreaterThan(0);
        expect(satisfiesMinimumEvidence(input.runtime!.evidence)).toBe(true);
        expect(resolution.reason).toBe('evidence-collected');
        expect(resolution.finalState).toBe(input.runtime!.finalState);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
