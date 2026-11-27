/**
 * Runtime target: attach to a running URL, or start a command and wait for readiness.
 *
 * This module never drives a browser, never decides an Outcome and never talks to Jev.
 * Task 1.1 provides the public surface and the pure helpers; `openTarget` is a stub
 * until task 4.1.
 */

import { spawn as realSpawn } from 'node:child_process';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { parseDuration } from '../config/duration.js';
import type { EffectiveConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TargetMode = 'attached' | 'started';

export type TargetLastStatus =
  | number
  | 'connection-refused'
  | 'timeout'
  | 'dns'
  | 'network'
  | 'none';

export interface TargetOptions {
  url?: string;
  start?: string;
  ready?: { path?: string; timeout?: string };
  cwd: string;
  env: Record<string, string | undefined>;
  secrets?: string[];
  runDir?: string;
  signal?: AbortSignal;
  stopOnSignals?: boolean;
  fetch?: typeof fetch;
  spawn?: typeof nodeSpawn;
  /** ms epoch, for the Ready_Timeout clock. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** For signal listeners and kill(); defaults to the global process. */
  process?: NodeJS.Process;
}

export interface TargetHandle {
  baseUrl: string;
  mode: TargetMode;
  lastStatus: TargetLastStatus;
  /** Bounded, redacted, in arrival order. */
  logs: string;
  /** Empty at first; e.g. the unkillable-process warning. */
  warnings: string[];
  /** Start_Mode only: set when the started process has exited (Requirement 6.6). */
  exited?: { exitCode: number | null; signal: string | null };
  /** Idempotent. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors (no message carries the log capture; `logTail` is the only carrier)
// ---------------------------------------------------------------------------

export class TargetUnreachableError extends Error {
  readonly url: string;
  readonly lastStatus: TargetLastStatus;
  readonly timeoutMs: number;
  readonly mode: TargetMode;
  readonly logTail?: string;

  constructor(init: {
    url: string;
    lastStatus: TargetLastStatus;
    timeoutMs: number;
    mode: TargetMode;
    logTail?: string;
  }) {
    const url = redactUrl(init.url);
    super(
      `target ${url} not ready after ${init.timeoutMs}ms (last status: ${String(init.lastStatus)}, mode: ${init.mode})`,
    );
    this.name = 'TargetUnreachableError';
    this.url = url;
    this.lastStatus = init.lastStatus;
    this.timeoutMs = init.timeoutMs;
    this.mode = init.mode;
    if (init.logTail !== undefined) this.logTail = init.logTail;
  }
}

export class TargetStartError extends Error {
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly logTail?: string;

  constructor(init: {
    command: string;
    exitCode: number | null;
    signal: string | null;
    logTail?: string;
  }) {
    super(
      `target start command failed: ${init.command} (exit code: ${String(init.exitCode)}, signal: ${String(init.signal)})`,
    );
    this.name = 'TargetStartError';
    this.command = init.command;
    this.exitCode = init.exitCode;
    this.signal = init.signal;
    if (init.logTail !== undefined) this.logTail = init.logTail;
  }
}

export class TargetConfigError extends Error {
  readonly key?: string;

  constructor(message: string, key?: string) {
    super(message);
    this.name = 'TargetConfigError';
    if (key !== undefined) this.key = key;
  }
}

// ---------------------------------------------------------------------------
// Pure exported helpers
// ---------------------------------------------------------------------------

/**
 * Appends `readyPath` to the path of `baseUrl`. The base path is kept, the query and
 * fragment of the base are dropped, and slashes at the join are normalised.
 * Deliberately not `new URL(path, base)`, which discards the base path for `/x`.
 */
export function buildProbeUrl(baseUrl: string, readyPath: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  const tail = readyPath.replace(/^\/+/, '');
  url.pathname = `${basePath}/${tail}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** `ready` for 200..399, `not-ready` for every other value. */
export function classifyStatus(status: number): 'ready' | 'not-ready' {
  return Number.isInteger(status) && status >= 200 && status <= 399 ? 'ready' : 'not-ready';
}

/** Replaces userinfo with `***`. Returns the input unchanged when it has none. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.replace(/(\/\/)[^/?#@]*@/, '$1***@');
  }
  if (parsed.username === '' && parsed.password === '') return url;
  if (parsed.username !== '') parsed.username = '***';
  if (parsed.password !== '') parsed.password = '***';
  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit tests; not part of the module's public use)
// ---------------------------------------------------------------------------

export const DEFAULT_READY_PATH = '/';
export const DEFAULT_READY_TIMEOUT = '30s';
export const RETRY_INTERVAL_MS = 250;
export const MAX_PROBE_TIMEOUT_MS = 2000;

/** @internal */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m !== null && m.slice(1).every((octet) => Number(octet) <= 255);
}

/** @internal Request timeout for one probe: `min(2000, remainingMs)`. */
export function probeTimeoutMs(remainingMs: number): number {
  return Math.min(MAX_PROBE_TIMEOUT_MS, remainingMs);
}

/** @internal Maps a probe that produced no response to its `lastStatus` failure kind. */
export function failureToLastStatus(error: unknown): Exclude<TargetLastStatus, number | 'none'> {
  const e = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (code === 'ECONNREFUSED') return 'connection-refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'timeout';
  return 'network';
}

/** @internal Applies the defaults for `ready.path` and `ready.timeout` (parsed to ms). */
export function resolveReadyDefaults(ready: TargetOptions['ready']): {
  path: string;
  timeoutMs: number;
} {
  const path = ready?.path ?? DEFAULT_READY_PATH;
  const text = ready?.timeout ?? DEFAULT_READY_TIMEOUT;
  try {
    return { path, timeoutMs: parseDuration(text) };
  } catch {
    throw new TargetConfigError(`target.ready.timeout is not a valid duration: ${JSON.stringify(text)}`, 'target.ready.timeout');
  }
}

// ---------------------------------------------------------------------------
// Log capture (Requirement 5)
// ---------------------------------------------------------------------------

export const LOG_CAPTURE_MAX_BYTES = 262144;
export const LOG_TAIL_BYTES = 4096;
export const TARGET_LOG_FILE = 'target.log';
/** CE-owned secret variables that are always removed and always redacted (Requirement 2.7). */
export const CE_SECRET_NAMES: readonly string[] = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'];

export type LogStream = 'stdout' | 'stderr';

export interface LogEntry {
  stream: LogStream;
  text: string;
}

/**
 * Effective secret names: union of `secrets` and the two CE-owned names.
 * @internal
 */
export function effectiveSecretNames(secrets?: readonly string[]): Set<string> {
  return new Set([...(secrets ?? []), ...CE_SECRET_NAMES]);
}

/**
 * Last `maxBytes` UTF-8 bytes of `text`, cut at a character boundary (never a partial
 * sequence). Returns `text` unchanged when it already fits.
 */
export function logTail(text: string, maxBytes: number = LOG_TAIL_BYTES): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString('utf8');
}

export interface LogCaptureOptions {
  /** Environment the secret values are read from (`options.env` of `openTarget`). */
  env: Record<string, string | undefined>;
  /** Extra secret variable names; `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` are always added. */
  secrets?: readonly string[];
  /** When given, released text is appended to `<runDir>/target.log` (dir created with mkdir -p). */
  runDir?: string;
  /** In-memory bound in UTF-8 bytes. Defaults to 262144. */
  maxBytes?: number;
}

/**
 * Log capture of one started process. API (used directly by tests, with chunks):
 *
 * - `write(stream, chunk)`: feed one chunk (`Buffer`/`Uint8Array`, or a `string`, which is
 *   encoded to UTF-8 first). Per stream it decodes (partial UTF-8 sequences kept), joins the
 *   Held_Tail, redacts the whole buffer (longer secrets first), keeps the last L-1 characters
 *   as the new Held_Tail and releases the rest. Ignored after `stop()`.
 * - `end(stream)`: end of one stream; flushes decoder and Held_Tail and releases all of it.
 * - `stop()`: flushes both streams, waits for pending file writes, closes the file, then
 *   discards every later chunk. Idempotent; never rejects.
 * - `logs()`: bounded redacted text in arrival order. `entries()`: same with stream labels.
 * - `tail(bytes = 4096)`: `logTail(logs())`.
 * - `fileError()`: first file I/O error, if any (file errors never throw into the caller).
 *
 * Nothing is ever written to the stdout or stderr of CE.
 */
export interface LogCapture {
  write(stream: LogStream, chunk: Uint8Array | string): void;
  end(stream: LogStream): void;
  stop(): Promise<void>;
  logs(): string;
  entries(): LogEntry[];
  tail(bytes?: number): string;
  fileError(): unknown;
}

export function createLogCapture(options: LogCaptureOptions): LogCapture {
  const maxBytes = options.maxBytes ?? LOG_CAPTURE_MAX_BYTES;

  // Non-empty secret values, longest first, de-duplicated.
  const values = [
    ...new Set(
      [...effectiveSecretNames(options.secrets)]
        .map((name) => options.env[name])
        .filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ].sort((a, b) => b.length - a.length);
  const longest = values.length > 0 ? values[0]!.length : 0;
  const holdLen = Math.max(0, longest - 1);

  const redact = (text: string): string => {
    let out = text;
    for (const v of values) out = out.split(v).join('***');
    return out;
  };

  const streams: Record<LogStream, { decoder: StringDecoder; held: string }> = {
    stdout: { decoder: new StringDecoder('utf8'), held: '' },
    stderr: { decoder: new StringDecoder('utf8'), held: '' },
  };

  let segments: LogEntry[] = [];
  let totalBytes = 0;
  let stopped = false;
  let firstFileError: unknown;

  // File sink: one sequential chain; created only when a runDir is given.
  let chain: Promise<void> = Promise.resolve();
  let handle: FileHandle | undefined;
  if (options.runDir !== undefined) {
    const dir = options.runDir;
    chain = chain
      .then(async () => {
        await mkdir(dir, { recursive: true });
        handle = await open(join(dir, TARGET_LOG_FILE), 'w');
      })
      .catch((e: unknown) => {
        firstFileError ??= e;
      });
  }
  const appendToFile = (text: string): void => {
    if (options.runDir === undefined) return;
    chain = chain.then(async () => {
      if (handle === undefined) return;
      try {
        await handle.write(text);
      } catch (e) {
        firstFileError ??= e;
      }
    });
  };

  const bound = (): void => {
    while (totalBytes > maxBytes && segments.length > 0) {
      const excess = totalBytes - maxBytes;
      const first = segments[0]!;
      const buf = Buffer.from(first.text, 'utf8');
      if (buf.length <= excess) {
        segments.shift();
        totalBytes -= buf.length;
        continue;
      }
      let cut = excess;
      while (cut < buf.length && (buf[cut]! & 0xc0) === 0x80) cut++;
      first.text = buf.subarray(cut).toString('utf8');
      totalBytes -= cut;
    }
  };

  const release = (stream: LogStream, text: string): void => {
    if (text === '') return;
    segments.push({ stream, text });
    totalBytes += Buffer.byteLength(text, 'utf8');
    bound();
    appendToFile(text);
  };

  /** Steps (b)-(e) of Requirement 5.8 on already decoded text; `final` releases everything. */
  const process_ = (stream: LogStream, decoded: string, final: boolean): void => {
    const state = streams[stream];
    const redacted = redact(state.held + decoded);
    if (final) {
      state.held = '';
      release(stream, redacted);
      return;
    }
    let cut = Math.max(0, redacted.length - holdLen);
    // Never split a surrogate pair at the release boundary; holding one more unit is safe.
    if (cut > 0 && cut < redacted.length) {
      const code = redacted.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut--;
    }
    state.held = redacted.slice(cut);
    release(stream, redacted.slice(0, cut));
  };

  const write = (stream: LogStream, chunk: Uint8Array | string): void => {
    if (stopped) return;
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    process_(stream, streams[stream].decoder.write(Buffer.from(bytes)), false);
  };

  const end = (stream: LogStream): void => {
    if (stopped) return;
    process_(stream, streams[stream].decoder.end(), true);
  };

  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      end('stdout');
      end('stderr');
      stopped = true;
      await chain;
      try {
        await handle?.close();
      } catch (e) {
        firstFileError ??= e;
      }
      handle = undefined;
    })();
    return stopPromise;
  };

  const logs = (): string => segments.map((s) => s.text).join('');

  return {
    write,
    end,
    stop,
    logs,
    entries: () => segments.map((s) => ({ ...s })),
    tail: (bytes = LOG_TAIL_BYTES) => logTail(logs(), bytes),
    fileError: () => firstFileError,
  };
}

// ---------------------------------------------------------------------------
// Config mapping
// ---------------------------------------------------------------------------

/**
 * Maps `target.url`, `target.start`, `target.ready.path`, `target.ready.timeout` and the
 * caller's `cwd`, `env`, `runDir`, `signal`. Sets nothing else.
 */
export function targetOptionsFromConfig(
  config: EffectiveConfig,
  extras: {
    cwd: string;
    env: Record<string, string | undefined>;
    runDir?: string;
    signal?: AbortSignal;
  },
): TargetOptions {
  const options: TargetOptions = { cwd: extras.cwd, env: extras.env };
  const target = config.target;
  if (target?.url !== undefined) options.url = target.url;
  if (target?.start !== undefined) options.start = target.start;
  if (target?.ready !== undefined) {
    const ready: NonNullable<TargetOptions['ready']> = {};
    if (target.ready.path !== undefined) ready.path = target.ready.path;
    if (target.ready.timeout !== undefined) ready.timeout = target.ready.timeout;
    options.ready = ready;
  }
  if (extras.runDir !== undefined) options.runDir = extras.runDir;
  if (extras.signal !== undefined) options.signal = extras.signal;
  return options;
}

// ---------------------------------------------------------------------------
// Readiness loop
// ---------------------------------------------------------------------------

export type ProbeOutcome =
  | { kind: 'response'; status: number }
  | { kind: 'failure'; lastStatus: Exclude<TargetLastStatus, number | 'none'> };

export type ReadinessAction = 'ready' | 'retry-after-250ms' | 'timed-out';

/**
 * Pure transition of the readiness loop: given the time spent since the Ready_Timeout
 * started, the Ready_Timeout and the outcome of the probe just completed, decide the next step.
 * @internal
 */
export function nextReadinessAction(input: {
  elapsedMs: number;
  timeoutMs: number;
  outcome: ProbeOutcome;
}): ReadinessAction {
  if (input.outcome.kind === 'response' && classifyStatus(input.outcome.status) === 'ready') {
    return 'ready';
  }
  // A retry needs room for the interval and a following probe.
  return input.elapsedMs + RETRY_INTERVAL_MS >= input.timeoutMs ? 'timed-out' : 'retry-after-250ms';
}

/** @internal Value of `lastStatus` recorded for one probe outcome. */
export function outcomeToLastStatus(outcome: ProbeOutcome): TargetLastStatus {
  return outcome.kind === 'response' ? outcome.status : outcome.lastStatus;
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

/** One GET probe with `redirect: 'manual'` and its own request timeout. */
async function probeOnce(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    try {
      await response.body?.cancel();
    } catch {
      // The status is already known; a body that cannot be cancelled does not matter.
    }
    return { kind: 'response', status: response.status };
  } catch (error) {
    return { kind: 'failure', lastStatus: failureToLastStatus(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface ReadinessInput {
  probeUrl: string;
  /** Redacted or not; the error redacts it again. */
  baseUrl: string;
  timeoutMs: number;
  mode: TargetMode;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Last 4 KiB of the log capture for the error (Start_Mode). */
  logTail?: () => string | undefined;
}

/**
 * Probes until a Ready_Status, the Ready_Timeout or an abort. Resolves to the Ready_Status.
 * @internal
 */
export async function waitUntilReady(input: ReadinessInput): Promise<number> {
  const startedAt = input.now();
  let lastStatus: TargetLastStatus = 'none';
  for (;;) {
    if (input.signal?.aborted) throw abortError();
    const elapsed = input.now() - startedAt;
    const remaining = input.timeoutMs - elapsed;
    const outcome = await probeOnce(
      input.fetch,
      input.probeUrl,
      probeTimeoutMs(Math.max(0, remaining)),
      input.signal,
    );
    if (input.signal?.aborted) throw abortError();
    lastStatus = outcomeToLastStatus(outcome);
    const action = nextReadinessAction({
      elapsedMs: input.now() - startedAt,
      timeoutMs: input.timeoutMs,
      outcome,
    });
    if (action === 'ready') return lastStatus as number;
    if (action === 'timed-out') {
      const tail = input.logTail?.();
      throw new TargetUnreachableError({
        url: input.baseUrl,
        lastStatus,
        timeoutMs: input.timeoutMs,
        mode: input.mode,
        ...(tail !== undefined ? { logTail: tail } : {}),
      });
    }
    await input.sleep(RETRY_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Idempotent stop holder (reused by Start_Mode, task 5.1)
// ---------------------------------------------------------------------------

/**
 * Wraps `action` so that it runs at most once; every call returns the same promise.
 * A failing action is swallowed, so no call rejects.
 * @internal
 */
export function createStopHolder(action: () => Promise<void> = async () => {}): () => Promise<void> {
  let promise: Promise<void> | undefined;
  return () => {
    promise ??= (async () => {
      try {
        await action();
      } catch {
        // stop() never rejects.
      }
    })();
    return promise;
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface ValidatedTarget {
  url: string;
  parsed: URL;
  start?: string;
  readyPath: string;
  timeoutMs: number;
}

function validateOptions(options: TargetOptions): ValidatedTarget {
  const url = options.url;
  const start = options.start;
  const hasUrl = url !== undefined && url !== '';
  const hasStart = start !== undefined && start !== '';
  if (!hasUrl && !hasStart) {
    throw new TargetConfigError('target.url is required (neither target.url nor target.start is set)', 'target.url');
  }
  if (!hasUrl) {
    throw new TargetConfigError('target.url is required when target.start is set', 'target.url');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetConfigError(`target.url is not a valid URL: ${redactUrl(url)}`, 'target.url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TargetConfigError(`target.url must be an http or https URL: ${redactUrl(url)}`, 'target.url');
  }
  if (hasStart && !isLoopbackHost(parsed.hostname)) {
    throw new TargetConfigError(
      `target.start requires a loopback target.url (localhost, 127.0.0.0/8, ::1, 0.0.0.0): ${redactUrl(url)}`,
      'target.url',
    );
  }
  const ready = resolveReadyDefaults(options.ready);
  return {
    url,
    parsed,
    ...(hasStart ? { start } : {}),
    readyPath: ready.path,
    timeoutMs: ready.timeoutMs,
  };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const STOP_GRACE_MS = 5000;
export const KILL_DEADLINE_MS = 5000;

type ProcState = 'not-started' | 'running' | 'term-sent' | 'kill-sent' | 'exited';

async function openStarted(
  options: TargetOptions,
  target: ValidatedTarget & { start: string },
): Promise<TargetHandle> {
  const command = target.start;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const spawnFn = options.spawn ?? realSpawn;
  const proc = options.process ?? process;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const probeUrl = buildProbeUrl(target.url, target.readyPath);

  if (options.signal?.aborted) throw abortError();

  // Pre_Start_Probe: one GET, own 2s timeout, outside the Ready_Timeout, no lastStatus.
  const pre = await probeOnce(fetchFn, probeUrl, MAX_PROBE_TIMEOUT_MS, options.signal);
  if (options.signal?.aborted) throw abortError();
  if (pre.kind === 'response' && classifyStatus(pre.status) === 'ready') {
    throw new TargetConfigError(
      `target.url is already served before start: ${redactUrl(target.url)}`,
      'target.url',
    );
  }

  const secretNames = effectiveSecretNames(options.secrets);
  const childEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env)) {
    if (!secretNames.has(key)) childEnv[key] = value;
  }

  let child: ChildProcess;
  try {
    child = spawnFn(command, {
      shell: true,
      detached: true,
      cwd: options.cwd,
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new TargetStartError({ command, exitCode: null, signal: null });
  }

  const capture = createLogCapture({
    env: options.env,
    ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
    ...(options.runDir !== undefined ? { runDir: options.runDir } : {}),
  });
  for (const name of ['stdout', 'stderr'] as const) {
    const stream = child[name];
    stream?.on('data', (chunk: Uint8Array | string) => capture.write(name, chunk));
    stream?.on('end', () => capture.end(name));
    stream?.on('error', () => {});
  }

  // Exit tracking and the stop state machine.
  let state: ProcState = 'running';
  let exitInfo: { exitCode: number | null; signal: string | null } | undefined;
  let spawnFailed = false;
  let markExited!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    markExited = resolve;
  });
  const recordExit = (exitCode: number | null, signal: string | null): void => {
    if (exitInfo === undefined) exitInfo = { exitCode, signal };
    state = 'exited';
    markExited();
  };
  child.on('exit', (code: number | null, signal: string | null) => recordExit(code, signal));
  child.on('error', () => {
    if (child.pid === undefined) {
      spawnFailed = true;
      recordExit(null, null);
    }
  });

  const pid = child.pid;
  const warnings: string[] = [];
  const signalGroup = (sig: NodeJS.Signals): void => {
    if (pid === undefined) return;
    try {
      proc.kill(-pid, sig);
    } catch {
      // ESRCH and friends: the group is already gone.
    }
  };

  // Delay for the grace periods: injected sleep when given, else a cancellable timer.
  const delay = (ms: number): { promise: Promise<void>; cancel: () => void } => {
    if (options.sleep !== undefined) return { promise: sleep(ms), cancel: () => {} };
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  };
  const waitExitOr = async (ms: number): Promise<boolean> => {
    const d = delay(ms);
    try {
      await Promise.race([exitPromise, d.promise]);
    } finally {
      d.cancel();
    }
    return state === 'exited';
  };

  // Signal wiring (Requirement 6.3-6.5).
  const listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];
  const removeListeners = (): void => {
    for (const l of listeners.splice(0)) proc.removeListener(l.event, l.fn);
  };

  const stop = createStopHolder(async () => {
    try {
      if (state !== 'exited') {
        signalGroup('SIGTERM');
        if (state === 'running') state = 'term-sent';
        if (!(await waitExitOr(STOP_GRACE_MS))) {
          state = 'kill-sent';
          signalGroup('SIGKILL');
          if (!(await waitExitOr(KILL_DEADLINE_MS))) {
            warnings.push(
              `target process did not exit after SIGKILL: command ${JSON.stringify(command)}, pid ${String(pid)}`,
            );
          }
        }
      }
    } finally {
      removeListeners();
      await capture.stop();
    }
  });

  if (options.stopOnSignals === true) {
    let signalled = false;
    const onSignal = (sig: NodeJS.Signals): void => {
      if (signalled) return;
      signalled = true;
      void stop().then(() => {
        removeListeners();
        proc.kill(proc.pid, sig);
      });
    };
    const onExit = (): void => {
      if (state !== 'exited') signalGroup('SIGTERM');
    };
    const add = (event: string, fn: (...args: any[]) => void): void => {
      proc.on(event, fn);
      listeners.push({ event, fn });
    };
    add('SIGINT', onSignal);
    add('SIGTERM', onSignal);
    add('exit', onExit);
  }

  const failStart = async (): Promise<never> => {
    await stop();
    throw new TargetStartError({
      command,
      exitCode: exitInfo?.exitCode ?? null,
      signal: exitInfo?.signal ?? null,
      logTail: capture.tail(),
    });
  };

  if (pid === undefined || spawnFailed) return failStart();

  // Readiness, raced against early exit and abort.
  const inner = new AbortController();
  const onAbort = (): void => inner.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const ready = waitUntilReady({
    probeUrl,
    baseUrl: target.url,
    timeoutMs: target.timeoutMs,
    mode: 'started',
    fetch: fetchFn,
    now,
    sleep,
    signal: inner.signal,
  });
  ready.catch(() => {});
  const exitedFirst = exitPromise.then(() => 'exited' as const);
  let readyStatus: number;
  try {
    const first = await Promise.race([ready.then((status) => ({ status })), exitedFirst]);
    if (first === 'exited') {
      if (options.signal?.aborted) {
        await stop();
        throw abortError();
      }
      return await failStart();
    }
    readyStatus = first.status;
  } catch (error) {
    if (error instanceof TargetStartError) throw error;
    await stop();
    if (options.signal?.aborted) throw abortError();
    if (error instanceof TargetUnreachableError) {
      throw new TargetUnreachableError({
        url: target.url,
        lastStatus: error.lastStatus,
        timeoutMs: error.timeoutMs,
        mode: 'started',
        logTail: capture.tail(),
      });
    }
    throw error;
  } finally {
    inner.abort();
    options.signal?.removeEventListener('abort', onAbort);
  }

  const handle: TargetHandle = {
    baseUrl: target.url,
    mode: 'started',
    lastStatus: readyStatus,
    get logs(): string {
      return capture.logs();
    },
    warnings,
    get exited() {
      return exitInfo;
    },
    stop,
  };
  return handle;
}

export async function openTarget(options: TargetOptions): Promise<TargetHandle> {
  const target = validateOptions(options);

  if (target.start !== undefined) {
    return openStarted(options, target as ValidatedTarget & { start: string });
  }

  // Attach_Mode: no spawn, no signal.
  const readyStatus = await waitUntilReady({
    probeUrl: buildProbeUrl(target.url, target.readyPath),
    baseUrl: target.url,
    timeoutMs: target.timeoutMs,
    mode: 'attached',
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? defaultSleep,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  const handle: TargetHandle = {
    baseUrl: target.url,
    mode: 'attached',
    lastStatus: readyStatus,
    logs: '',
    warnings: [],
    stop: createStopHolder(),
  };
  return handle;
}
