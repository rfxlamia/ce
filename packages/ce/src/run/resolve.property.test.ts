import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Assessment, Surface } from '../assessment/index.js';
import { arbRuntimeResult, arbStageError, arbSurface } from '../outcome/arbitraries.js';
import type { EffectiveConfig } from '../config/schema.js';
import { exitCodeFor, V0_SUPPORTED_SURFACES } from '../outcome/index.js';
import type { FailOnEntry, Resolution } from '../outcome/index.js';
import { finishRun } from './pipeline.js';
import type { FinishRunInput } from './pipeline.js';
import { createCapabilityRegistry, EMPTY_REGISTRY, supportedSurfaces } from './capabilities.js';
import { resolveAfterAssessment } from './resolve.js';
import type { CapabilityEntry } from './types.js';

const NUM_RUNS = 200;

/** Builds a full Assessment. Later properties in this file reuse and extend it through `overrides`. */
function makeAssessment(
  required: boolean,
  surface: Surface,
  claimStatus: Assessment['claimStatus'],
  decidedBy: Assessment['decidedBy'],
  overrides: Partial<Assessment> = {},
): Assessment {
  return {
    claimStatus,
    subjects: [],
    perClaim: [],
    required,
    decidedBy,
    surface,
    record: {
      questions: [],
      candidates: [],
      modelIds: [],
      settings: {
        claimThreshold: 0.5,
        observableThreshold: 0.5,
        adequateThreshold: 0.5,
        uncertaintyBand: 0.1,
        onUncertain: 'evidence',
      },
      cuts: [],
    },
    ...overrides,
  };
}

const arbClaimStatus: fc.Arbitrary<Assessment['claimStatus']> = fc.constantFrom('identified', 'not_identified');
const arbDecidedBy: fc.Arbitrary<Assessment['decidedBy']> = fc.constantFrom('classifier', 'policy');

const arbFullAssessment = (required: boolean): fc.Arbitrary<Assessment> =>
  fc
    .tuple(arbSurface, arbClaimStatus, arbDecidedBy)
    .map(([surface, claimStatus, decidedBy]) => makeAssessment(required, surface, claimStatus, decidedBy));

// Feature: run-vertical-slice, Property 1: Resolution without a runtime result
// **Validates: Requirements 3.1, 4.1, 4.2, 4.4, 13.14**
describe('Property 1: Resolution without a runtime result', () => {
  it('returns SKIPPED / not-required when required is false', () => {
    fc.assert(
      fc.property(arbFullAssessment(false), (assessment) => {
        const resolution = resolveAfterAssessment({ assessment, registry: EMPTY_REGISTRY });
        expect(resolution.outcome).toBe('SKIPPED');
        expect(resolution.reason).toBe('not-required');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns UNSUPPORTED / surface-unsupported with the Surface when required is true', () => {
    fc.assert(
      fc.property(arbFullAssessment(true), (assessment) => {
        const resolution = resolveAfterAssessment({ assessment, registry: EMPTY_REGISTRY });
        expect(resolution.outcome).toBe('UNSUPPORTED');
        expect(resolution.reason).toBe('surface-unsupported');
        expect(resolution.surface).toBe(assessment.surface);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never returns EVIDENCED for any Assessment on the empty registry', () => {
    fc.assert(
      fc.property(fc.boolean(), arbFullAssessment(true), (required, base) => {
        const assessment = makeAssessment(required, base.surface, base.claimStatus, base.decidedBy);
        const resolution = resolveAfterAssessment({ assessment, registry: EMPTY_REGISTRY });
        expect(resolution.outcome).not.toBe('EVIDENCED');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const noopRun: CapabilityEntry['run'] = async () => {
  throw new Error('not called');
};

/** Valid registries: unique names, Surfaces drawn from the v0 supported list. */
const arbRegistry = fc
  .array(fc.subarray([...V0_SUPPORTED_SURFACES] as Surface[]), { maxLength: 6 })
  .map((lists) => createCapabilityRegistry(lists.map((surfaces, i) => ({ name: `cap-${i}`, surfaces, run: noopRun }))));

// Feature: run-vertical-slice, Property 4: Supported surfaces are the union of registered surfaces
// **Validates: Requirements 4.2, 8.9**
describe('Property 4: Supported surfaces are the union of registered surfaces', () => {
  it('supportedSurfaces has exactly the registered Surfaces, without duplicates', () => {
    fc.assert(
      fc.property(arbRegistry, (registry) => {
        const result = supportedSurfaces(registry);
        const expected = new Set(registry.flatMap((e) => [...e.surfaces]));
        expect(new Set(result).size).toBe(result.length);
        expect(new Set(result)).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves a required Assessment to UNSUPPORTED iff its Surface is absent from the set', () => {
    fc.assert(
      fc.property(arbRegistry, arbFullAssessment(true), (registry, assessment) => {
        const absent = !supportedSurfaces(registry).includes(assessment.surface);
        const resolution = resolveAfterAssessment({ assessment, registry });
        expect(resolution.outcome === 'UNSUPPORTED').toBe(absent);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: run-vertical-slice, Property 5: Stage error precedence
// **Validates: Requirements 6.1, 6.2, 6.4, 8.6**
describe('Property 5: Stage error precedence', () => {
  it('returns ERROR / stage-error with the error stage for any Assessment and RuntimeResult', () => {
    fc.assert(
      fc.property(
        arbStageError,
        fc.option(fc.boolean().chain((required) => arbFullAssessment(required)), { nil: undefined }),
        fc.option(arbRuntimeResult, { nil: undefined }),
        arbRegistry,
        (error, assessment, runtime, registry) => {
          const resolution = resolveAfterAssessment({
            error,
            registry,
            ...(assessment !== undefined ? { assessment } : {}),
            ...(runtime !== undefined ? { runtime } : {}),
          });
          expect(resolution.outcome).toBe('ERROR');
          expect(resolution.reason).toBe('stage-error');
          expect(resolution.errorStage).toBe(error.stage);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: run-vertical-slice, Property 7: Exit code comes from exitCodeFor
// **Validates: Requirements 3.4, 4.5, 6.7, 9.2, 9.3, 9.6**
describe('Property 7: Exit code comes from exitCodeFor', () => {
  const arbFailOn: fc.Arbitrary<FailOnEntry[] | undefined> = fc.option(
    fc.array(fc.constantFrom<FailOnEntry>('error', 'unsupported', 'evidenced-not-reached'), { maxLength: 6 }),
    { nil: undefined },
  );

  it('attaches exitCodeFor(resolution, failOn), and the default list when fail-on is undefined', () => {
    fc.assert(
      fc.property(
        fc.option(fc.boolean().chain((required) => arbFullAssessment(required)), { nil: undefined }),
        fc.option(arbRuntimeResult, { nil: undefined }),
        fc.option(arbStageError, { nil: undefined }),
        arbRegistry,
        arbFailOn,
        (assessment, runtime, error, registry, failOn) => {
          const config = {
            output: failOn === undefined ? {} : { 'fail-on': failOn },
          } as unknown as EffectiveConfig;
          const input: FinishRunInput = {
            config,
            registry,
            ...(assessment !== undefined ? { assessment } : {}),
            ...(runtime !== undefined ? { runtime } : {}),
            ...(error !== undefined ? { error } : {}),
          };
          const result = finishRun(input);
          const { exitCode, kind: _kind, claims: _c, assessment: _a, error: _e, capability: _cap, ...resolution } =
            result;
          void _kind;
          void _c;
          void _a;
          void _e;
          void _cap;
          const expected = exitCodeFor(resolution as Resolution, failOn);
          expect(exitCode).toBe(expected);
          if (failOn === undefined) {
            expect(exitCode).toBe(exitCodeFor(resolution as Resolution, ['error']));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
