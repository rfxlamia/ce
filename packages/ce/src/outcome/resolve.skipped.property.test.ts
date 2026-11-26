import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbRuntimeResult, arbSupportedSurfaces, arbSurface } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import type { ResolveInput } from './types.js';

// Not-required inputs: no error, required=false, any surface, any
// supportedSurfaces, runtime present or absent.
const arbNotRequiredInput = fc
  .tuple(
    arbSurface,
    fc.option(arbRuntimeResult, { nil: undefined }),
    arbSupportedSurfaces,
  )
  .map(([surface, runtime, supportedSurfaces]) => {
    const input: ResolveInput = { assessment: { required: false, surface } };
    if (runtime !== undefined) input.runtime = runtime;
    if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;
    return input;
  });

describe('outcome-resolver: Property 5', () => {
  // Feature: outcome-resolver, Property 5: SKIPPED when not required
  // **Validates: Requirements 3.1, 3.2**
  it('returns SKIPPED / not-required with the Dominant_Surface and no finalState', () => {
    fc.assert(
      fc.property(arbNotRequiredInput, (input) => {
        const result = resolveOutcome(input);
        expect(result.outcome).toBe('SKIPPED');
        expect(result.reason).toBe('not-required');
        expect(result.surface).toBe(input.assessment?.surface);
        expect(result.finalState).toBeUndefined();
        expect('finalState' in result).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
