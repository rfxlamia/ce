// Eval_Runner (Requirements 12.1-12.11, 13.1-13.9, 13.12, 13.13; Decisions D9, D10, D17).
// Asks the labelled questions through the same request builders and answer readers as the
// Assessor, compares probabilities with the effective thresholds, and builds the two aggregate
// rows only from assess() output. It never decides an Outcome and never reads the environment.

import { argmaxSurface, readChoice, readNoul } from '../assessment/answers.js';
import { assess, resolveAssessmentSettings } from '../assessment/assess.js';
import type {
  AssessmentSettings,
  Cut,
  PerClaimAssessment,
  Surface,
} from '../assessment/types.js';
import type { EffectiveConfig } from '../config/schema.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS, buildAssessmentRequest, buildClassificationRequest } from '../jev/catalog.js';
import type { JevGateway } from '../jev/gateway.js';
import {
  buildBuckets,
  buildRow,
  type AgreementRow,
  type BucketRow,
  type Disagreement,
  type EvalSample,
  type RowSample,
} from './agreement.js';
import { loadFixtures, type LoadFixturesFailure } from './fixture.js';
import { EvalMemoGateway } from './memo.js';
import { buildFixtureContext, type FixtureProvidersOverride } from './providers.js';

export interface EvalRunOptions {
  fixturesDir: string;
  config: EffectiveConfig;
  /** Wrapped in one EvalMemoGateway by runEval. */
  gateway: JevGateway;
  /** Test seam: replaces fixture providers while building contexts. Production code omits it. */
  providersOverride?: FixtureProvidersOverride;
}

/** Per-fixture copy of the assess() output (never recomputed in eval). */
export interface FixtureAssessmentSummary {
  fixtureId: string;
  claimStatus: 'identified' | 'not_identified';
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  surface: Surface;
  perClaim: PerClaimAssessment[];
  cuts: Cut[];
}

export interface EvalResult {
  rows: AgreementRow[];
  disagreements: Disagreement[];
  /** Every sample of every row, agreeing or not. */
  samples: EvalSample[];
  /** One summary of the assess() output per fixture. */
  assessments: FixtureAssessmentSummary[];
  /** The assessment.required row split by Assessment.decidedBy. */
  requiredByDecidedBy: BucketRow[];
  modelIds: string[];
  fixtureCount: number;
  settings: AssessmentSettings;
  requests: number;
  memoHits: number;
}

export type EvalRunOutcome =
  | { ok: true; result: EvalResult }
  | Exclude<LoadFixturesFailure, { kind: 'context' }>
  | { ok: false; stageError: StageError };

type Sample<T> = RowSample<T>;

export async function runEval(options: EvalRunOptions): Promise<EvalRunOutcome> {
  const loaded = loadFixtures(options.fixturesDir);
  if (!loaded.ok) {
    if (loaded.kind === 'context') return { ok: false, stageError: loaded.error };
    return loaded;
  }

  let settings: AssessmentSettings;
  try {
    settings = resolveAssessmentSettings(options.config);
  } catch (cause) {
    return { ok: false, stageError: toStageError(cause, 'assessment') };
  }

  // Build every context before the first Jev question (Requirement 12.10).
  const fixtures = [...loaded.fixtures].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const contexts = [];
  for (const { id, file } of fixtures) {
    try {
      const built = buildFixtureContext(file, {
        config: options.config,
        env: {},
        ...(options.providersOverride !== undefined
          ? { providersOverride: options.providersOverride }
          : {}),
      });
      if (built.execCalls.length > 0) {
        return {
          ok: false,
          stageError: new StageError(
            'context',
            new Error(`fixture "${id}": resolveContext called exec ${built.execCalls.length} time(s)`),
          ),
        };
      }
      contexts.push(built.context);
    } catch (cause) {
      return { ok: false, stageError: toStageError(cause, 'context') };
    }
  }

  const gateway = new EvalMemoGateway(options.gateway);
  const modelIds: string[] = [];
  const noteModel = (model: string): void => {
    if (!modelIds.includes(model)) modelIds.push(model);
  };

  const isBehavior: Sample<boolean>[] = [];
  const observable: Sample<boolean>[] = [];
  const adequate: Sample<boolean>[] = [];
  const surface: Sample<string>[] = [];
  const required: Sample<boolean>[] = [];
  const requiredBuckets: { bucket: string; predicted: boolean; label: boolean }[] = [];
  const assessments: FixtureAssessmentSummary[] = [];
  const claimStatus: Sample<string>[] = [];

  try {
    for (const [index, { id, file }] of fixtures.entries()) {
      const context = contexts[index]!;
      const { labels } = file;

      for (const candidate of context.candidates) {
        const isCli = candidate.provenance.provider === 'cli';
        let ask = isCli;

        if (!isCli) {
          const { request } = buildClassificationRequest(context, candidate);
          const response = await gateway.ask(request);
          noteModel(response.model);
          const p = readNoul(response.answers['is_behavior']);
          const label = labels.isBehavior[candidate.text];
          if (label !== undefined) {
            isBehavior.push({
              fixtureId: id,
              subject: candidate.text,
              predicted: p >= settings.claimThreshold,
              probability: p,
              threshold: settings.claimThreshold,
              label,
            });
          }
          ask = label === true;
        }
        if (!ask) continue;

        const { request } = buildAssessmentRequest(context, candidate);
        const response = await gateway.ask(request);
        noteModel(response.model);
        const pObservable = readNoul(response.answers['runtime_observable']);
        const pAdequate = readNoul(response.answers['checks_adequate']);
        const { surface: predictedSurface, confidence: surfaceConfidence } = argmaxSurface(
          readChoice(response.answers['surface'], SURFACE_LABELS),
        );
        const labelObservable = labels.runtimeObservable[candidate.text];
        const labelAdequate = labels.checksAdequate[candidate.text];
        const labelSurface: Surface | undefined = labels.surface[candidate.text];
        if (labelObservable !== undefined) {
          observable.push({
            fixtureId: id,
            subject: candidate.text,
            predicted: pObservable >= settings.observableThreshold,
            probability: pObservable,
            threshold: settings.observableThreshold,
            label: labelObservable,
          });
        }
        if (labelAdequate !== undefined) {
          adequate.push({
            fixtureId: id,
            subject: candidate.text,
            predicted: pAdequate >= settings.adequateThreshold,
            probability: pAdequate,
            threshold: settings.adequateThreshold,
            label: labelAdequate,
          });
        }
        if (labelSurface !== undefined) {
          surface.push({
            fixtureId: id,
            subject: candidate.text,
            predicted: predictedSurface,
            confidence: surfaceConfidence,
            label: labelSurface,
          });
        }
      }

      const { assessment } = await assess(context, options.config, gateway);
      required.push({
        fixtureId: id,
        subject: 'change',
        predicted: assessment.required,
        label: labels.required,
      });
      requiredBuckets.push({
        bucket: assessment.decidedBy,
        predicted: assessment.required,
        label: labels.required,
      });
      assessments.push({
        fixtureId: id,
        claimStatus: assessment.claimStatus,
        required: assessment.required,
        decidedBy: assessment.decidedBy,
        surface: assessment.surface,
        perClaim: assessment.perClaim.map((c) => ({ ...c })),
        cuts: assessment.record.cuts.map((c) => ({ ...c })),
      });
      claimStatus.push({
        fixtureId: id,
        subject: 'change',
        predicted: assessment.claimStatus,
        label: labels.claimStatus,
      });
      for (const model of assessment.record.modelIds) noteModel(model);
    }
  } catch (cause) {
    return { ok: false, stageError: toStageError(cause, 'assessment') };
  }

  const same = <T>(a: T, b: T): boolean => a === b;
  const built = [
    buildRow('claim.is_behavior', isBehavior, same),
    buildRow('assess.runtime_observable', observable, same),
    buildRow('assess.checks_adequate', adequate, same),
    buildRow('assess.surface', surface, same),
    buildRow('assessment.required', required, same),
    buildRow('assessment.claimStatus', claimStatus, same),
  ];

  return {
    ok: true,
    result: {
      rows: built.map((b) => b.row),
      disagreements: built.flatMap((b) => b.disagreements),
      samples: built.flatMap((b) => b.samples),
      assessments,
      requiredByDecidedBy: buildBuckets(requiredBuckets),
      modelIds,
      fixtureCount: fixtures.length,
      settings,
      requests: gateway.stats.requests,
      memoHits: gateway.stats.memoHits,
    },
  };
}

function toStageError(cause: unknown, stage: 'context' | 'assessment'): StageError {
  return cause instanceof StageError ? cause : new StageError(stage, cause);
}
