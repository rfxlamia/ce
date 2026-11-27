// Types of the run() vertical slice. Type-only imports from stage modules.
import type { Assessment, Claim, Surface } from '../assessment/index.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { LoadedConfig } from '../config/load.js';
import type { ValidationError } from '../config/errors.js';
import type { ChangeContext } from '../context/types.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import type { StageError } from '../errors.js';
import type { CallLog } from '../jev/log.js';
import type { JevGateway } from '../jev/gateway.js';
import type { Resolution, RuntimeResult } from '../outcome/index.js';

export interface RuntimeHookInput {
  context: ChangeContext;
  claims: Claim[];
  assessment: Assessment;
  config: EffectiveConfig;
  gateway: JevGateway;
  /** Absent when no run directory was computed (a gateway was supplied). */
  runDir?: string;
  signal?: AbortSignal;
}

export type RuntimeHook = (input: RuntimeHookInput) => Promise<RuntimeResult>;

export interface CapabilityEntry {
  name: string;
  surfaces: readonly Surface[];
  run: RuntimeHook;
}

declare const registryBrand: unique symbol;
/** Only createCapabilityRegistry returns this type. */
export type CapabilityRegistry = readonly CapabilityEntry[] & { readonly [registryBrand]: true };

export type CreateGateway = (
  loaded: LoadedConfig,
  env: Record<string, string | undefined>,
  options: { callLog: CallLog },
) => { ok: true; gateway: JevGateway } | { ok: false; errors: ValidationError[] };

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  flags?: Record<string, unknown>;
  cliOptions?: { claim?: string[]; base?: string };
  gateway?: JevGateway;
  createGateway?: CreateGateway;
  capabilities?: CapabilityRegistry;
  contextProviders?: ResolveContextOptions['providers'];
  exec?: ResolveContextOptions['exec'];
  now?: () => Date;
  stderr?: { write(text: string): unknown };
}

export interface ResolvedRun extends Resolution {
  kind: 'resolved';
  exitCode: 0 | 1 | 2 | 3;
  claims?: Claim[];
  assessment?: Assessment;
  error?: StageError;
  /** Name of the capability whose hook was called, when one was. */
  capability?: string;
}

export type RunResult = ResolvedRun;
