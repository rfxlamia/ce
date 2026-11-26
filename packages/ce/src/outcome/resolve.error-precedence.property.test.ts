import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import {
  ALL_STAGES,
  arbAssessment,
  arbRuntimeResult,
  arbSupportedSurfaces,
} from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import type { ResolveInput } from './types.js';

const SECRET_MESSAGE = 'SECRET-cause-message-9f3a7c1e-do-not-leak';

describe('outcome-resolver property tests', () => {
  // Feature: outcome-resolver, Property 3: A Stage_Error always wins (ERROR precedence)
  // **Validates: Requirements 2.1, 2.3, 2.5**
  it('Property 3: a Stage_Error always resolves to ERROR / stage-error without leaking the cause message', () => {
    const arbError = fc
      .constantFrom(...ALL_STAGES)
      .map((stage) => new StageError(stage, new Error(SECRET_MESSAGE)));

    fc.assert(
      fc.property(
        arbError,
        fc.option(arbAssessment, { nil: undefined }),
        fc.option(arbRuntimeResult, { nil: undefined }),
        arbSupportedSurfaces,
        (error, assessment, runtime, supportedSurfaces) => {
          const input: ResolveInput = { error };
          if (assessment !== undefined) input.assessment = assessment;
          if (runtime !== undefined) input.runtime = runtime;
          if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;

          const resolution = resolveOutcome(input);

          expect(resolution.outcome).toBe('ERROR');
          expect(resolution.reason).toBe('stage-error');
          expect(resolution.errorStage).toBe(error.stage);
          expect(JSON.stringify(resolution)).not.toContain(SECRET_MESSAGE);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: outcome-resolver, Property 4: Missing assessment resolves to ERROR
  // **Validates: Requirements 2.2**
  it('Property 4: no error and no assessment resolves to ERROR / assessment-missing', () => {
    fc.assert(
      fc.property(
        fc.option(arbRuntimeResult, { nil: undefined }),
        arbSupportedSurfaces,
        (runtime, supportedSurfaces) => {
          const input: ResolveInput = {};
          if (runtime !== undefined) input.runtime = runtime;
          if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;

          const resolution = resolveOutcome(input);

          expect(resolution.outcome).toBe('ERROR');
          expect(resolution.reason).toBe('assessment-missing');
          expect(resolution.errorStage).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('outcome-resolver property tests (stage-error toggle)', () => {
  // Feature: outcome-resolver, Property 14: Adding or removing the Stage_Error is the only thing that toggles stage-error
  // **Validates: Requirements 6.7**
  it('Property 14: attaching an error gives ERROR / stage-error, removing it does not', () => {
    const arbError = fc
      .constantFrom(...ALL_STAGES)
      .map((stage) => new StageError(stage, new Error('cause')));

    fc.assert(
      fc.property(
        arbAssessment,
        fc.option(arbRuntimeResult, { nil: undefined }),
        arbSupportedSurfaces,
        arbError,
        (assessment, runtime, supportedSurfaces, error) => {
          const base: ResolveInput = { assessment };
          if (runtime !== undefined) base.runtime = runtime;
          if (supportedSurfaces !== undefined) base.supportedSurfaces = supportedSurfaces;

          const withError = resolveOutcome({ ...base, error });
          const withoutError = resolveOutcome(base);

          expect(withError.outcome).toBe('ERROR');
          expect(withError.reason).toBe('stage-error');
          expect(withoutError.reason).not.toBe('stage-error');
        },
      ),
      { numRuns: 200 },
    );
  });
});
