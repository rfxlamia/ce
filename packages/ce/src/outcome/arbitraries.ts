// Test-only fast-check arbitraries for the outcome resolver. Imported from
// *.test.ts files only. Pure data generators: no Jev, no browser, no SDK.

import fc from 'fast-check';
import type { Assessment, Surface } from '../assessment/index.js';
import { StageError } from '../errors.js';
import type { Stage } from '../errors.js';
import type { EvidenceSummary } from './evidence.js';
import { V0_SUPPORTED_SURFACES } from './types.js';
import type { FinalState, ResolveInput, RuntimeResult } from './types.js';

export const ALL_STAGES: readonly Stage[] = ['config', 'context', 'assessment', 'runtime', 'evidence'];

export const ALL_SURFACES: readonly Surface[] = [
  'browser_ui',
  'http_api',
  'cli',
  'backend_internal',
  'native_app',
  'non_runtime',
];

type Claim = EvidenceSummary['claim'];
type Change = EvidenceSummary['change'];

/** The supported list `resolveOutcome` effectively uses for an input. */
function effectiveSurfaces(supported: readonly Surface[] | undefined): readonly Surface[] {
  return supported ?? V0_SUPPORTED_SURFACES;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const arbStageError: fc.Arbitrary<StageError> = fc
  .constantFrom(...ALL_STAGES)
  .map((stage) => new StageError(stage, new Error('synthetic')));

export const arbSurface: fc.Arbitrary<Surface> = fc.constantFrom(...ALL_SURFACES);

export const arbAssessment: fc.Arbitrary<Pick<Assessment, 'required' | 'surface'>> = fc.record({
  required: fc.boolean(),
  surface: arbSurface,
});

export const arbFinalState: fc.Arbitrary<FinalState> = fc.constantFrom<FinalState>(
  'reached',
  'not_reached',
);

/** Non-empty after trim. */
const arbText: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

/** Empty or whitespace-only. */
const arbBlank: fc.Arbitrary<string> = fc.constantFrom('', ' ', '  ', '\t', '\n', ' \t\n ');

/** Anything a string-typed field may hold: filled or blank. */
const arbLooseText: fc.Arbitrary<string> = fc.oneof(arbText, arbBlank);

const arbProvenance = fc.record({
  provider: fc.constantFrom('git', 'github', 'cli', 'junit', 'config', 'runtime' as const),
});

// ---------------------------------------------------------------------------
// Evidence summary parts
// ---------------------------------------------------------------------------

/** A Change that identifies itself: at least one of the five fields is filled. */
const arbIdentifiedChange: fc.Arbitrary<Change> = fc
  .tuple(
    fc.record({
      title: fc.option(arbLooseText, { nil: undefined }),
      description: fc.option(arbLooseText, { nil: undefined }),
      base: fc.option(arbLooseText, { nil: undefined }),
      head: fc.option(arbLooseText, { nil: undefined }),
      files: fc.array(arbText, { maxLength: 3 }),
    }),
    fc.constantFrom('title', 'description', 'base', 'head', 'files' as const),
    arbText,
  )
  .map(([loose, field, text]): Change => {
    const change: Change = { ...loose };
    if (field === 'files') change.files = [text, ...loose.files];
    else change[field] = text;
    return change;
  });

/** A Change that does not identify itself: every field blank or absent. */
const arbBlankChange: fc.Arbitrary<Change> = fc
  .record({
    title: fc.option(arbBlank, { nil: undefined }),
    description: fc.option(arbBlank, { nil: undefined }),
    base: fc.option(arbBlank, { nil: undefined }),
    head: fc.option(arbBlank, { nil: undefined }),
  })
  .map((c): Change => ({ ...c, files: [] }));

const arbValidClaim: fc.Arbitrary<Claim> = fc.oneof(
  fc.record({
    status: fc.constant('identified' as const),
    id: arbText,
    text: arbText,
    provenance: arbProvenance,
  }),
  fc.constant<Claim>({ status: 'not_identified' }),
);

const arbInvalidClaim: fc.Arbitrary<Claim> = fc
  .tuple(arbText, arbBlank, arbProvenance, fc.boolean())
  .map(
    ([filled, blank, provenance, blankId]): Claim => ({
      status: 'identified',
      id: blankId ? blank : filled,
      text: blankId ? filled : blank,
      provenance,
    }),
  );

const arbActions = fc.array(fc.record({ kind: arbText, description: arbLooseText }), {
  maxLength: 4,
});

const arbGoodObservation = fc.record({ step: fc.nat({ max: 50 }), screenshot: arbText });

/** One, two or many observations, each with a screenshot path. */
const arbGoodObservations = fc.oneof(
  fc.array(arbGoodObservation, { minLength: 1, maxLength: 1 }),
  fc.array(arbGoodObservation, { minLength: 2, maxLength: 6 }),
);

const arbGoodArtifacts = fc.record({ runDir: arbText, reportPath: arbText });

const arbBadArtifacts: fc.Arbitrary<EvidenceSummary['artifacts']> = fc
  .tuple(arbText, arbBlank, arbText, arbBlank, fc.constantFrom('dir', 'report', 'both'))
  .map(([dir, blankDir, report, blankReport, which]) => ({
    runDir: which === 'report' ? dir : blankDir,
    reportPath: which === 'dir' ? report : blankReport,
  }));

// ---------------------------------------------------------------------------
// Evidence summaries
// ---------------------------------------------------------------------------

/** Every SPEC 7.2 condition holds. Always has at least one observation. */
export const arbPassingSummary: fc.Arbitrary<EvidenceSummary> = fc.record({
  change: arbIdentifiedChange,
  claim: arbValidClaim,
  subject: fc.record({ url: arbText }),
  actions: arbActions,
  observations: arbGoodObservations,
  artifacts: arbGoodArtifacts,
});

/** Fails the check and holds at least one observation (Evidence_Incomplete). */
export const arbFailingNonEmptySummary: fc.Arbitrary<EvidenceSummary> = fc
  .tuple(
    arbPassingSummary,
    fc.constantFrom('change', 'claim', 'subject', 'screenshot', 'artifacts' as const),
    arbBlankChange,
    arbInvalidClaim,
    arbBlank,
    arbBadArtifacts,
    fc.nat({ max: 5 }),
  )
  .map(([base, broken, change, claim, blank, artifacts, index]): EvidenceSummary => {
    switch (broken) {
      case 'change':
        return { ...base, change };
      case 'claim':
        return { ...base, claim };
      case 'subject':
        return { ...base, subject: { url: blank } };
      case 'artifacts':
        return { ...base, artifacts };
      case 'screenshot': {
        const observations = base.observations.map((o) => ({ ...o }));
        const target = observations[index % observations.length];
        if (target !== undefined) target.screenshot = blank;
        return { ...base, observations };
      }
    }
  });

/** Fails the check because there are no observations (other items may hold). */
export const arbEmptyObservationsSummary: fc.Arbitrary<EvidenceSummary> = fc
  .tuple(fc.oneof(arbPassingSummary, arbFailingNonEmptySummary))
  .map(([s]): EvidenceSummary => ({ ...s, observations: [] }));

/** Fails the check: either no observations or a broken item. */
export const arbFailingSummary: fc.Arbitrary<EvidenceSummary> = fc.oneof(
  { weight: 3, arbitrary: arbFailingNonEmptySummary },
  { weight: 1, arbitrary: arbEmptyObservationsSummary },
);

/** Both passing and failing summaries occur. */
export const arbEvidenceSummary: fc.Arbitrary<EvidenceSummary> = fc.oneof(
  { weight: 1, arbitrary: arbPassingSummary },
  { weight: 1, arbitrary: arbFailingSummary },
);

export const arbRuntimeResult: fc.Arbitrary<RuntimeResult> = fc.record({
  finalState: arbFinalState,
  evidence: arbEvidenceSummary,
});

// ---------------------------------------------------------------------------
// Supported surfaces
// ---------------------------------------------------------------------------

/** `undefined` (use the v0 default), explicit empty, all six, or a random subset. */
export const arbSupportedSurfaces: fc.Arbitrary<readonly Surface[] | undefined> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<readonly Surface[] | undefined>(undefined) },
  { weight: 1, arbitrary: fc.constant<readonly Surface[] | undefined>([]) },
  { weight: 1, arbitrary: fc.constant<readonly Surface[] | undefined>([...ALL_SURFACES]) },
  {
    weight: 4,
    arbitrary: fc.subarray([...ALL_SURFACES]) as fc.Arbitrary<readonly Surface[] | undefined>,
  },
);

/** A supported list whose effective set excludes at least one Surface. */
const arbSupportedMissingSome = arbSupportedSurfaces.filter(
  (s) => effectiveSurfaces(s).length < ALL_SURFACES.length,
);

/** A supported list whose effective set holds at least one Surface. */
const arbSupportedNonEmpty = arbSupportedSurfaces.filter((s) => effectiveSurfaces(s).length > 0);

// ---------------------------------------------------------------------------
// ResolveInput, one arbitrary per branch of the precedence flowchart
// ---------------------------------------------------------------------------

/** Fields a branch does not care about: each may be present or absent. */
function withOptionalTail(
  head: Partial<ResolveInput>,
): fc.Arbitrary<ResolveInput> {
  return fc
    .tuple(
      fc.option(arbRuntimeResult, { nil: undefined }),
      arbSupportedSurfaces,
    )
    .map(([runtime, supportedSurfaces]) => {
      const input: ResolveInput = { ...head };
      if (runtime !== undefined) input.runtime = runtime;
      if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;
      return input;
    });
}

/** 1. error present -> ERROR / stage-error. */
const arbBranchStageError: fc.Arbitrary<ResolveInput> = fc
  .tuple(arbStageError, fc.option(arbAssessment, { nil: undefined }), arbRuntimeResult.chain((r) => fc.option(fc.constant(r), { nil: undefined })), arbSupportedSurfaces)
  .map(([error, assessment, runtime, supportedSurfaces]) => {
    const input: ResolveInput = { error };
    if (assessment !== undefined) input.assessment = assessment;
    if (runtime !== undefined) input.runtime = runtime;
    if (supportedSurfaces !== undefined) input.supportedSurfaces = supportedSurfaces;
    return input;
  });

/** 2. no error, no assessment -> ERROR / assessment-missing. */
const arbBranchAssessmentMissing: fc.Arbitrary<ResolveInput> = withOptionalTail({});

/** 3. required false -> SKIPPED / not-required. */
const arbBranchNotRequired: fc.Arbitrary<ResolveInput> = arbSurface.chain((surface) =>
  withOptionalTail({ assessment: { required: false, surface } }),
);

/** 4. required, surface outside the effective catalog -> UNSUPPORTED. */
const arbBranchSurfaceUnsupported: fc.Arbitrary<ResolveInput> = arbSupportedMissingSome.chain(
  (supported) => {
    const effective = effectiveSurfaces(supported);
    const outside = ALL_SURFACES.filter((s) => !effective.includes(s));
    return fc
      .tuple(fc.constantFrom(...outside), fc.option(arbRuntimeResult, { nil: undefined }))
      .map(([surface, runtime]) => {
        const input: ResolveInput = { assessment: { required: true, surface } };
        if (runtime !== undefined) input.runtime = runtime;
        if (supported !== undefined) input.supportedSurfaces = supported;
        return input;
      });
  },
);

/** Required, supported surface: the shared head of branches 5, 6 and 7. */
function arbSupportedRequired(
  arbRuntime: fc.Arbitrary<RuntimeResult | undefined>,
): fc.Arbitrary<ResolveInput> {
  return arbSupportedNonEmpty.chain((supported) =>
    fc
      .tuple(fc.constantFrom(...effectiveSurfaces(supported)), arbRuntime)
      .map(([surface, runtime]) => {
        const input: ResolveInput = { assessment: { required: true, surface } };
        if (runtime !== undefined) input.runtime = runtime;
        if (supported !== undefined) input.supportedSurfaces = supported;
        return input;
      }),
  );
}

/** 5. runtime absent or zero observations -> ERROR / no-observation. */
const arbBranchNoObservation: fc.Arbitrary<ResolveInput> = arbSupportedRequired(
  fc.oneof(
    fc.constant<RuntimeResult | undefined>(undefined),
    fc.record({ finalState: arbFinalState, evidence: arbEmptyObservationsSummary }),
  ),
);

/** 6. observations present, summary incomplete -> ERROR / evidence-incomplete. */
const arbBranchEvidenceIncomplete: fc.Arbitrary<ResolveInput> = arbSupportedRequired(
  fc.record({ finalState: arbFinalState, evidence: arbFailingNonEmptySummary }),
);

/** 7. observations present, summary complete -> EVIDENCED / evidence-collected. */
const arbBranchEvidenced: fc.Arbitrary<ResolveInput> = arbSupportedRequired(
  fc.record({ finalState: arbFinalState, evidence: arbPassingSummary }),
);

/**
 * Weights sum to 100. Outcome shares: EVIDENCED 30, SKIPPED 20,
 * UNSUPPORTED 20, ERROR 30 (stage-error 12, assessment-missing 6,
 * no-observation 6, evidence-incomplete 6). Branches 1 to 6 may randomly
 * resolve elsewhere never: each is built so its own branch always fires.
 */
export const arbResolveInput: fc.Arbitrary<ResolveInput> = fc.oneof(
  { weight: 12, arbitrary: arbBranchStageError },
  { weight: 6, arbitrary: arbBranchAssessmentMissing },
  { weight: 20, arbitrary: arbBranchNotRequired },
  { weight: 20, arbitrary: arbBranchSurfaceUnsupported },
  { weight: 6, arbitrary: arbBranchNoObservation },
  { weight: 6, arbitrary: arbBranchEvidenceIncomplete },
  { weight: 30, arbitrary: arbBranchEvidenced },
);
