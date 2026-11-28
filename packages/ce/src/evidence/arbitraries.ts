// fast-check arbitraries for RunRecord (test-only). Minimal version: covers all
// four Outcome variants, plus the builder-input arbitraries (task 3.4).
import fc from 'fast-check';
import type { Assessment, Claim, Surface } from '../assessment/types.js';
import type { RedactedConfig } from '../config/redact.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import { StageError } from '../errors.js';
import type { Stage } from '../errors.js';
import { OUTCOMES } from '../outcome/types.js';
import type { FinalState, Resolution, RuntimeResult } from '../outcome/types.js';
import type { BuildRunRecordInput, PartialTrace } from './build.js';
import type { RunRecord } from './schema.js';
import type { RuntimeTrace } from './trace.js';

const [SKIPPED_O, EVIDENCED_O, UNSUPPORTED_O, ERROR_O] = OUTCOMES;

type Variant<O extends RunRecord['outcome']> = Extract<RunRecord, { outcome: O }>;

const text = fc.string({ maxLength: 20 });
const nat = fc.nat({ max: 1000 });
/** Finite, never -0, so JSON text round-trips exactly. */
const num = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 })
  .map((n) => (n === 0 ? 0 : n));
const ms = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1e6 })
  .map((n) => (n === 0 ? 0 : n));
const prob = fc.double({ noNaN: true, min: 0, max: 1 }).map((n) => (n === 0 ? 0 : n));

const segment = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
const bundlePath = fc.array(segment, { minLength: 1, maxLength: 3 }).map((s) => s.join('/'));
const key = segment.map((s) => `k${s}`);

const provenance = fc.record(
  {
    provider: fc.constantFrom('git', 'github', 'cli', 'junit', 'config', 'runtime'),
    ref: text,
    location: text,
  },
  { requiredKeys: ['provider'] },
);

const timings = fc
  .record({
    startedAt: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2040-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString()),
    durationMs: ms,
    stages: fc.record({
      config: fc.option(ms, { nil: null }),
      context: fc.option(ms, { nil: null }),
      assessment: fc.option(ms, { nil: null }),
      runtime: fc.option(ms, { nil: null }),
    }),
  });

const artifact = fc.record({
  path: bundlePath,
  kind: fc.constantFrom('screenshot', 'log', 'jev-calls'),
});

const config = fc.record(
  {
    version: fc.constant(0 as const),
    target: fc.record(
      {
        url: fc.constantFrom('http://localhost:3000', 'https://example.com/app'),
        start: text,
        ready: fc.record(
          { path: text, timeout: fc.constantFrom('30s', '500ms', '2m') },
          { requiredKeys: [] },
        ),
        routes: fc.array(text, { maxLength: 3 }),
      },
      { requiredKeys: [] },
    ),
    assessment: fc.record(
      {
        thresholds: fc.record({ claim: prob, observable: prob, adequate: prob }, { requiredKeys: [] }),
        'uncertainty-band': prob,
        'on-uncertain': fc.constantFrom('evidence', 'skip'),
      },
      { requiredKeys: [] },
    ),
    runtime: fc.record(
      {
        'max-steps': fc.integer({ min: 1, max: 100 }),
        timeout: fc.constantFrom('30s', '2m'),
        viewport: fc.record(
          { width: fc.integer({ min: 1, max: 4000 }), height: fc.integer({ min: 1, max: 4000 }) },
          { requiredKeys: [] },
        ),
        fixtures: fc.dictionary(key, text, { maxKeys: 3 }),
      },
      { requiredKeys: [] },
    ),
    jev: fc.record(
      { provider: fc.constantFrom('openrouter', 'typesafe'), model: text },
      { requiredKeys: [] },
    ),
    output: fc.record(
      {
        dir: text,
        'fail-on': fc.array(fc.constantFrom('error', 'unsupported', 'evidenced-not-reached'), {
          maxLength: 3,
        }),
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: [] },
);

const context = fc.record({
  change: fc.record(
    {
      title: text,
      description: text,
      base: text,
      head: text,
      files: fc.array(
        fc.record(
          {
            path: text,
            oldPath: text,
            status: fc.constantFrom('added', 'modified', 'deleted', 'renamed'),
            provenance,
          },
          { requiredKeys: ['path', 'status', 'provenance'] },
        ),
        { maxLength: 3 },
      ),
      commits: nat,
      claims: fc.array(fc.record({ text, provenance }), { maxLength: 3 }),
      provenance: fc.array(provenance, { maxLength: 3 }),
    },
    { requiredKeys: ['files', 'commits', 'claims', 'provenance'] },
  ),
  candidates: fc.array(fc.record({ id: text, text, provenance }), { maxLength: 3 }),
  checks: fc.array(
    fc.record(
      {
        name: text,
        status: fc.constantFrom('passed', 'failed', 'skipped'),
        covers: fc.array(text, { maxLength: 3 }),
        provenance,
      },
      { requiredKeys: ['name', 'status', 'provenance'] },
    ),
    { maxLength: 3 },
  ),
  providers: fc.array(
    fc.record(
      {
        name: fc.constantFrom('git', 'github', 'cli', 'junit'),
        status: fc.constantFrom('used', 'unavailable'),
        reason: fc.constantFrom('not-a-repository', 'base-unresolved', 'no-input', 'not-configured'),
      },
      { requiredKeys: ['name', 'status'] },
    ),
    { maxLength: 4 },
  ),
  truncated: fc.array(
    fc.record({ file: text, reason: fc.constantFrom('dropped', 'truncated', 'binary', 'check-cap') }),
    { maxLength: 3 },
  ),
  redactions: fc.array(fc.record({ file: text, count: nat }), { maxLength: 3 }),
});

const claim = fc.record({
  id: text,
  text,
  probability: fc.option(prob, { nil: null }),
  provenance,
});

const assessment = fc.record({
  required: fc.boolean(),
  decidedBy: fc.constantFrom('classifier', 'policy'),
  surface: fc.constantFrom(
    'browser_ui',
    'http_api',
    'cli',
    'backend_internal',
    'native_app',
    'non_runtime',
  ),
  claimStatus: fc.constantFrom('identified', 'not_identified'),
  perClaimProbabilities: fc.array(
    fc.record({ claimId: text, runtimeObservable: prob, checksAdequate: prob }),
    { maxLength: 3 },
  ),
  questions: fc.array(
    fc.record({
      idVersion: text,
      subjectId: text,
      probability: fc.option(prob, { nil: null }),
      probabilities: fc.option(fc.dictionary(key, prob, { maxKeys: 3 }), { nil: null }),
    }),
    { maxLength: 3 },
  ),
  settings: fc.record({
    claimThreshold: prob,
    observableThreshold: prob,
    adequateThreshold: prob,
    uncertaintyBand: prob,
    onUncertain: fc.constantFrom('evidence', 'skip'),
  }),
});

const step = fc.record({
  step: nat,
  url: text,
  title: text,
  action: fc.record({ kind: text, description: text }),
  executed: fc.boolean(),
  screenshot: bundlePath,
  probabilities: fc.dictionary(key, num, { maxKeys: 3 }),
  alternatives: fc.array(fc.record({ key, description: text, probability: prob }), { maxLength: 3 }),
});

const eventLogEntry = fc.record({
  step: nat,
  kind: fc.constantFrom('dialog', 'download', 'popup', 'settle', 'refusal'),
  detail: text,
});

const finalImage = fc.record({
  model: fc.option(text, { nil: null }),
  error: fc.option(text, { nil: null }),
  screenshot: fc.option(bundlePath, { nil: null }),
  box: fc.option(fc.record({ x: num, y: num, width: num, height: num }), { nil: null }),
  signals: fc.record({
    stateReachedDom: fc.option(prob, { nil: null }),
    stateReached: fc.option(prob, { nil: null }),
  }),
});

const runtime = fc.record({
  stopReason: fc.constantFrom('done', 'reached', 'give_up', 'max-steps', 'time-budget', 'aborted'),
});

const reason = fc.constantFrom(
  'stage-error',
  'assessment-missing',
  'not-required',
  'surface-unsupported',
  'evidence-collected',
  'no-observation',
  'evidence-incomplete',
);

const head = {
  schemaVersion: fc.constant('2' as const),
  ceVersion: text,
  jevModels: fc.array(text, { maxLength: 3 }),
  outcomeReason: reason,
  artifacts: fc.array(artifact, { maxLength: 4 }),
  timings,
};

const notRun = (outcome: typeof SKIPPED_O | typeof UNSUPPORTED_O) =>
  fc.record({
    ...head,
    outcome: fc.constant(outcome),
    config,
    context,
    claims: fc.array(claim, { maxLength: 3 }),
    assessment,
    subject: fc.constant(null),
    steps: fc.constant([] as []),
    eventLog: fc.constant([] as []),
    finalImage: fc.constant(null),
    runtime: fc.constant(null),
    finalState: fc.constant(null),
    error: fc.constant(null),
  });

const evidenced = fc.record({
  ...head,
  outcome: fc.constant(EVIDENCED_O),
  config,
  context,
  claims: fc.array(claim, { maxLength: 3 }),
  assessment,
  subject: text,
  steps: fc.array(step, { minLength: 1, maxLength: 3 }),
  eventLog: fc.array(eventLogEntry, { maxLength: 3 }),
  finalImage: fc.option(finalImage, { nil: null }),
  runtime: fc.option(runtime, { nil: null }),
  finalState: fc.constantFrom('reached', 'not_reached'),
  error: fc.constant(null),
});

const errored = fc.record({
  ...head,
  outcome: fc.constant(ERROR_O),
  config: fc.option(config, { nil: null }),
  context: fc.option(context, { nil: null }),
  claims: fc.array(claim, { maxLength: 3 }),
  assessment: fc.option(assessment, { nil: null }),
  subject: fc.option(text, { nil: null }),
  steps: fc.array(step, { maxLength: 3 }),
  eventLog: fc.array(eventLogEntry, { maxLength: 3 }),
  finalImage: fc.option(finalImage, { nil: null }),
  runtime: fc.option(runtime, { nil: null }),
  finalState: fc.constant(null),
  error: fc.record({
    stage: fc.constantFrom('config', 'context', 'assessment', 'runtime', 'evidence'),
    reason,
    causeName: fc.option(text, { nil: null }),
    fields: fc.array(text, { maxLength: 3 }),
  }),
});

export const skippedRunRecordArb: fc.Arbitrary<Variant<typeof SKIPPED_O>> = notRun(SKIPPED_O) as never;
export const unsupportedRunRecordArb: fc.Arbitrary<Variant<typeof UNSUPPORTED_O>> =
  notRun(UNSUPPORTED_O) as never;
export const evidencedRunRecordArb: fc.Arbitrary<Variant<typeof EVIDENCED_O>> = evidenced as never;
export const errorRunRecordArb: fc.Arbitrary<Variant<typeof ERROR_O>> = errored as never;

/** A valid RunRecord of any of the four variants. */
export const runRecordArb: fc.Arbitrary<RunRecord> = fc.oneof(
  skippedRunRecordArb,
  evidencedRunRecordArb,
  unsupportedRunRecordArb,
  errorRunRecordArb,
);

// ---------------------------------------------------------------------------
// Builder-input arbitraries (task 3.4). Follow the outcome/arbitraries.ts style:
// plain generators, no I/O. Outcome values come from OUTCOMES only.
// ---------------------------------------------------------------------------

const STAGES: readonly Stage[] = ['config', 'context', 'assessment', 'runtime', 'evidence'];
const SURFACES: readonly Surface[] = [
  'browser_ui',
  'http_api',
  'cli',
  'backend_internal',
  'native_app',
  'non_runtime',
];

const optionalKeys = <T extends Record<string, fc.Arbitrary<unknown>>>(shape: T, required: (keyof T)[]) =>
  fc.record(shape, { requiredKeys: required as never });

const inputProvenance = provenance as fc.Arbitrary<Provenance>;

/** A StageError with every stage and a cause of varying constructor (or none). */
export const stageErrorArb: fc.Arbitrary<StageError> = fc
  .tuple(
    fc.constantFrom(...STAGES),
    fc.constantFrom<unknown>(new Error('x'), new TypeError('x'), new RangeError('x'), null, undefined, 'str'),
  )
  .map(([stage, cause]) => new StageError(stage, cause));

/** A Resolution whose fields are coherent with SPEC 7.1 (outcome from OUTCOMES). */
export const resolutionArb: fc.Arbitrary<Resolution> = fc
  .tuple(
    fc.constantFrom('stage-error', 'assessment-missing', 'no-observation', 'evidence-incomplete'),
    fc.constantFrom(...STAGES),
    fc.constantFrom<FinalState>('reached', 'not_reached'),
    fc.option(fc.constantFrom(...SURFACES), { nil: undefined }),
    fc.nat({ max: 3 }),
  )
  .map(([errReason, errStage, finalState, surface, pick]): Resolution => {
    const withSurface = <R extends Resolution>(r: R): Resolution =>
      surface === undefined ? r : { ...r, surface };
    switch (pick) {
      case 0:
        return withSurface({ outcome: SKIPPED_O, reason: 'not-required' });
      case 1:
        return withSurface({ outcome: UNSUPPORTED_O, reason: 'surface-unsupported' });
      case 2:
        return withSurface({ outcome: EVIDENCED_O, reason: 'evidence-collected', finalState });
      default:
        return withSurface(
          errReason === 'stage-error'
            ? { outcome: ERROR_O, reason: 'stage-error', errorStage: errStage }
            : { outcome: ERROR_O, reason: errReason as Resolution['reason'] },
        );
    }
  });

const traceStep = fc.record({
  step: nat,
  url: text,
  title: text,
  screenshot: bundlePath,
  action: fc.record({ kind: text, description: text }),
  executed: fc.boolean(),
  probabilities: fc.dictionary(key, num, { maxKeys: 3 }),
  alternatives: fc.array(fc.record({ key, description: text, probability: prob }), { maxLength: 3 }),
});

const traceEvent = fc.record({
  step: nat,
  kind: fc.constantFrom('dialog', 'download', 'popup', 'settle', 'refusal'),
  detail: text,
});

export const runtimeTraceArb: fc.Arbitrary<RuntimeTrace> = optionalKeys(
  {
    steps: fc.array(traceStep, { maxLength: 4 }),
    eventLog: fc.array(traceEvent, { maxLength: 3 }),
    finalScreenshot: bundlePath,
    finalImageModel: text,
    finalImageError: text,
    finalBox: fc.record({ x: num, y: num, width: num, height: num }),
    finalSignals: optionalKeys({ stateReachedDom: prob, stateReached: prob }, []),
    stopReason: fc.constantFrom('done', 'reached', 'give_up', 'max-steps', 'time-budget', 'aborted'),
    modelIds: fc.array(text, { maxLength: 3 }),
  },
  ['steps', 'eventLog', 'stopReason', 'modelIds'],
) as unknown as fc.Arbitrary<RuntimeTrace>;

/** ChangeContext with every field that `buildContext` reads, including patches and commits. */
export const changeContextArb: fc.Arbitrary<ChangeContext> = fc.record({
  change: optionalKeys(
    {
      title: text,
      description: text,
      base: text,
      head: text,
      files: fc.array(
        optionalKeys(
          {
            path: text,
            oldPath: text,
            status: fc.constantFrom('added', 'modified', 'deleted', 'renamed'),
            patch: text,
            provenance: inputProvenance,
          },
          ['path', 'status', 'patch', 'provenance'],
        ),
        { maxLength: 3 },
      ),
      commits: fc.array(fc.record({ sha: text, message: text, provenance: inputProvenance }), {
        maxLength: 3,
      }),
      claims: fc.array(fc.record({ text, provenance: inputProvenance }), { maxLength: 3 }),
      provenance: fc.array(inputProvenance, { maxLength: 3 }),
    },
    ['files', 'commits', 'claims', 'provenance'],
  ),
  candidates: fc.array(fc.record({ id: text, text, provenance: inputProvenance }), { maxLength: 3 }),
  checks: fc.array(
    optionalKeys(
      {
        name: text,
        status: fc.constantFrom('passed', 'failed', 'skipped'),
        covers: fc.array(text, { maxLength: 3 }),
        provenance: inputProvenance,
      },
      ['name', 'status', 'provenance'],
    ),
    { maxLength: 3 },
  ),
  truncated: fc.array(
    fc.record({
      file: text,
      reason: fc.constantFrom('dropped', 'truncated', 'env-file', 'sensitive-file', 'binary', 'candidate-cap', 'check-cap'),
    }),
    { maxLength: 3 },
  ),
  providers: fc.array(
    optionalKeys(
      {
        name: fc.constantFrom('git', 'github', 'cli', 'junit'),
        status: fc.constantFrom('used', 'unavailable'),
        reason: fc.constantFrom('not-a-repository', 'base-unresolved', 'no-input', 'not-configured'),
      },
      ['name', 'status'],
    ),
    { maxLength: 4 },
  ),
  redactions: fc.array(fc.record({ file: text, count: nat }), { maxLength: 3 }),
}) as fc.Arbitrary<ChangeContext>;

const claimInputArb: fc.Arbitrary<Claim> = fc.record({
  id: text,
  text,
  probability: fc.option(prob, { nil: null }),
  declared: fc.boolean(),
  provenance: inputProvenance,
});

const assessmentInputArb: fc.Arbitrary<Assessment> = fc.record({
  claimStatus: fc.constantFrom('identified', 'not_identified'),
  subjects: fc.array(
    fc.record({
      id: text,
      kind: fc.constantFrom('claim', 'change'),
      text,
      provenance: inputProvenance,
    }),
    { maxLength: 3 },
  ),
  perClaim: fc.array(
    fc.record({
      claimId: text,
      runtimeObservable: prob,
      checksAdequate: prob,
      surface: fc.constantFrom(...SURFACES),
      surfaceConfidence: prob,
      needed: fc.boolean(),
      uncertain: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  required: fc.boolean(),
  decidedBy: fc.constantFrom('classifier', 'policy'),
  surface: fc.constantFrom(...SURFACES),
  record: fc.record({
    questions: fc.array(
      optionalKeys(
        { idVersion: text, subjectId: text, probability: prob, probabilities: fc.dictionary(key, prob, { maxKeys: 3 }) },
        ['idVersion', 'subjectId'],
      ),
      { maxLength: 3 },
    ),
    candidates: fc.array(fc.record({ candidateId: text, probability: prob, becameClaim: fc.boolean() }), {
      maxLength: 3,
    }),
    modelIds: fc.array(text, { maxLength: 3 }),
    settings: fc.record({
      claimThreshold: prob,
      observableThreshold: prob,
      adequateThreshold: prob,
      uncertaintyBand: prob,
      onUncertain: fc.constantFrom('evidence', 'skip'),
    }),
    cuts: fc.array(
      fc.record({
        file: text,
        reason: fc.constantFrom('truncated', 'dropped', 'check-cap'),
        isTest: fc.boolean(),
      }),
      { maxLength: 2 },
    ),
  }),
}) as fc.Arbitrary<Assessment>;

const runtimeResultArb: fc.Arbitrary<RuntimeResult> = fc
  .record(
    {
      finalState: fc.constantFrom<FinalState>('reached', 'not_reached'),
      evidence: fc.record({
        change: optionalKeys({ title: text, description: text, base: text, head: text, files: fc.array(text, { maxLength: 3 }) }, ['files']),
        claim: fc.oneof(
          fc.record({ status: fc.constant('identified' as const), id: text, text, provenance: inputProvenance }),
          fc.constant({ status: 'not_identified' as const }),
        ),
        subject: fc.record({ url: text }),
        actions: fc.array(fc.record({ kind: text, description: text }), { maxLength: 3 }),
        observations: fc.array(fc.record({ step: nat, screenshot: bundlePath }), { maxLength: 3 }),
        artifacts: fc.record({ runDir: text, reportPath: text }),
      }),
      trace: runtimeTraceArb,
    },
    { requiredKeys: ['finalState', 'evidence'] },
  ) as fc.Arbitrary<RuntimeResult>;

const partialTraceArb: fc.Arbitrary<PartialTrace> = (() => {
  const element = fc.record({
    ref: fc.nat({ max: 20 }).map((n) => `e${n}`),
    role: text,
    name: text,
    locator: text,
    visible: fc.boolean(),
    enabled: fc.boolean(),
    fixtureKeys: fc.array(key, { maxLength: 2 }),
  });
  const observation = fc.record({
    step: nat,
    url: text,
    title: text,
    domDigest: text,
    elements: fc.array(element, { maxLength: 3 }),
    navigation: fc.array(text, { maxLength: 2 }),
    screenshot: bundlePath,
  });
  const action = fc.oneof(
    fc.record({ kind: fc.constant('click' as const), ref: fc.nat({ max: 20 }).map((n) => `e${n}`) }),
    fc.record({
      kind: fc.constant('fill' as const),
      ref: fc.nat({ max: 20 }).map((n) => `e${n}`),
      fixtureKey: key,
    }),
    fc.record({ kind: fc.constant('goto' as const), url: text }),
    fc.constant({ kind: 'done' as const }),
    fc.constant({ kind: 'give_up' as const, reason: 'invalid-answer' as const }),
  );
  return fc.record({
    observations: fc.array(observation, { maxLength: 3 }),
    steps: fc.array(
      fc.record(
        {
          observation,
          action,
          probabilities: fc.dictionary(key, num, { maxKeys: 3 }),
          executed: fc.boolean(),
        },
        { requiredKeys: ['observation', 'action', 'probabilities'] },
      ),
      { maxLength: 3 },
    ),
    eventLog: fc.array(traceEvent, { maxLength: 3 }),
  }) as fc.Arbitrary<PartialTrace>;
})();

const redactedConfigArb: fc.Arbitrary<RedactedConfig> = fc.record({
  config,
  meta: fc.record({
    fileRead: fc.option(text, { nil: null }),
    fileIgnored: fc.option(text, { nil: null }),
    ignoredEnvNames: fc.array(text, { maxLength: 2 }),
    sources: fc.dictionary(key, fc.constantFrom('flag', 'env', 'file', 'default'), { maxKeys: 3 }),
  }),
  credentials: fc.record({
    provider: fc.constantFrom('openrouter', 'typesafe'),
    envVar: fc.constantFrom('OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'),
  }),
}) as unknown as fc.Arbitrary<RedactedConfig>;

const timingsInputArb = timings as fc.Arbitrary<BuildRunRecordInput['timings']>;
const artifactInputArb = artifact as fc.Arbitrary<BuildRunRecordInput['artifacts'][number]>;

/** Input for `buildRunRecord`. Fields are independent: the builder must cope with any mix. */
export const buildRunRecordInputArb: fc.Arbitrary<BuildRunRecordInput> = fc
  .record(
    {
      resolution: resolutionArb,
      config: fc.option(redactedConfigArb, { nil: null }),
      context: fc.option(changeContextArb, { nil: null }),
      claims: fc.array(claimInputArb, { maxLength: 3 }),
      assessment: fc.option(assessmentInputArb, { nil: null }),
      runtime: fc.option(runtimeResultArb, { nil: null }),
      partialTrace: partialTraceArb,
      error: fc.option(stageErrorArb, { nil: null }),
      validationFields: fc.array(text, { maxLength: 3 }),
      artifacts: fc.array(artifactInputArb, { maxLength: 4 }),
      timings: timingsInputArb,
      ceVersion: text,
    },
    {
      requiredKeys: ['resolution', 'config', 'context', 'claims', 'assessment', 'runtime', 'error', 'artifacts', 'timings'],
    },
  ) as fc.Arbitrary<BuildRunRecordInput>;
