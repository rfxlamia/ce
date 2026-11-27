// Decision combination: a pure function of per-Subject probabilities and the
// resolved assessment settings. It never calls Jev, reads the environment or
// the clock, compares a surface with a capability catalog, or maps `required`
// to an Outcome (Decision D6). It does compare each surface with the fixed,
// catalog-independent NON_OBSERVABLE_SURFACES set (issue #31).

import type { Assessment, AssessmentRecord, AssessmentSettings, PerClaimAssessment, Surface } from './types.js';

export interface SubjectProbabilities {
  claimId: string;
  runtimeObservable: number; // [0,1]
  checksAdequate: number; // [0,1]
  surface: Surface;
  surfaceConfidence: number; // [0,1]
}

/**
 * Surfaces for which a passing probability test does not set `needed`.
 * Fixed and independent of the capability catalog (issue #31). The rule
 * ignores `surfaceConfidence`.
 */
export const NON_OBSERVABLE_SURFACES = ['backend_internal', 'non_runtime'] as const satisfies readonly Surface[];

const NON_OBSERVABLE_SET: ReadonlySet<string> = new Set(NON_OBSERVABLE_SURFACES);

function isNonObservableSurface(surface: Surface): surface is (typeof NON_OBSERVABLE_SURFACES)[number] {
  return NON_OBSERVABLE_SET.has(surface);
}

export interface CombineResult {
  perClaim: PerClaimAssessment[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  /** Dominant surface (Decision D7). */
  surface: Surface;
  /** Present only when decidedBy === 'policy'. */
  policyDecision?: Assessment['record']['policyDecision'];
  /** Present only when at least one Subject had `needed` suppressed for its surface. */
  surfaceSuppressed?: AssessmentRecord['surfaceSuppressed'];
}

export function combine(
  subjects: readonly SubjectProbabilities[],
  settings: AssessmentSettings,
): CombineResult {
  const { observableThreshold, adequateThreshold, uncertaintyBand, onUncertain } = settings;

  const probabilityNeeded = (s: SubjectProbabilities): boolean =>
    s.runtimeObservable >= observableThreshold && s.checksAdequate < adequateThreshold;

  const perClaim: PerClaimAssessment[] = subjects.map((s) => {
    const observableUncertain = Math.abs(s.runtimeObservable - observableThreshold) <= uncertaintyBand;
    const adequateUncertain = Math.abs(s.checksAdequate - adequateThreshold) <= uncertaintyBand;
    return {
      claimId: s.claimId,
      runtimeObservable: s.runtimeObservable,
      checksAdequate: s.checksAdequate,
      surface: s.surface,
      surfaceConfidence: s.surfaceConfidence,
      needed: probabilityNeeded(s) && !isNonObservableSurface(s.surface),
      uncertain: observableUncertain || adequateUncertain,
    };
  });

  const surfaceSuppressed: NonNullable<CombineResult['surfaceSuppressed']> = [];
  for (const s of subjects) {
    if (probabilityNeeded(s) && isNonObservableSurface(s.surface)) {
      surfaceSuppressed.push({ subjectId: s.claimId, surface: s.surface });
    }
  }

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

  if (surfaceSuppressed.length > 0) result.surfaceSuppressed = surfaceSuppressed;

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
