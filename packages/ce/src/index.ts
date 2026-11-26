/**
 * Continuous Evidence — core entry point.
 *
 * v0 implementation spike (Milestone 1: Prove the Concept).
 * The pipeline follows the four core responsibilities defined in SPEC.md §4.2:
 *
 *   Context Resolver → Assessment Engine → Capability Runtime → Evidence Output
 *
 * Internal structure is intentionally minimal until the first end-to-end
 * evidence run demonstrates which module boundaries are actually needed.
 */

import type { Outcome as ExecutionOutcome } from './outcome/index.js';

export const VERSION = '0.1.0';

/**
 * Runs the CE pipeline for the current change context.
 *
 * Outcome contract (SPEC.md §7.1): every run MUST resolve to exactly one of
 * SKIPPED | EVIDENCED | UNSUPPORTED | ERROR.
 */
export interface RunResult {
  outcome: ExecutionOutcome;
}

export async function run(): Promise<RunResult> {
  // TODO(Milestone 1): implement the vertical slice.
  // Hypothesis under test: Jev + generic browser capabilities can produce
  // relevant runtime evidence for a software change, without a generative
  // agent harness.
  throw new Error('CE v0 implementation spike: not implemented yet');
}

export { loadConfig } from './config/load.js';
export { requireJevCredentials } from './config/credentials.js';
export type { ConfigMeta, LoadedConfig } from './config/load.js';
export type { EffectiveConfig } from './config/schema.js';

export { createJevGateway } from './jev/gateway.js';
export type { AskOptions, JevGateway } from './jev/gateway.js';
export { FakeJevGateway, FakeRecordingMissingError } from './jev/fake.js';
export { JevImageError, JevUsageError, RateLimitError } from './jev/errors.js';
export { StageError } from './errors.js';

export { resolveOutcome, exitCodeFor, OUTCOMES } from './outcome/index.js';
export type {
  Outcome,
  Outcome as ExecutionOutcome,
  Resolution,
  ResolveInput,
} from './outcome/index.js';
