// Decision combination: a pure function of per-Subject probabilities and the
// resolved assessment settings. It never calls Jev, reads the environment or
// the clock, compares a surface with a capability catalog, or maps `required`
// to an Outcome (Decision D6).

import type { Assessment, AssessmentSettings, PerClaimAssessment, Surface } from './types.js';

export interface SubjectProbabilities {
  claimId: string;
  runtimeObservable: number; // [0,1]
  checksAdequate: number; // [0,1]
  surface: Surface;
  surfaceConfidence: number; // [0,1]
}

export interface CombineResult {
  perClaim: PerClaimAssessment[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  /** Dominant surface (Decision D7). */
  surface: Surface;
  /** Present only when decidedBy === 'policy'. */
  policyDecision?: Assessment['record']['policyDecision'];
}

export function combine(
  subjects: readonly SubjectProbabilities[],
  settings: AssessmentSettings,
): CombineResult {
  const { observableThreshold, adequateThreshold, uncertaintyBand, onUncertain } = settings;

  const perClaim: PerClaimAssessment[] = subjects.map((s) => {
    const observableUncertain = Math.abs(s.runtimeObservable - observableThreshold) <= uncertaintyBand;
    const adequateUncertain = Math.abs(s.checksAdequate - adequateThreshold) <= uncertaintyBand;
    return {
      claimId: s.claimId,
      runtimeObservable: s.runtimeObservable,
      checksAdequate: s.checksAdequate,
      surface: s.surface,
      surfaceConfidence: s.surfaceConfidence,
      needed: s.runtimeObservable >= observableThreshold && s.checksAdequate < adequateThreshold,
      uncertain: observableUncertain || adequateUncertain,
    };
  });

  const anyNeeded = perClaim.some((p) => p.needed);
  const anyUncertain = perClaim.some((p) => p.uncertain);

  const decidedBy: 'classifier' | 'policy' = !anyNeeded && anyUncertain ? 'policy' : 'classifier';
  const required = anyNeeded || (anyUncertain && onUncertain === 'evidence');

  const result: CombineResult = {
    perClaim,
    required,
    decidedBy,
    surface: dominantSurface(perClaim),
  };

  if (decidedBy === 'policy') {
    const inBand: NonNullable<Assessment['record']['policyDecision']>['inBand'] = [];
    for (const s of subjects) {
      if (Math.abs(s.runtimeObservable - observableThreshold) <= uncertaintyBand) {
        inBand.push({ subjectId: s.claimId, probability: 'runtimeObservable' });
      }
      if (Math.abs(s.checksAdequate - adequateThreshold) <= uncertaintyBand) {
        inBand.push({ subjectId: s.claimId, probability: 'checksAdequate' });
      }
    }
    result.policyDecision = { policy: onUncertain, inBand };
  }

  return result;
}

/** D7: highest surfaceConfidence among driving subjects; ties go to the earliest. */
function dominantSurface(perClaim: readonly PerClaimAssessment[]): Surface {
  if (perClaim.length === 0) return 'non_runtime';
  const driving = perClaim.filter((p) => p.needed || p.uncertain);
  const pool = driving.length > 0 ? driving : perClaim;
  let best = pool[0]!;
  for (const p of pool) {
    if (p.surfaceConfidence > best.surfaceConfidence) best = p;
  }
  return best.surface;
}
