// run(): config → context → assessment → capability hook → outcome → evidence bundle.
// Decides no Outcome itself: resolveAfterAssessment calls resolveOutcome, exitCodeFor decides the exit code.
// run() never throws: every stage failure becomes a StageError and, where possible, a bundle on disk.
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { Assessment, Claim } from '../assessment/index.js';
import { assess } from '../assessment/index.js';
import { requireJevCredentials } from '../config/credentials.js';
import { reportConfigFailure } from '../config/errors.js';
import { loadConfig } from '../config/load.js';
import type { LoadFailure, RedactedConfig } from '../config/load.js';
import { collectSecretValues, redactSecretValues } from '../config/secrets.js';
import type { EffectiveConfig } from '../config/schema.js';
import { resolveContext } from '../context/index.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import type { Stage } from '../errors.js';
import { causeNameOf } from '../evidence/build.js';
import type { PartialTrace } from '../evidence/build.js';
import { writeBundle, writeMinimalBundle } from '../evidence/bundle.js';
import type { BundleFs, WriteBundleInput, WriteBundleResult } from '../evidence/bundle.js';
import { createJevGateway } from '../jev/gateway.js';
import type { JevGateway } from '../jev/gateway.js';
import { createJsonlCallLog } from '../jev/log.js';
import { exitCodeFor } from '../outcome/index.js';
import type { Resolution, RuntimeResult } from '../outcome/index.js';
import { createBrowserCapability } from '../runtime/capability.js';
import { LoopStageError } from '../runtime/loop.js';
import { openTarget } from '../runtime/target.js';
import { createCapabilityRegistry, EMPTY_REGISTRY, selectCapability } from './capabilities.js';
import { resolveAfterAssessment, wrapStage } from './resolve.js';
import type {
  CapabilityRegistry,
  CreateGateway,
  ResolvedRun,
  ResolvedRunWithBundle,
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
  fs: BundleFs;
}

/** `run-<iso>` with ':' and '.' replaced by '-'. */
export function runDirName(date: Date): string {
  return `run-${date.toISOString().replace(/[:.]/g, '-')}`;
}

/** The only place that reads process.env, process.cwd(), process.stderr and the clock. */
function withDefaults(options: RunOptions): RunDefaults {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  return {
    cwd,
    env,
    flags: options.flags ?? {},
    cliOptions: options.cliOptions ?? {},
    createGateway: options.createGateway ?? createJevGateway,
    // Playwright is imported lazily inside the capability, never here.
    capabilities:
      options.capabilities ?? createCapabilityRegistry([createBrowserCapability({ cwd, env, openTarget })]),
    now: options.now ?? (() => new Date()),
    stderr: options.stderr ?? process.stderr,
    fs: options.bundleFs ?? fsPromises,
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

// ---------------------------------------------------------------------------
// Run state: everything the bundle writer and the outermost catch need.
// ---------------------------------------------------------------------------

type TimedStage = 'config' | 'context' | 'assessment' | 'runtime';

interface RunState {
  lastStage: Stage;
  startedAt: Date;
  stages: Record<TimedStage, number | null>;
  secrets: string[];
  effective: EffectiveConfig | null;
  redacted: RedactedConfig | null;
  runDir: string | null;
  context: ChangeContext | null;
  claims: Claim[];
  assessment: Assessment | null;
  runtime: RuntimeResult | null;
  partial: PartialTrace | undefined;
  /** The last resolution produced. Set right after each resolveOutcome call. */
  final: ResolvedRun | undefined;
}

function newState(o: RunDefaults): RunState {
  let secrets: string[] = [];
  try {
    secrets = collectSecretValues(o.env);
  } catch {
    secrets = [];
  }
  let startedAt: Date;
  try {
    startedAt = o.now();
  } catch {
    startedAt = new Date(0);
  }
  return {
    lastStage: 'config',
    startedAt,
    stages: { config: null, context: null, assessment: null, runtime: null },
    secrets,
    effective: null,
    redacted: null,
    runDir: null,
    context: null,
    claims: [],
    assessment: null,
    runtime: null,
    partial: undefined,
    final: undefined,
  };
}

/** Starts a stage timer with the injected clock. The returned function records the duration. */
function startTimer(o: RunDefaults, st: RunState, key: TimedStage): () => void {
  const t0 = o.now().getTime();
  return () => {
    st.stages[key] = Math.max(0, o.now().getTime() - t0);
  };
}

function defaultRunDir(o: RunDefaults): string {
  return path.resolve(o.cwd, '.ce/runs', runDirName(o.now()));
}

function toResolution(res: ResolvedRun): Resolution {
  const r: Resolution = { outcome: res.outcome, reason: res.reason };
  if (res.finalState !== undefined) r.finalState = res.finalState;
  if (res.errorStage !== undefined) r.errorStage = res.errorStage;
  if (res.surface !== undefined) r.surface = res.surface;
  return r;
}

function bundleInput(o: RunDefaults, st: RunState, res: ResolvedRun, error: StageError | null): WriteBundleInput {
  const input: WriteBundleInput = {
    resolution: toResolution(res),
    config: st.redacted,
    context: st.context,
    claims: st.claims,
    assessment: st.assessment,
    runtime: st.runtime,
    error,
    runDir: st.runDir ?? defaultRunDir(o),
    secrets: st.secrets,
    timings: { startedAt: st.startedAt.toISOString(), stages: { ...st.stages } },
    fs: o.fs,
    now: o.now,
  };
  if (st.partial !== undefined) input.partialTrace = st.partial;
  return input;
}

function describeFailure(error: StageError): string {
  return `stage evidence, cause ${causeNameOf(error.cause) ?? 'unknown'}`;
}

/** Attaches the bundle facts to a resolved run. The last write result decides. */
function withBundle(
  o: RunDefaults,
  st: RunState,
  res: ResolvedRun,
  runDir: string,
  write: WriteBundleResult,
): ResolvedRunWithBundle {
  const claimTexts = st.claims.map((c) => redactSecretValues(c.text, st.secrets));
  if (write.ok) {
    return { ...res, runDir, reportPath: write.reportPath, bundleWritten: true, claimTexts };
  }
  const out: ResolvedRunWithBundle = { ...res, runDir, bundleWritten: false, claimTexts };
  if (write.validationFailure !== undefined) {
    out.failureFields = [...write.validationFailure.fields];
  } else {
    out.writeFailureKind = causeNameOf(write.error.cause) ?? 'unknown';
  }
  try {
    o.stderr.write(`Evidence bundle was not written (${describeFailure(write.error)}).\n`);
  } catch {
    // A failing stderr must not break the no-throw guarantee.
  }
  return out;
}

/**
 * Resolves once, writes the bundle, and on a StageError('evidence') resolves a
 * second and last time and writes a Minimal_Bundle. Never throws.
 */
async function finishRunWithBundle(
  o: RunDefaults,
  st: RunState,
  config: EffectiveConfig,
  input: Omit<FinishRunInput, 'config' | 'registry'>,
): Promise<ResolvedRunWithBundle> {
  const first = finishRun({ ...input, config, registry: o.capabilities });
  st.final = first;
  st.lastStage = 'evidence';
  const runDir = st.runDir ?? defaultRunDir(o);

  const written = await writeBundle(bundleInput(o, st, first, input.error ?? null));
  if (written.ok) return withBundle(o, st, first, runDir, written);

  const second = finishRun({ ...input, error: written.error, config, registry: o.capabilities });
  st.final = second;
  const minimalInput = {
    ...bundleInput(o, st, second, written.error),
    ...(written.validationFailure === undefined ? {} : { validationFailure: written.validationFailure }),
  };
  const minimal = await writeMinimalBundle(minimalInput);
  return withBundle(o, st, second, runDir, minimal);
}

/**
 * A config failure is still a run (SPEC 7.1): it resolves to ERROR through
 * resolveOutcome with a Stage_Error for the 'config' stage. The failure report
 * has already gone to stderr; the config is unavailable, so the default
 * fail-on list applies. The Minimal_Bundle goes to `runDir`: the Default_Run_Dir
 * when loadConfig failed, the computed Run_Dir otherwise.
 */
async function configFailureWithBundle(
  o: RunDefaults,
  st: RunState,
  runDir: string,
  error: StageError,
): Promise<ResolvedRunWithBundle> {
  const resolution = resolveAfterAssessment({ registry: EMPTY_REGISTRY, error });
  const result: ResolvedRun = { kind: 'resolved', ...resolution, exitCode: exitCodeFor(resolution, undefined), error };
  st.final = result;
  st.runDir = runDir;
  const written = await writeMinimalBundle(bundleInput(o, st, result, error));
  return withBundle(o, st, result, runDir, written);
}

/** Value-free cause on purpose: failure objects hold raw config values, which can be secrets (Req 7.5). */
function configError(reportFailure: StageError | undefined): StageError {
  return reportFailure ?? new StageError('config', new Error('config failure'));
}

function reportSafely(o: RunDefaults, failure: LoadFailure | { ok: false; errors: unknown[] }): StageError | undefined {
  try {
    reportConfigFailure(failure as LoadFailure, collectSecretValues(o.env), o.stderr);
    return undefined;
  } catch (e) {
    return wrapStage('config', e);
  }
}

export async function run(options: RunOptions = {}): Promise<RunResult> {
  const o = withDefaults(options);
  const st = newState(o);
  try {
    return await runStages(options, o, st);
  } catch (thrown) {
    return recover(o, st, thrown);
  }
}

/** Outermost net: wraps the last stage, resolves only when no final resolution exists, never rethrows. */
async function recover(o: RunDefaults, st: RunState, thrown: unknown): Promise<ResolvedRunWithBundle> {
  const error = wrapStage(st.lastStage, thrown);
  let result = st.final;
  if (result === undefined) {
    const resolution = resolveAfterAssessment({ registry: EMPTY_REGISTRY, error });
    result = {
      kind: 'resolved',
      ...resolution,
      exitCode: exitCodeFor(resolution, st.effective?.output?.['fail-on']),
      error,
    };
    st.final = result;
  }
  const runDir = st.runDir ?? defaultRunDir(o);
  const written = await writeMinimalBundle(bundleInput(o, st, result, result.error ?? error));
  return withBundle(o, st, result, runDir, written);
}

async function runStages(options: RunOptions, o: RunDefaults, st: RunState): Promise<ResolvedRunWithBundle> {
  st.lastStage = 'config';
  const stopConfig = startTimer(o, st, 'config');

  let loaded: ReturnType<typeof loadConfig>;
  try {
    loaded = loadConfig({ cwd: o.cwd, flags: o.flags, env: o.env });
  } catch (e) {
    stopConfig();
    return configFailureWithBundle(o, st, defaultRunDir(o), wrapStage('config', e));
  }
  if (!loaded.ok) {
    const reportFailure = reportSafely(o, loaded);
    stopConfig();
    return configFailureWithBundle(o, st, defaultRunDir(o), configError(reportFailure));
  }
  const config = loaded.config;
  st.effective = config;
  st.redacted = loaded.redacted;

  let gateway: JevGateway;
  // Computed once per run, also when a gateway is supplied; a capability needs it for screenshots.
  const runDir = path.resolve(o.cwd, config.output?.dir ?? '.ce/runs', runDirName(o.now()));
  st.runDir = runDir;
  if (options.gateway !== undefined) {
    gateway = options.gateway;
  } else {
    try {
      const credentials = requireJevCredentials(loaded, o.env);
      if (!credentials.ok) {
        const reportFailure = reportSafely(o, credentials);
        stopConfig();
        return await configFailureWithBundle(o, st, runDir, configError(reportFailure));
      }
      const created = o.createGateway(loaded, o.env, {
        callLog: createJsonlCallLog(path.join(runDir, 'jev-calls.jsonl')),
      });
      if (!created.ok) {
        const reportFailure = reportSafely(o, { ok: false, errors: created.errors });
        stopConfig();
        return await configFailureWithBundle(o, st, runDir, configError(reportFailure));
      }
      gateway = created.gateway;
    } catch (e) {
      if (st.final !== undefined) throw e;
      stopConfig();
      return configFailureWithBundle(o, st, runDir, wrapStage('config', e));
    }
  }
  stopConfig();

  st.lastStage = 'context';
  const stopContext = startTimer(o, st, 'context');
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
    stopContext();
  } catch (e) {
    stopContext();
    return finishRunWithBundle(o, st, config, { error: wrapStage('context', e) });
  }
  st.context = context;

  st.lastStage = 'assessment';
  const stopAssessment = startTimer(o, st, 'assessment');
  let claims: Claim[];
  let assessment: Assessment;
  try {
    ({ claims, assessment } = await assess(context, config, gateway));
    stopAssessment();
  } catch (e) {
    stopAssessment();
    return finishRunWithBundle(o, st, config, { error: wrapStage('assessment', e) });
  }
  st.claims = claims;
  st.assessment = assessment;

  st.lastStage = 'runtime';
  const stopRuntime = startTimer(o, st, 'runtime');
  let entry: ReturnType<typeof selectCapability>;
  try {
    entry = selectCapability(assessment, o.capabilities);
  } catch (e) {
    stopRuntime();
    return finishRunWithBundle(o, st, config, { claims, assessment, error: wrapStage('runtime', e) });
  }
  if (entry === undefined) {
    st.stages.runtime = null; // the runtime stage never started
    return finishRunWithBundle(o, st, config, { claims, assessment });
  }

  // Runtime_Hook call site: the capability runtime of issues #9 and #10 plugs in here.
  try {
    const runtime = await entry.run({
      context,
      claims,
      assessment,
      config,
      gateway,
      runDir,
    });
    stopRuntime();
    st.runtime = runtime;
    return await finishRunWithBundle(o, st, config, { claims, assessment, runtime, capability: entry.name });
  } catch (e) {
    if (st.final !== undefined) throw e; // a failure after finalization goes to the outermost catch
    stopRuntime();
    if (e instanceof LoopStageError) st.partial = e.partial;
    return finishRunWithBundle(o, st, config, {
      claims,
      assessment,
      error: wrapStage('runtime', e),
      capability: entry.name,
    });
  }
}
