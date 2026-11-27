// Post_Assessment_Resolver: the only caller of resolveOutcome in the run pipeline.
// Pure: reads no gateway, no clock and no capability hook.
import type { Assessment } from '../assessment/index.js';
import { StageError } from '../errors.js';
import type { Stage } from '../errors.js';
import { resolveOutcome } from '../outcome/index.js';
import type { Resolution, ResolveInput, RuntimeResult } from '../outcome/index.js';
import { supportedSurfaces } from './capabilities.js';
import type { CapabilityRegistry } from './types.js';

export interface ResolveAfterAssessmentInput {
  assessment?: Assessment;
  registry: CapabilityRegistry;
  runtime?: RuntimeResult;
  error?: StageError;
}

export function resolveAfterAssessment(input: ResolveAfterAssessmentInput): Resolution {
  const resolveInput: ResolveInput = {
    supportedSurfaces: supportedSurfaces(input.registry),
  };
  if (input.assessment !== undefined) resolveInput.assessment = input.assessment;
  if (input.runtime !== undefined) resolveInput.runtime = input.runtime;
  if (input.error !== undefined) resolveInput.error = input.error;
  return resolveOutcome(resolveInput);
}

/** Returns a StageError unchanged; wraps anything else without copying the cause's message. */
export function wrapStage(stage: Stage, thrown: unknown): StageError {
  if (thrown instanceof StageError) return thrown;
  return new StageError(stage, thrown);
}
