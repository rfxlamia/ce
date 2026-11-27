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

export { VERSION } from './version.js';

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
export { ENV_KEY_MAP, envNameForPath } from './config/env.js';
export { collectSecretValues, redactSecretValues } from './config/secrets.js';
export { requireJevCredentials } from './config/credentials.js';
export type { ConfigMeta, LoadedConfig } from './config/load.js';
export type { EffectiveConfig } from './config/schema.js';

export { createJevGateway } from './jev/gateway.js';
export type { AskOptions, JevGateway } from './jev/gateway.js';
export { FakeJevGateway, FakeRecordingMissingError } from './jev/fake.js';
export { JevImageError, JevUsageError, RateLimitError } from './jev/errors.js';
export { StageError } from './errors.js';

export { RunRecordSchema, SCHEMA_VERSION } from './evidence/schema.js';
export type { RunRecord } from './evidence/schema.js';
export { COMMENT_MARKER, renderPrComment, stripCommentMarker } from './evidence/comment.js';
export type { CommentInput, UnavailableRecord } from './evidence/comment.js';
export { buildSummary } from './evidence/summary.js';
export type { SummaryInput } from './evidence/summary.js';
export { writeBundle, writeMinimalBundle, RunRecordValidationError } from './evidence/bundle.js';
export type {
  BundleFs,
  WriteBundleInput,
  WriteBundleResult,
  WriteMinimalBundleInput,
  WriteTimings,
} from './evidence/bundle.js';
export type {
  RuntimeTrace,
  RuntimeTraceEvent,
  RuntimeTraceStep,
  StopReason,
} from './evidence/trace.js';

export { resolveOutcome, exitCodeFor, OUTCOMES } from './outcome/index.js';
export type {
  Outcome,
  Outcome as ExecutionOutcome,
  Resolution,
  ResolveInput,
} from './outcome/index.js';
