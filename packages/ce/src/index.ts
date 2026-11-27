/**
 * Continuous Evidence — core entry point.
 *
 * `run()` implements the vertical slice: Context Resolver → Assessment Engine
 * → Capability Runtime → Evidence Output (SPEC.md §4.2). It resolves
 * configuration and context, assesses claims through Jev, selects a registered
 * capability by Surface, and resolves exactly one outcome
 * (SKIPPED | EVIDENCED | UNSUPPORTED | ERROR) in `outcome/resolve.ts`.
 *
 * Open part: the Runtime_Hook. The capability registry is empty by default, so
 * a run that needs runtime evidence resolves to UNSUPPORTED until a capability
 * registers a hook through `createCapabilityRegistry`.
 */

export const VERSION = '0.1.0';

export { run } from './run/index.js';
export { createCapabilityRegistry, EMPTY_REGISTRY, selectCapability } from './run/index.js';
export type {
  CapabilityEntry,
  CapabilityRegistry,
  ResolvedRun,
  RunOptions,
  RunResult,
  RuntimeHook,
  RuntimeHookInput,
} from './run/index.js';

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
