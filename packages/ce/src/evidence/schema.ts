// Run_Schema: the zod definition of `run.json`. Single source of
// `schemas/run.schema.json`. One strict variant per Outcome, so the presence
// table of Requirement 2.16 is enforced by the schema itself.
import { z } from 'zod';
import { ConfigSchema } from '../config/schema.js';
import { OUTCOMES, type ResolveReason } from '../outcome/types.js';
import type { Stage } from '../errors.js';
import type { StopReason } from './trace.js';

export const SCHEMA_VERSION = '2' as const;

// The discriminator values come from OUTCOMES (the only literal declaration).
const [SKIPPED_OUTCOME, EVIDENCED_OUTCOME, UNSUPPORTED_OUTCOME, ERROR_OUTCOME] = OUTCOMES;

/** A path relative to the Run_Dir: `/` separated, not absolute, no `..` segment, no newline. */
export const BundleRelativePath = z
  .string()
  .regex(/^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^\n]+$/);

const ARTIFACT_KINDS = ['screenshot', 'log', 'jev-calls'] as const;
export const Artifact = z.strictObject({
  path: BundleRelativePath,
  kind: z.enum(ARTIFACT_KINDS),
});

const STAGES = ['config', 'context', 'assessment', 'runtime', 'evidence'] as const;
const RESOLVE_REASONS = [
  'stage-error',
  'assessment-missing',
  'not-required',
  'surface-unsupported',
  'evidence-collected',
  'no-observation',
  'evidence-incomplete',
] as const;
const STOP_REASONS = ['done', 'reached', 'give_up', 'max-steps', 'time-budget', 'aborted'] as const;
const SURFACES = [
  'browser_ui',
  'http_api',
  'cli',
  'backend_internal',
  'native_app',
  'non_runtime',
] as const;

// Compile-time drift checks against the source types.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _stages: Equal<(typeof STAGES)[number], Stage> = true;
const _reasons: Equal<(typeof RESOLVE_REASONS)[number], ResolveReason> = true;
const _stops: Equal<(typeof STOP_REASONS)[number], StopReason> = true;
void [_stages, _reasons, _stops];

const StageSchema = z.enum(STAGES);
const ResolveReasonSchema = z.enum(RESOLVE_REASONS);
const StopReasonSchema = z.enum(STOP_REASONS);
const SurfaceSchema = z.enum(SURFACES);

const ms = z.number().nonnegative();
export const Timings = z.strictObject({
  startedAt: z.iso.datetime(),
  durationMs: ms,
  stages: z.strictObject({
    config: ms.nullable(),
    context: ms.nullable(),
    assessment: ms.nullable(),
    runtime: ms.nullable(),
  }),
});

const ProvenanceRecord = z.strictObject({
  provider: z.enum(['git', 'github', 'cli', 'junit', 'config', 'runtime']),
  ref: z.string().optional(),
  location: z.string().optional(),
});

export const ClaimRecord = z.strictObject({
  id: z.string(),
  text: z.string(),
  probability: z.number().min(0).max(1).nullable(),
  provenance: ProvenanceRecord,
});

/** Classifier signals, not a verdict on correctness (SPEC 3.5). */
export const AssessmentReportRecord = z.strictObject({
  required: z.boolean(),
  decidedBy: z.enum(['classifier', 'policy']),
  surface: SurfaceSchema,
  claimStatus: z.enum(['identified', 'not_identified']),
  perClaimProbabilities: z.array(
    z.strictObject({
      claimId: z.string(),
      runtimeObservable: z.number(),
      checksAdequate: z.number(),
    }),
  ),
  questions: z.array(
    z.strictObject({
      idVersion: z.string(),
      subjectId: z.string(),
      probability: z.number().nullable(),
      probabilities: z.record(z.string(), z.number()).nullable(),
    }),
  ),
  settings: z.strictObject({
    claimThreshold: z.number(),
    observableThreshold: z.number(),
    adequateThreshold: z.number(),
    uncertaintyBand: z.number(),
    onUncertain: z.enum(['evidence', 'skip']),
  }),
});

export const StepRecord = z.strictObject({
  step: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  action: z.strictObject({ kind: z.string(), description: z.string() }),
  executed: z.boolean(),
  screenshot: BundleRelativePath,
  probabilities: z.record(z.string(), z.number()),
  alternatives: z.array(
    z.strictObject({
      key: z.string(),
      description: z.string(),
      probability: z.number().min(0).max(1),
    }),
  ),
});

export const EventLogRecord = z.strictObject({
  step: z.number().int().nonnegative(),
  kind: z.enum(['dialog', 'download', 'popup', 'settle', 'refusal']),
  detail: z.string(),
});

/** The Box answer as fractions of the image; recorded as returned, not clamped. */
export const FractionBox = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const unitSignal = z.number().min(0).max(1).nullable();

export const FinalImage = z.strictObject({
  model: z.string().nullable(),
  error: z.string().nullable(),
  screenshot: BundleRelativePath.nullable(),
  box: FractionBox.nullable(),
  signals: z.strictObject({
    stateReachedDom: unitSignal,
    stateReached: unitSignal,
  }),
});

export const RuntimeRecord = z.strictObject({ stopReason: StopReasonSchema });

/** ChangeContext minus patch text and commit messages (commits become a count). */
export const ContextRecord = z.strictObject({
  change: z.strictObject({
    title: z.string().optional(),
    description: z.string().optional(),
    base: z.string().optional(),
    head: z.string().optional(),
    files: z.array(
      z.strictObject({
        path: z.string(),
        oldPath: z.string().optional(),
        status: z.enum(['added', 'modified', 'deleted', 'renamed']),
        provenance: ProvenanceRecord,
      }),
    ),
    commits: z.number().int().nonnegative(),
    claims: z.array(z.strictObject({ text: z.string(), provenance: ProvenanceRecord })),
    provenance: z.array(ProvenanceRecord),
  }),
  candidates: z.array(
    z.strictObject({ id: z.string(), text: z.string(), provenance: ProvenanceRecord }),
  ),
  checks: z.array(
    z.strictObject({
      name: z.string(),
      status: z.enum(['passed', 'failed', 'skipped']),
      covers: z.array(z.string()).optional(),
      provenance: ProvenanceRecord,
    }),
  ),
  providers: z.array(
    z.strictObject({
      name: z.enum(['git', 'github', 'cli', 'junit']),
      status: z.enum(['used', 'unavailable']),
      reason: z
        .enum([
          'not-a-repository',
          'base-unresolved',
          'merge-base-missing',
          'git-failed',
          'head-missing',
          'source-absent',
          'source-unreadable',
          'source-malformed',
          'no-input',
          'not-configured',
        ])
        .optional(),
    }),
  ),
  truncated: z.array(
    z.strictObject({
      file: z.string(),
      reason: z.enum([
        'dropped',
        'truncated',
        'env-file',
        'sensitive-file',
        'binary',
        'candidate-cap',
        'check-cap',
      ]),
    }),
  ),
  redactions: z.array(z.strictObject({ file: z.string(), count: z.number().int().nonnegative() })),
});

/** Failing field paths only, never values (Requirement 2.19). */
export const ErrorField = z.strictObject({
  stage: StageSchema,
  reason: ResolveReasonSchema,
  causeName: z.string().nullable(),
  fields: z.array(z.string()),
});

const emptyList = <T extends z.ZodType>(item: T) => z.array(item).max(0);

const common = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  ceVersion: z.string(),
  jevModels: z.array(z.string()),
  outcomeReason: ResolveReasonSchema,
  artifacts: z.array(Artifact),
  timings: Timings,
};

// Keys follow the Requirement 2.1 order.
const NotRunVariant = (outcome: typeof SKIPPED_OUTCOME | typeof UNSUPPORTED_OUTCOME) =>
  z.strictObject({
    schemaVersion: common.schemaVersion,
    ceVersion: common.ceVersion,
    jevModels: common.jevModels,
    outcome: z.literal(outcome),
    outcomeReason: common.outcomeReason,
    config: ConfigSchema,
    context: ContextRecord,
    claims: z.array(ClaimRecord),
    assessment: AssessmentReportRecord,
    subject: z.null(),
    steps: emptyList(StepRecord),
    eventLog: emptyList(EventLogRecord),
    finalImage: z.null(),
    runtime: z.null(),
    finalState: z.null(),
    error: z.null(),
    artifacts: common.artifacts,
    timings: common.timings,
  });

const SkippedVariant = NotRunVariant(SKIPPED_OUTCOME);
const UnsupportedVariant = NotRunVariant(UNSUPPORTED_OUTCOME);

const EvidencedVariant = z.strictObject({
  schemaVersion: common.schemaVersion,
  ceVersion: common.ceVersion,
  jevModels: common.jevModels,
  outcome: z.literal(EVIDENCED_OUTCOME),
  outcomeReason: common.outcomeReason,
  config: ConfigSchema,
  context: ContextRecord,
  claims: z.array(ClaimRecord),
  assessment: AssessmentReportRecord,
  subject: z.string(),
  steps: z.array(StepRecord).min(1),
  eventLog: z.array(EventLogRecord),
  finalImage: FinalImage.nullable(),
  runtime: RuntimeRecord.nullable(),
  finalState: z.enum(['reached', 'not_reached']),
  error: z.null(),
  artifacts: common.artifacts,
  timings: common.timings,
});

// The Validation_Failure shape is a value of this variant (all nullable cells
// null, all lists empty), not a fifth variant.
const ErrorVariant = z.strictObject({
  schemaVersion: common.schemaVersion,
  ceVersion: common.ceVersion,
  jevModels: common.jevModels,
  outcome: z.literal(ERROR_OUTCOME),
  outcomeReason: common.outcomeReason,
  config: ConfigSchema.nullable(),
  context: ContextRecord.nullable(),
  claims: z.array(ClaimRecord),
  assessment: AssessmentReportRecord.nullable(),
  subject: z.string().nullable(),
  steps: z.array(StepRecord),
  eventLog: z.array(EventLogRecord),
  finalImage: FinalImage.nullable(),
  runtime: RuntimeRecord.nullable(),
  finalState: z.null(),
  error: ErrorField,
  artifacts: common.artifacts,
  timings: common.timings,
});

export const RunRecordSchema = z.discriminatedUnion('outcome', [
  SkippedVariant,
  EvidencedVariant,
  UnsupportedVariant,
  ErrorVariant,
]);

export type RunRecord = z.infer<typeof RunRecordSchema>;
