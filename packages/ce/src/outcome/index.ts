// Public API of the outcome resolver.
export { resolveOutcome } from './resolve.js';
export { OUTCOMES, V0_SUPPORTED_SURFACES } from './types.js';
export type {
  Outcome,
  FinalState,
  ResolveInput,
  RuntimeResult,
  ResolveReason,
  Resolution,
} from './types.js';
export { satisfiesMinimumEvidence } from './evidence.js';
export type { EvidenceSummary } from './evidence.js';
export { exitCodeFor } from './exit-code.js';
export type { FailOnEntry } from './exit-code.js';
