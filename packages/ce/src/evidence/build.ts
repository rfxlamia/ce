// Pure builders of the Run_Record. No I/O, no clock, no environment access.
// The outcome, its reason and the final state are copied from the Resolution
// by field access. Nothing here decides or names an Outcome (Requirement 9.1).
import type { Assessment, Claim } from '../assessment/types.js';
import { REDACTED, type RedactedConfig } from '../config/redact.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import type { Stage, StageError } from '../errors.js';
import type { Resolution, ResolveReason, RuntimeResult } from '../outcome/types.js';
import type { LoopStageError } from '../runtime/loop.js';
import { VERSION } from '../version.js';
import type { RunRecord, SCHEMA_VERSION } from './schema.js';
import type { RuntimeTrace } from './trace.js';

type Artifact = Extract<RunRecord, { outcome: unknown }>['artifacts'][number];
type Timings = RunRecord['timings'];
type StepRecord = RunRecord['steps'][number];
type EventLogRecord = RunRecord['eventLog'][number];
type ContextRecord = NonNullable<RunRecord['context']>;
type AssessmentRecord = NonNullable<RunRecord['assessment']>;
type ClaimRecord = RunRecord['claims'][number];
type FinalImageRecord = NonNullable<RunRecord['finalImage']>;
type ProvenanceRecord = ClaimRecord['provenance'];
type ErrorRecord = NonNullable<RunRecord['error']>;

/** Start time, total duration and per-stage durations, measured by the pipeline. */
export type StageTimings = Timings;

export type PartialTrace = Pick<LoopStageError['partial'], 'observations' | 'steps' | 'eventLog'>;

export interface BuildRunRecordInput {
  /** From `resolveOutcome`, read only. */
  resolution: Resolution;
  /** The redacted view. `null` iff `loadConfig` failed. */
  config: RedactedConfig | null;
  /** `null` unless the context stage completed. */
  context: ChangeContext | null;
  claims: readonly Claim[];
  /** `null` unless the assessment stage completed. */
  assessment: Assessment | null;
  /** `null` when no runtime result exists. May carry `trace`. */
  runtime: RuntimeResult | null;
  /** `LoopStageError.partial` when the runtime stage failed with one. */
  partialTrace?: PartialTrace;
  error: StageError | null;
  /** Failing field paths of a rejected record (evidence-stage Validation_Failure). */
  validationFields?: readonly string[];
  /** Discovered by the writer. Copied as is. */
  artifacts: readonly Artifact[];
  timings: StageTimings;
  ceVersion?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Ordered de-duplication: keeps the first occurrence of each id. */
export function dedupInOrder(...lists: readonly (readonly string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (list === undefined) continue;
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Constructor name of a cause, or `null`. Never reads a message. */
export function causeNameOf(cause: unknown): string | null {
  if (cause === null || cause === undefined) return null;
  const ctor = (cause as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' && ctor.name !== '' ? ctor.name : null;
}

function provenanceRecord(p: Provenance): ProvenanceRecord {
  const out: ProvenanceRecord = { provider: p.provider };
  if (p.ref !== undefined) out.ref = p.ref;
  if (p.location !== undefined) out.location = p.location;
  return out;
}

/** Requirement 7.9: fixture keys only, never values. Returns a copy; keeps keys. */
function maskFixtureValues(config: RedactedConfig['config']): RedactedConfig['config'] {
  const fixtures = config.runtime?.fixtures;
  if (fixtures === undefined || config.runtime === undefined) return config;
  const masked: Record<string, string> = {};
  for (const key of Object.keys(fixtures)) masked[key] = REDACTED;
  return { ...config, runtime: { ...config.runtime, fixtures: masked } };
}

function stageForMissingErrorStage(reason: ResolveReason): Stage {
  return reason === 'assessment-missing' ? 'assessment' : 'runtime';
}

// ---------------------------------------------------------------------------
// Record parts
// ---------------------------------------------------------------------------

function buildClaims(claims: readonly Claim[]): ClaimRecord[] {
  return claims.map((c) => ({
    id: c.id,
    text: c.text,
    probability: c.probability,
    provenance: provenanceRecord(c.provenance),
  }));
}

function buildAssessment(a: Assessment): AssessmentRecord {
  const s = a.record.settings;
  return {
    required: a.required,
    decidedBy: a.decidedBy,
    surface: a.surface,
    claimStatus: a.claimStatus,
    perClaimProbabilities: a.perClaim.map((p) => ({
      claimId: p.claimId,
      runtimeObservable: p.runtimeObservable,
      checksAdequate: p.checksAdequate,
    })),
    questions: a.record.questions.map((q) => ({
      idVersion: q.idVersion,
      subjectId: q.subjectId,
      probability: q.probability ?? null,
      probabilities: q.probabilities === undefined ? null : { ...q.probabilities },
    })),
    settings: {
      claimThreshold: s.claimThreshold,
      observableThreshold: s.observableThreshold,
      adequateThreshold: s.adequateThreshold,
      uncertaintyBand: s.uncertaintyBand,
      onUncertain: s.onUncertain,
    },
  };
}

/** Drops `patch` text and commit messages; commits become a count. */
function buildContext(c: ChangeContext): ContextRecord {
  const change: ContextRecord['change'] = {
    files: c.change.files.map((f) => {
      const file: ContextRecord['change']['files'][number] = {
        path: f.path,
        status: f.status,
        provenance: provenanceRecord(f.provenance),
      };
      if (f.oldPath !== undefined) file.oldPath = f.oldPath;
      return file;
    }),
    commits: c.change.commits.length,
    claims: c.change.claims.map((x) => ({ text: x.text, provenance: provenanceRecord(x.provenance) })),
    provenance: c.change.provenance.map(provenanceRecord),
  };
  if (c.change.title !== undefined) change.title = c.change.title;
  if (c.change.description !== undefined) change.description = c.change.description;
  if (c.change.base !== undefined) change.base = c.change.base;
  if (c.change.head !== undefined) change.head = c.change.head;

  return {
    change,
    candidates: c.candidates.map((x) => ({
      id: x.id,
      text: x.text,
      provenance: provenanceRecord(x.provenance),
    })),
    checks: c.checks.map((x) => {
      const check: ContextRecord['checks'][number] = {
        name: x.name,
        status: x.status,
        provenance: provenanceRecord(x.provenance),
      };
      if (x.covers !== undefined) check.covers = [...x.covers];
      return check;
    }),
    providers: c.providers.map((x) => {
      const provider: ContextRecord['providers'][number] = { name: x.name, status: x.status };
      if (x.reason !== undefined) provider.reason = x.reason;
      return provider;
    }),
    truncated: c.truncated.map((x) => ({ file: x.file, reason: x.reason })),
    redactions: c.redactions.map((x) => ({ file: x.file, count: x.count })),
  };
}

interface RuntimePart {
  subject: string | null;
  steps: StepRecord[];
  eventLog: EventLogRecord[];
  finalImage: FinalImageRecord | null;
  runtime: RunRecord['runtime'];
}

const EMPTY_RUNTIME: RuntimePart = {
  subject: null,
  steps: [],
  eventLog: [],
  finalImage: null,
  runtime: null,
};

function fromTrace(trace: RuntimeTrace, subject: string | null): RuntimePart {
  return {
    subject,
    steps: trace.steps.map((s) => ({
      step: s.step,
      url: s.url,
      title: s.title,
      action: { kind: s.action.kind, description: s.action.description },
      executed: s.executed,
      screenshot: s.screenshot,
      probabilities: { ...s.probabilities },
      alternatives: s.alternatives.map((a) => ({ key: a.key, description: a.description, probability: a.probability })),
    })),
    eventLog: trace.eventLog.map((e) => ({ step: e.step, kind: e.kind, detail: e.detail })),
    finalImage: {
      model: trace.finalImageModel ?? null,
      error: trace.finalImageError ?? null,
      screenshot: trace.finalScreenshot ?? null,
      box: trace.finalBox === undefined ? null : { ...trace.finalBox },
      signals: {
        stateReachedDom: trace.finalSignals?.stateReachedDom ?? null,
        stateReached: trace.finalSignals?.stateReached ?? null,
      },
    },
    runtime: { stopReason: trace.stopReason },
  };
}

/** Requirement 10.6: no trace, so use the EvidenceSummary with safe placeholders. */
function fromEvidenceSummary(result: RuntimeResult): RuntimePart {
  return {
    subject: result.evidence.subject.url,
    steps: result.evidence.observations.map((o) => ({
      step: o.step,
      url: '',
      title: '',
      action: { kind: 'unknown', description: '' },
      executed: false,
      screenshot: o.screenshot,
      probabilities: {},
      alternatives: [],
    })),
    eventLog: [],
    finalImage: null,
    runtime: null,
  };
}

/**
 * Requirement 5.9: carry what a failed loop had gathered. `finalImage` and
 * `runtime` stay null. An observation without a step entry becomes a step
 * with action kind `none`. A fill action is described by its fixture key only.
 */
function fromPartial(partial: PartialTrace): RuntimePart {
  const steps: StepRecord[] = partial.steps.map((s) => {
    const a = s.action;
    let description = '';
    if (a.kind === 'click' || a.kind === 'fill') {
      const el = s.observation.elements.find((e) => e.ref === a.ref);
      const target = el === undefined ? a.ref : `${el.role} "${el.name}"`;
      description = a.kind === 'fill' ? `${target} from fixture "${a.fixtureKey}"` : target;
    } else if (a.kind === 'goto') {
      description = a.url;
    }
    return {
      step: s.observation.step,
      url: s.observation.url,
      title: s.observation.title,
      action: { kind: a.kind, description },
      executed: s.executed === true,
      screenshot: s.observation.screenshot,
      probabilities: { ...s.probabilities },
      alternatives: [],
    };
  });
  const covered = new Set(steps.map((s) => s.step));
  for (const o of partial.observations) {
    if (covered.has(o.step)) continue;
    covered.add(o.step);
    steps.push({
      step: o.step,
      url: o.url,
      title: o.title,
      action: { kind: 'none', description: '' },
      executed: false,
      screenshot: o.screenshot,
      probabilities: {},
      alternatives: [],
    });
  }
  steps.sort((x, y) => x.step - y.step);
  const first = partial.observations[0]?.url ?? steps[0]?.url;
  return {
    subject: first === undefined ? null : first,
    steps,
    eventLog: partial.eventLog.map((e) => ({ step: e.step, kind: e.kind, detail: e.detail })),
    finalImage: null,
    runtime: null,
  };
}

function buildRuntimePart(input: BuildRunRecordInput): RuntimePart {
  const { runtime, partialTrace } = input;
  if (runtime !== null) {
    return runtime.trace === undefined
      ? fromEvidenceSummary(runtime)
      : fromTrace(runtime.trace, runtime.evidence.subject.url);
  }
  if (partialTrace !== undefined) return fromPartial(partialTrace);
  return EMPTY_RUNTIME;
}

function buildError(input: BuildRunRecordInput): ErrorRecord {
  const { resolution, error } = input;
  const stage =
    resolution.errorStage ?? error?.stage ?? stageForMissingErrorStage(resolution.reason);
  return {
    stage,
    reason: resolution.reason,
    causeName: error === null ? null : causeNameOf(error.cause),
    fields: stage === 'evidence' ? [...(input.validationFields ?? [])] : [],
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Builds the Run_Record for any resolution. Pure. The caller redacts and
 * validates the result; the builder never throws on odd input.
 */
export function buildRunRecord(input: BuildRunRecordInput): RunRecord {
  const { resolution } = input;
  const isEvidenced = resolution.outcome === 'EVIDENCED';
  const isError = resolution.outcome === 'ERROR';
  const hasRuntime = isEvidenced || isError;
  const rt = hasRuntime ? buildRuntimePart(input) : EMPTY_RUNTIME;

  const assessment = input.assessment === null ? null : buildAssessment(input.assessment);
  const claims = !isError || input.assessment !== null ? buildClaims(input.claims) : [];

  const record = {
    schemaVersion: '2' satisfies typeof SCHEMA_VERSION,
    ceVersion: input.ceVersion ?? VERSION,
    jevModels: dedupInOrder(
      input.assessment?.record.modelIds,
      hasRuntime ? input.runtime?.trace?.modelIds : undefined,
      hasRuntime && input.runtime?.trace?.finalImageModel !== undefined
        ? [input.runtime.trace.finalImageModel]
        : undefined,
    ),
    outcome: resolution.outcome,
    outcomeReason: resolution.reason,
    config: input.config === null ? null : maskFixtureValues(input.config.config),
    context: input.context === null ? null : buildContext(input.context),
    claims,
    assessment,
    subject: rt.subject,
    steps: rt.steps,
    eventLog: rt.eventLog,
    finalImage: rt.finalImage,
    runtime: rt.runtime,
    finalState: isEvidenced ? (resolution.finalState ?? null) : null,
    error: isError ? buildError(input) : null,
    artifacts: input.artifacts.map((a) => ({ path: a.path, kind: a.kind })),
    timings: cloneTimings(input.timings),
  };
  return record as RunRecord;
}

/** The ERROR record for a failed run: completed stages plus `error`. Same rules as `buildRunRecord`. */
export function buildMinimalRunRecord(input: BuildRunRecordInput): RunRecord {
  return buildRunRecord(input);
}

/**
 * After a Validation_Failure: only the top-level fields and `error`.
 * Every stage-derived field is `null` or `[]`, so nothing that failed
 * validation is carried over (Requirements 5.13, 5.14).
 */
export function buildValidationFailureRunRecord(input: {
  resolution: Resolution;
  timings: StageTimings;
  /** Failing field paths, no values. */
  fields: readonly string[];
  error?: StageError | null;
  ceVersion?: string;
}): RunRecord {
  const { resolution } = input;
  const record = {
    schemaVersion: '2' satisfies typeof SCHEMA_VERSION,
    ceVersion: input.ceVersion ?? VERSION,
    jevModels: [],
    outcome: resolution.outcome,
    outcomeReason: resolution.reason,
    config: null,
    context: null,
    claims: [],
    assessment: null,
    subject: null,
    steps: [],
    eventLog: [],
    finalImage: null,
    runtime: null,
    finalState: null,
    error: {
      stage: resolution.errorStage ?? input.error?.stage ?? 'evidence',
      reason: resolution.reason,
      causeName: input.error === undefined || input.error === null ? null : causeNameOf(input.error.cause),
      fields: [...input.fields],
    },
    artifacts: [],
    timings: cloneTimings(input.timings),
  };
  return record as RunRecord;
}

function cloneTimings(t: StageTimings): StageTimings {
  return {
    startedAt: t.startedAt,
    durationMs: t.durationMs,
    stages: {
      config: t.stages.config,
      context: t.stages.context,
      assessment: t.stages.assessment,
      runtime: t.stages.runtime,
    },
  };
}
