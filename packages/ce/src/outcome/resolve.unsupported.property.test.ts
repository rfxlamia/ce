import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import { arbResolveInput, arbRuntimeResult, arbSupportedSurfaces, arbSurface } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import { V0_SUPPORTED_SURFACES } from './types.js';
import type { ResolveInput } from './types.js';

const NUM_RUNS = 1000;

function effective(supported: readonly Surface[] | undefined): readonly Surface[] {
  return supported ?? V0_SUPPORTED_SURFACES;
}

/** No error, required = true, any surface, any supportedSurfaces, optional runtime. */
const arbRequiredInput: fc.Arbitrary<ResolveInput> = fc
  .tuple(arbSurface, arbSupportedSurfaces, fc.option(arbRuntimeResult, { nil: undefined }))
  .map(([surface, supportedSurfaces, runtime]) => {
    const input: ResolveInput = { assessment: { required: true, surface } };
    if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;
    if (runtime !== undefined) input.runtime = runtime;
    return input;
  });

describe('outcome-resolver Property 6: UNSUPPORTED iff required and surface outside the effective catalog', () => {
  // Feature: outcome-resolver, Property 6: UNSUPPORTED iff required and the surface is outside the effective catalog
  // **Validates: Requirements 1.9, 4.1, 4.3, 4.5, 4.7, 6.5**
  it('returns UNSUPPORTED/surface-unsupported iff the Dominant_Surface is not in the effective list', () => {
    fc.assert(
      fc.property(arbRequiredInput, (input) => {
        const surface = input.assessment!.surface;
        const outside = !effective(input.supportedSurfaces).includes(surface);
        const resolution = resolveOutcome(input);

        expect(resolution.outcome === 'UNSUPPORTED').toBe(outside);
        expect(resolution.reason === 'surface-unsupported').toBe(outside);
        if (outside) {
          expect(resolution.surface).toBe(surface);
          expect(resolution.finalState).toBeUndefined();
          expect('finalState' in resolution).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: outcome-resolver, Property 6: UNSUPPORTED implies required and surface outside the effective list
  // **Validates: Requirements 1.9, 4.1, 4.3, 4.5, 4.7, 6.5**
  it('over arbResolveInput, UNSUPPORTED implies required=true and surface outside the effective list', () => {
    fc.assert(
      fc.property(arbResolveInput, (input) => {
        const resolution = resolveOutcome(input);
        if (resolution.outcome !== 'UNSUPPORTED') return;
        expect(input.error).toBeUndefined();
        expect(input.assessment?.required).toBe(true);
        expect(effective(input.supportedSurfaces)).not.toContain(input.assessment!.surface);
        expect(resolution.reason).toBe('surface-unsupported');
        expect(resolution.surface).toBe(input.assessment!.surface);
        expect(resolution.finalState).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
