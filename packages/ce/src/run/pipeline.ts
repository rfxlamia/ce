// run(): config → context → assessment → capability hook → outcome.
// Decides no Outcome itself: resolveAfterAssessment calls resolveOutcome, exitCodeFor decides the exit code.
import path from 'node:path';
import type { Assessment, Claim } from '../assessment/index.js';
import { assess } from '../assessment/index.js';
import { requireJevCredentials } from '../config/credentials.js';
import { reportConfigFailure } from '../config/errors.js';
import { loadConfig } from '../config/load.js';
import { collectSecretValues } from '../config/secrets.js';
import type { EffectiveConfig } from '../config/schema.js';
import { resolveContext } from '../context/index.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { createJevGateway } from '../jev/gateway.js';
import type { JevGateway } from '../jev/gateway.js';
import { createJsonlCallLog } from '../jev/log.js';
import { exitCodeFor } from '../outcome/index.js';
import type { RuntimeResult } from '../outcome/index.js';
import { EMPTY_REGISTRY, selectCapability } from './capabilities.js';
import { resolveAfterAssessment, wrapStage } from './resolve.js';
import type {
  CapabilityRegistry,
  CreateGateway,
  ResolvedRun,
  RunOptions,
  RunResult,
} from './types.js';

type Writable = { write(text: string): unknown };

interface RunDefaults {
  cwd: string;
  env: Record<string, string | undefined>;
  flags: Record<string, unknown>;
  cliOptions: { claim?: string[]; base?: string };
  createGateway: CreateGateway;
  capabilities: CapabilityRegistry;
  now: () => Date;
  stderr: Writable;
}

/** `run-<iso>` with ':' and '.' replaced by '-'. */
export function runDirName(date: Date): string {
  return `run-${date.toISOString().replace(/[:.]/g, '-')}`;
}

/** The only place that reads process.env, process.cwd(), process.stderr and the clock. */
function withDefaults(options: RunOptions): RunDefaults {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    flags: options.flags ?? {},
    cliOptions: options.cliOptions ?? {},
    createGateway: options.createGateway ?? createJevGateway,
    capabilities: options.capabilities ?? EMPTY_REGISTRY,
    now: options.now ?? (() => new Date()),
    stderr: options.stderr ?? process.stderr,
  };
}

export interface FinishRunInput {
  config: EffectiveConfig;
  registry: CapabilityRegistry;
  claims?: Claim[];
  assessment?: Assessment;
  runtime?: RuntimeResult;
  error?: StageError;
  capability?: string;
}

/** Resolves once and attaches the exit code from exitCodeFor. */
export function finishRun(input: FinishRunInput): ResolvedRun {
  const resolveInput: Parameters<typeof resolveAfterAssessment>[0] = { registry: input.registry };
  if (input.assessment !== undefined) resolveInput.assessment = input.assessment;
  if (input.runtime !== undefined) resolveInput.runtime = input.runtime;
  if (input.error !== undefined) resolveInput.error = input.error;
  const resolution = resolveAfterAssessment(resolveInput);
  const exitCode = exitCodeFor(resolution, input.config.output?.['fail-on']);
  const result: ResolvedRun = { kind: 'resolved', ...resolution, exitCode };
  if (input.claims !== undefined) result.claims = input.claims;
  if (input.assessment !== undefined) result.assessment = input.assessment;
  if (input.error !== undefined) result.error = input.error;
  if (input.capability !== undefined) result.capability = input.capability;
  return result;
}

export async function run(options: RunOptions = {}): Promise<RunResult> {
  const o = withDefaults(options);

  const loaded = loadConfig({ cwd: o.cwd, flags: o.flags, env: o.env });
  if (!loaded.ok) {
    reportConfigFailure(loaded, collectSecretValues(o.env), o.stderr);
    return configFailure(loaded);
  }
  const config = loaded.config;

  let gateway: JevGateway;
  let runDir: string | undefined;
  if (options.gateway !== undefined) {
    gateway = options.gateway;
  } else {
    const credentials = requireJevCredentials(loaded, o.env);
    if (!credentials.ok) {
      reportConfigFailure(credentials, collectSecretValues(o.env), o.stderr);
      return configFailure(credentials);
    }
    runDir = path.resolve(o.cwd, config.output?.dir ?? '.ce/runs', runDirName(o.now()));
    const created = o.createGateway(loaded, o.env, {
      callLog: createJsonlCallLog(path.join(runDir, 'jev-calls.jsonl')),
    });
    if (!created.ok) {
      reportConfigFailure({ ok: false, errors: created.errors }, collectSecretValues(o.env), o.stderr);
      return configFailure(created);
    }
    gateway = created.gateway;
  }

  let context: ChangeContext;
  try {
    context = resolveContext({
      config,
      cliOptions: o.cliOptions,
      env: o.env,
      cwd: o.cwd,
      ...(options.contextProviders !== undefined ? { providers: options.contextProviders } : {}),
      ...(options.exec !== undefined ? { exec: options.exec } : {}),
    });
  } catch (e) {
    return finishRun({ config, registry: o.capabilities, error: wrapStage('context', e) });
  }

  let claims: Claim[];
  let assessment: Assessment;
  try {
    ({ claims, assessment } = await assess(context, config, gateway));
  } catch (e) {
    return finishRun({ config, registry: o.capabilities, error: wrapStage('assessment', e) });
  }

  const entry = selectCapability(assessment, o.capabilities);
  if (entry === undefined) {
    return finishRun({ config, registry: o.capabilities, claims, assessment });
  }

  // Runtime_Hook call site: the capability runtime of issues #9 and #10 plugs in here.
  try {
    const runtime = await entry.run({
      context,
      claims,
      assessment,
      config,
      gateway,
      ...(runDir !== undefined ? { runDir } : {}),
    });
    return finishRun({ config, registry: o.capabilities, claims, assessment, runtime, capability: entry.name });
  } catch (e) {
    return finishRun({
      config,
      registry: o.capabilities,
      claims,
      assessment,
      error: wrapStage('runtime', e),
      capability: entry.name,
    });
  }
}

/**
 * A config failure is still a run (SPEC 7.1): it resolves to ERROR through
 * resolveOutcome with a Stage_Error for the 'config' stage. The failure report
 * has already gone to stderr; the config is unavailable, so the default
 * fail-on list applies.
 */
function configFailure(cause: unknown): ResolvedRun {
  const error = new StageError('config', cause);
  const resolution = resolveAfterAssessment({ registry: EMPTY_REGISTRY, error });
  return { kind: 'resolved', ...resolution, exitCode: exitCodeFor(resolution, undefined), error };
}
