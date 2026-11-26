// Assessor and public entry point of the Claims and Assessment stage.
// It asks Jev only through the JevGateway interface and the request builders, reads
// probabilities only, and never decides an Outcome. Any failure leaves as
// StageError('assessment', cause); no partial result is returned.

import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS, buildAssessmentRequest } from '../jev/catalog.js';
import type { JevGateway } from '../jev/gateway.js';
import { argmaxSurface, readChoice, readNoul } from './answers.js';
import { combine, type SubjectProbabilities } from './combine.js';
import { identifyClaims } from './claims.js';
import type {
  AssessedSubject,
  Assessment,
  AssessmentRecord,
  AssessmentSettings,
  Claim,
  Cut,
} from './types.js';

export interface AssessOptions {
  /** Test seam for resolveAssessmentSettings. Production code omits it. */
  defaults?: EffectiveConfig;
}

/**
 * Resolve the effective assessment settings. Each value falls back to `defaults`
 * on its own. This is the only function that reads the `assessment` config key.
 */
export function resolveAssessmentSettings(
  config: EffectiveConfig,
  defaults: EffectiveConfig = ConfigDefaults,
): AssessmentSettings {
  const pick = <T>(name: string, fromConfig: T | undefined, fromDefaults: T | undefined): T => {
    const value = fromConfig ?? fromDefaults;
    if (value === undefined) {
      throw new StageError(
        'assessment',
        new Error(`assessment setting "${name}" is missing from the config and from the defaults`),
      );
    }
    return value;
  };
  const c = config.assessment;
  const d = defaults.assessment;
  return {
    claimThreshold: pick('thresholds.claim', c?.thresholds?.claim, d?.thresholds?.claim),
    observableThreshold: pick(
      'thresholds.observable',
      c?.thresholds?.observable,
      d?.thresholds?.observable,
    ),
    adequateThreshold: pick('thresholds.adequate', c?.thresholds?.adequate, d?.thresholds?.adequate),
    uncertaintyBand: pick('uncertainty-band', c?.['uncertainty-band'], d?.['uncertainty-band']),
    onUncertain: pick('on-uncertain', c?.['on-uncertain'], d?.['on-uncertain']),
  };
}

function firstNonBlankLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return undefined;
}

/**
 * Pick the Change_Subject: title, then description, then the first commit message
 * that has a non-blank line. Throws StageError when no source has one (Decision D8).
 */
export function selectChangeSubject(context: ChangeContext): AssessedSubject {
  const githubProvenance = (location: string): AssessedSubject['provenance'] =>
    context.change.provenance.find((p) => p.provider === 'github') ?? {
      provider: 'github',
      location,
    };

  const title = firstNonBlankLine(context.change.title);
  if (title !== undefined) {
    return { id: 'change', kind: 'change', text: title, provenance: githubProvenance('title') };
  }
  const description = firstNonBlankLine(context.change.description);
  if (description !== undefined) {
    return {
      id: 'change',
      kind: 'change',
      text: description,
      provenance: githubProvenance('description'),
    };
  }
  for (const commit of context.change.commits) {
    const line = firstNonBlankLine(commit.message);
    if (line !== undefined) {
      return { id: 'change', kind: 'change', text: line, provenance: commit.provenance };
    }
  }
  throw new StageError(
    'assessment',
    new Error('no claim identified and no title, description or commit message to assess'),
  );
}

export async function assess(
  context: ChangeContext,
  config: EffectiveConfig,
  gateway: JevGateway,
  options?: AssessOptions,
): Promise<{ claims: Claim[]; assessment: Assessment }> {
  try {
    return await assessUnsafe(context, config, gateway, options);
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError('assessment', error);
  }
}

async function assessUnsafe(
  context: ChangeContext,
  config: EffectiveConfig,
  gateway: JevGateway,
  options?: AssessOptions,
): Promise<{ claims: Claim[]; assessment: Assessment }> {
  const settings =
    options?.defaults === undefined
      ? resolveAssessmentSettings(config)
      : resolveAssessmentSettings(config, options.defaults);

  const classified = await identifyClaims(context, settings, gateway);
  const claims = classified.claims;
  const claimStatus: Assessment['claimStatus'] = claims.length > 0 ? 'identified' : 'not_identified';

  const subjects: AssessedSubject[] =
    claims.length > 0
      ? claims.map((c) => ({
          id: c.id,
          kind: 'claim' as const,
          text: c.text,
          provenance: c.provenance,
        }))
      : [selectChangeSubject(context)];

  const questions: AssessmentRecord['questions'] = [...classified.questionsAsked];
  const modelIds: string[] = [...classified.modelIds];
  const cuts: Cut[] = [...classified.cuts];
  const probabilities: SubjectProbabilities[] = [];

  for (const subject of subjects) {
    const { request, cuts: requestCuts } = buildAssessmentRequest(context, subject);
    cuts.push(...requestCuts);
    const response = await gateway.ask(request);

    const runtimeObservable = readNoul(response.answers['runtime_observable']);
    const checksAdequate = readNoul(response.answers['checks_adequate']);
    const surfaceProbabilities = readChoice(response.answers['surface'], SURFACE_LABELS);
    const { surface, confidence } = argmaxSurface(surfaceProbabilities);

    if (!modelIds.includes(response.model)) modelIds.push(response.model);
    questions.push(
      {
        idVersion: request.questions['runtime_observable']!.idVersion,
        subjectId: subject.id,
        probability: runtimeObservable,
      },
      {
        idVersion: request.questions['checks_adequate']!.idVersion,
        subjectId: subject.id,
        probability: checksAdequate,
      },
      {
        idVersion: request.questions['surface']!.idVersion,
        subjectId: subject.id,
        probabilities: { ...surfaceProbabilities },
      },
    );
    probabilities.push({
      claimId: subject.id,
      runtimeObservable,
      checksAdequate,
      surface,
      surfaceConfidence: confidence,
    });
  }

  const combined = combine(probabilities, settings);

  const record: AssessmentRecord = {
    questions,
    candidates: classified.classifications,
    modelIds,
    settings,
    cuts,
  };
  if (combined.policyDecision !== undefined) record.policyDecision = combined.policyDecision;

  return {
    claims,
    assessment: {
      claimStatus,
      subjects,
      perClaim: combined.perClaim,
      required: combined.required,
      decidedBy: combined.decidedBy,
      surface: combined.surface,
      record,
    },
  };
}
