// Public surface of run/.
export { run, runDirName, finishRun } from './pipeline.js';
export type { FinishRunInput } from './pipeline.js';
export { parseRunArgs, runRunCommand } from './command.js';
export type { ParsedRunArgs, RunCommandDeps } from './command.js';
export {
  createCapabilityRegistry,
  EMPTY_REGISTRY,
  selectCapability,
  supportedSurfaces,
} from './capabilities.js';
export { resolveAfterAssessment, wrapStage } from './resolve.js';
export type { ResolveAfterAssessmentInput } from './resolve.js';
export type {
  CapabilityEntry,
  CapabilityRegistry,
  CreateGateway,
  ResolvedRun,
  RunOptions,
  RunResult,
  RuntimeHook,
  RuntimeHookInput,
} from './types.js';
