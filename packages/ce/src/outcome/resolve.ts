// The single place where CE decides the execution outcome (SPEC 7.1).
// Seven ordered early returns (Decision D3). Pure, total, no mutation.
// Reads only error.stage, assessment.required, assessment.surface and runtime.

import type { Surface } from '../assessment/index.js';
import { satisfiesMinimumEvidence } from './evidence.js';
import { V0_SUPPORTED_SURFACES } from './types.js';
import type { Resolution, ResolveInput } from './types.js';

export function resolveOutcome(input: ResolveInput): Resolution {
  const supported: readonly Surface[] = input.supportedSurfaces ?? V0_SUPPORTED_SURFACES;
  const { error, assessment, runtime } = input;
  const surface = assessment?.surface;

  // 1. A stage error always wins.
  if (error !== undefined) {
    const resolution: Resolution = {
      outcome: 'ERROR',
      reason: 'stage-error',
      errorStage: error.stage,
    };
    if (surface !== undefined) resolution.surface = surface;
    return resolution;
  }

  // 2. No assessment: the pipeline did not produce one.
  if (assessment === undefined) {
    return { outcome: 'ERROR', reason: 'assessment-missing' };
  }

  // 3. Evidence not required.
  if (!assessment.required) {
    return { outcome: 'SKIPPED', reason: 'not-required', surface: assessment.surface };
  }

  // 4. Required, but the dominant surface is outside the capability catalog.
  if (!supported.includes(assessment.surface)) {
    return { outcome: 'UNSUPPORTED', reason: 'surface-unsupported', surface: assessment.surface };
  }

  // 5. Required and supported, but nothing was observed.
  if (runtime === undefined || runtime.evidence.observations.length === 0) {
    return { outcome: 'ERROR', reason: 'no-observation', surface: assessment.surface };
  }

  // 6. Observed, but the SPEC 7.2 minimum evidence is missing.
  if (!satisfiesMinimumEvidence(runtime.evidence)) {
    return { outcome: 'ERROR', reason: 'evidence-incomplete', surface: assessment.surface };
  }

  // 7. Evidence collected.
  return {
    outcome: 'EVIDENCED',
    reason: 'evidence-collected',
    finalState: runtime.finalState,
    surface: assessment.surface,
  };
}
