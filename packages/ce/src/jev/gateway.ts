/**
 * Jev gateway: the one interface through which CE asks Jev questions, and the hybrid
 * implementation that routes each request to one of two transports.
 *
 * Exit plan (jev-gateway-decision steering note). When the SDK can send images as JSON, or
 * OpenRouter accepts multipart uploads:
 *   1. delete `transport-json.ts` and the image route in this file;
 *   2. route all requests through the SDK transport;
 *   3. keep the `JevGateway` interface unchanged;
 *   4. re-check on every SDK release.
 * Transport routing lives only in this file, so none of this touches a file outside `jev/`.
 *
 * This module never decides an Outcome and never imports `outcome/resolve.ts`. It raises
 * `StageError`, `JevImageError` or `RateLimitError` (inside a StageError) for the pipeline to
 * resolve.
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  Image,
  RateLimitError as SdkRateLimitError,
  TypeSafeError,
} from '@typesafe-ai/sdk';
import type {
  Fetch as SdkFetch,
  BoxResponse,
  ChoiceResponse,
  NoulResponse,
  ScoreResponse,
} from '@typesafe-ai/sdk';
import { ConfigDefaults } from '../config/defaults.js';
import type { ValidationError } from '../config/errors.js';
import type { LoadedConfig } from '../config/load.js';
import { requireJevCredentials } from '../config/credentials.js';
import { StageError } from '../errors.js';
import type { Stage } from '../errors.js';
import { JevImageError, JevUsageError, RateLimitError } from './errors.js';
import type { JevImageErrorReason } from './errors.js';
import { stateHash } from './hash.js';
import { parseRetryAfterHeaders } from './retry-after.js';
import type { CallLog, CallLogEntry } from './log.js';
import { createSdkTransport } from './transport-sdk.js';
import type { SdkTransport } from './transport-sdk.js';
import { JsonTransportError, createJsonTransport } from './transport-json.js';
import type { JsonFetch, JsonTransport } from './transport-json.js';
import type { BuiltCatalogQuestion, Jev_Request, RawSystemOneResult } from './types.js';

export type { Jev_Request } from './types.js';
export { parseRetryAfter } from './retry-after.js';

export interface AskOptions {
  signal?: AbortSignal;
}

export interface Jev_Response {
  /** Returned_Model_Id: the dated id from the API response, not the requested name. */
  model: string;
  answers: Record<string, NoulResponse | ChoiceResponse | ScoreResponse | BoxResponse>;
  usage: { input_tokens: number | null; output_tokens: number | null };
}

export interface JevGateway {
  ask(request: Jev_Request, options?: AskOptions): Promise<Jev_Response>;
}

export interface HybridJevGatewayOptions {
  sdkTransport: SdkTransport;
  jsonTransport: JsonTransport;
  callLog: CallLog;
  provider: 'openrouter' | 'typesafe';
  requestedModel: string;
  /** Pacing options. Their logic is added with the retry loop; they are stored here. */
  maxConcurrent?: number;
  maxRateLimitRetries?: number;
  maxTransientRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeouts. Defaults: 10 000 ms for text, 30 000 ms for the image request. */
  textTimeoutMs?: number;
  imageTimeoutMs?: number;
}

export interface ResolvedPacing {
  maxConcurrent: number;
  maxRateLimitRetries: number;
  maxTransientRetries: number;
  sleep: (ms: number) => Promise<void>;
  textTimeoutMs: number;
  imageTimeoutMs: number;
}

const DEFAULT_TEXT_TIMEOUT_MS = 10_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 30_000;
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 5000;
/** A server delay above this stops retrying at once. */
const MAX_RETRY_DELAY_MS = 60_000;

function backoffMs(retryIndex: number): number {
  return Math.min(BACKOFF_INITIAL_MS * 2 ** retryIndex, BACKOFF_MAX_MS);
}

/** FIFO concurrency gate. Waiters are released in submission order. */
class Gate {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** Resolves with a release function, or `undefined` if the signal aborted while queued. */
  acquire(signal: AbortSignal | undefined): Promise<(() => void) | undefined> {
    if (signal?.aborted === true) return Promise.resolve(undefined);
    if (this.#active < this.#limit && this.#queue.length === 0) {
      this.#active += 1;
      return Promise.resolve(() => this.#release());
    }
    return new Promise((resolve) => {
      const start = (): void => {
        signal?.removeEventListener('abort', onAbort);
        // The slot is transferred from the releaser, so #active is unchanged.
        resolve(() => this.#release());
      };
      const onAbort = (): void => {
        const index = this.#queue.indexOf(start);
        if (index >= 0) this.#queue.splice(index, 1);
        resolve(undefined);
      };
      this.#queue.push(start);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next !== undefined) next();
    else this.#active -= 1;
  }
}

type RequestKind = 'text' | 'image';

type FailureCategory =
  | 'auth'
  | 'rate_limit'
  | 'abort'
  | 'timeout'
  | 'connection'
  | 'server'
  | 'bad_request'
  | 'client'
  | 'invalid_response'
  | 'invalid_image'
  | 'other';

/** One failed attempt, classified. `cause` is the underlying error, never exposed raw for images. */
interface Failure {
  category: FailureCategory;
  status?: number;
  retryAfterMs?: number;
  cause: unknown;
  /** False when the attempt failed before any HTTP request left the process. */
  sent: boolean;
}

type CallOutcome =
  | { ok: true; result: RawSystemOneResult; attempts: number }
  | { ok: false; failure: Failure; attempts: number };

type AnswerLog = CallLogEntry['answers'][string];

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

/** An Image_Request carries an image in its state or in any question. Decided from content only. */
export function isImageRequest(request: Jev_Request): boolean {
  const seen = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (value instanceof Image) return true;
    if (Array.isArray(value)) return value.some(visit);
    const assets = (value as { assets?: unknown }).assets;
    if (Array.isArray(assets) && assets.length > 0) return true;
    return Object.values(value).some(visit);
  };
  if (visit(request.state)) return true;
  return Object.values(request.questions).some((built) => visit(built.question));
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

function categoryForStatus(status: number): FailureCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status === 400 || status === 413 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'client';
}

/** Maps a transport or SDK error to a Failure. No SDK class escapes this function. */
function classifyError(error: unknown): Failure {
  if (error instanceof JevImageError) {
    // Raised by the JSON transport before any network call (invalid_image).
    return { category: 'invalid_image', cause: error, sent: false };
  }
  if (error instanceof JsonTransportError) {
    switch (error.kind) {
      case 'http': {
        const status = error.status;
        if (status === undefined) return { category: 'other', cause: error, sent: true };
        return {
          category: categoryForStatus(status),
          status,
          ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
          cause: error,
          sent: true,
        };
      }
      case 'timeout':
        return { category: 'timeout', cause: error, sent: true };
      case 'connection':
        return { category: 'connection', cause: error, sent: true };
      case 'aborted':
        return { category: 'abort', cause: error, sent: true };
      case 'invalid_response':
        return {
          category: 'invalid_response',
          ...(error.status !== undefined ? { status: error.status } : {}),
          cause: error,
          sent: true,
        };
    }
  }
  if (error instanceof APIError) {
    const headerDelay = parseRetryAfterHeaders(
      (error as { headers?: { get(name: string): string | null } }).headers,
    );
    const retryAfterMs =
      headerDelay ?? (error instanceof SdkRateLimitError ? error.retryAfterMs : undefined);
    return {
      category: categoryForStatus(error.status),
      status: error.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      cause: error,
      sent: true,
    };
  }
  if (error instanceof APITimeoutError) return { category: 'timeout', cause: error, sent: true };
  if (error instanceof APIConnectionError) {
    return { category: 'connection', cause: error, sent: true };
  }
  if (error instanceof APIUserAbortError) return { category: 'abort', cause: error, sent: true };
  if (error instanceof TypeSafeError) return { category: 'client', cause: error, sent: false };
  return { category: 'other', cause: error, sent: false };
}

function invalidResponse(detail: string): Failure {
  return {
    category: 'invalid_response',
    cause: new Error(`Jev response invalid: ${detail}`),
    sent: true,
  };
}

const IMAGE_REASON: Record<FailureCategory, JevImageErrorReason> = {
  auth: 'client', // never used: auth raises a StageError
  rate_limit: 'rate_limited',
  abort: 'timeout',
  timeout: 'timeout',
  connection: 'connection',
  server: 'server',
  bad_request: 'bad_request',
  client: 'client',
  invalid_response: 'invalid_response',
  invalid_image: 'invalid_image',
  other: 'client',
};

function errorKindOf(kind: RequestKind, failure: Failure): NonNullable<CallLogEntry['errorKind']> {
  switch (failure.category) {
    case 'auth':
      return 'auth';
    case 'abort':
      return 'abort';
    case 'rate_limit':
      return kind === 'image' ? 'rate_limited' : 'rate_limit';
    case 'other':
      return 'other';
    default:
      return failure.category;
  }
}

// ---------------------------------------------------------------------------------------------
// Call log entry construction
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function probability(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function probabilityMap(
  value: unknown,
  keyOf: (key: string, position: number) => string,
): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  let position = 0;
  for (const [key, raw] of Object.entries(value)) {
    const p = probability(raw);
    if (p === undefined) return undefined;
    out[keyOf(key, position)] = p;
    position += 1;
  }
  return out;
}

/**
 * Converts one answer to its log form, or `undefined` when it does not have the shape of the
 * question. For a question whose labels are not fixed (`runtime.next_action`) the label text is
 * never recorded: probabilities go under the zero-based option index, plus `done` and `give_up`.
 */
export function toAnswerLog(built: BuiltCatalogQuestion, raw: unknown): AnswerLog | undefined {
  if (!isRecord(raw) || raw.type !== built.type) return undefined;
  switch (built.type) {
    case 'noul': {
      const p = probability(raw.noul);
      return p === undefined ? undefined : { type: 'noul', probability: p };
    }
    case 'choice': {
      const probabilities = built.labelsFixed
        ? probabilityMap(raw.probabilities, (key) => key)
        : indexedProbabilities(raw.probabilities);
      return probabilities === undefined ? undefined : { type: 'choice', probabilities };
    }
    case 'score': {
      const probabilities = probabilityMap(raw.probabilities, (key) => key);
      return probabilities === undefined ? undefined : { type: 'score', probabilities };
    }
    case 'box': {
      const box = raw.box;
      if (!isRecord(box)) return undefined;
      const top = probability(box.top);
      const bottom = probability(box.bottom);
      const left = probability(box.left);
      const right = probability(box.right);
      if (top === undefined || bottom === undefined || left === undefined || right === undefined) {
        return undefined;
      }
      let confidence: number | null;
      if (raw.confidence === null || raw.confidence === undefined) {
        confidence = null;
      } else {
        const c = probability(raw.confidence);
        if (c === undefined) return undefined;
        confidence = c;
      }
      return { type: 'box', box: { top, bottom, left, right }, confidence };
    }
    default:
      return undefined;
  }
}

/** Keys: zero-based index of each non-fixed option, in request order; `done`, `give_up` kept. */
function indexedProbabilities(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const fixed = new Set(['done', 'give_up']);
  const out: Record<string, number> = {};
  let index = 0;
  for (const [key, raw] of Object.entries(value)) {
    const p = probability(raw);
    if (p === undefined) return undefined;
    if (fixed.has(key)) {
      out[key] = p;
    } else {
      out[String(index)] = p;
      index += 1;
    }
  }
  return out;
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Validates a transport result against the request. Returns answers for the log or a Failure. */
function validateResult(
  request: Jev_Request,
  result: RawSystemOneResult,
): { answers: Record<string, AnswerLog> } | Failure {
  if (typeof result.model !== 'string' || result.model.length === 0) {
    return invalidResponse('missing model id');
  }
  if (!isRecord(result.answers)) return invalidResponse('missing answers');
  const answers: Record<string, AnswerLog> = {};
  for (const [name, built] of Object.entries(request.questions)) {
    const raw = result.answers[name];
    if (raw === undefined || raw === null) return invalidResponse(`missing answer "${name}"`);
    const logged = toAnswerLog(built, raw);
    if (logged === undefined) return invalidResponse(`malformed answer "${name}"`);
    answers[name] = logged;
  }
  return { answers };
}

// ---------------------------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------------------------

export class HybridJevGateway implements JevGateway {
  readonly requestedModel: string;
  /** Resolved pacing and timeout options. Consumed by the attempt loop. */
  readonly pacing: ResolvedPacing;

  readonly #sdkTransport: SdkTransport;
  readonly #jsonTransport: JsonTransport;
  readonly #callLog: CallLog;
  readonly #provider: 'openrouter' | 'typesafe';
  readonly #modelIds: string[] = [];
  readonly #gate: Gate;
  readonly #customSleep: ((ms: number) => Promise<void>) | undefined;
  #imageRequestAccepted = false;

  constructor(options: HybridJevGatewayOptions) {
    const maxConcurrent = options.maxConcurrent ?? 4;
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError(`maxConcurrent must be a positive integer, got ${String(maxConcurrent)}`);
    }
    for (const name of ['maxRateLimitRetries', 'maxTransientRetries'] as const) {
      const value = options[name] ?? 0;
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer, got ${String(value)}`);
      }
    }
    this.#gate = new Gate(maxConcurrent);
    this.#customSleep = options.sleep;
    this.#sdkTransport = options.sdkTransport;
    this.#jsonTransport = options.jsonTransport;
    this.#callLog = options.callLog;
    this.#provider = options.provider;
    this.requestedModel = options.requestedModel;
    this.pacing = {
      maxConcurrent: options.maxConcurrent ?? 4,
      maxRateLimitRetries: options.maxRateLimitRetries ?? 2,
      maxTransientRetries: options.maxTransientRetries ?? 2,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      textTimeoutMs: options.textTimeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
      imageTimeoutMs: options.imageTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
    };
  }

  /** Distinct Returned_Model_Ids seen so far, in order of first appearance. */
  modelIds(): string[] {
    return [...this.#modelIds];
  }

  async ask(request: Jev_Request, options: AskOptions = {}): Promise<Jev_Response> {
    const kind: RequestKind = isImageRequest(request) ? 'image' : 'text';
    const signal = options.signal;
    const hash = stateHash(request.state);

    // One Image_Request per gateway instance. Checked synchronously, before any network call.
    if (kind === 'image') {
      if (this.#imageRequestAccepted) {
        throw new JevUsageError('A second image request was submitted to one Jev gateway instance');
      }
      this.#imageRequestAccepted = true;
    }

    // The slot is acquired before the clock starts.
    const release = await this.#gate.acquire(signal);
    const startedAt = new Date();
    const startedMs = performance.now();
    let outcome: CallOutcome;
    if (release === undefined) {
      outcome = {
        ok: false,
        failure: { category: 'abort', cause: signal?.reason, sent: false },
        attempts: 0,
      };
    } else {
      try {
        outcome = await this.#attemptLoop(request, kind, signal);
      } finally {
        release();
      }
    }
    const latencyMs = Math.max(0, performance.now() - startedMs);

    let answers: Record<string, AnswerLog> = {};
    let failure: Failure | undefined;
    let result: RawSystemOneResult | undefined;

    if (outcome.ok) {
      const validated = validateResult(request, outcome.result);
      if ('answers' in validated) {
        answers = validated.answers;
        result = outcome.result;
      } else {
        failure = validated;
      }
    } else {
      failure = outcome.failure;
    }
    if (signal?.aborted === true && failure === undefined && result === undefined) {
      failure = { category: 'abort', cause: signal.reason, sent: true };
    }

    const entry: CallLogEntry = {
      timestamp: startedAt.toISOString(),
      stage: request.stage,
      transport: kind === 'image' ? 'json' : 'sdk',
      provider: this.#provider,
      requestedModel: this.requestedModel,
      model: result !== undefined ? result.model : null,
      questions: Object.values(request.questions).map((built) => ({
        id: built.id,
        version: built.version,
        type: built.type,
      })),
      answers,
      latencyMs,
      usage:
        result !== undefined
          ? {
              input_tokens: tokenCount(result.usage?.input_tokens),
              output_tokens: tokenCount(result.usage?.output_tokens),
            }
          : { input_tokens: null, output_tokens: null },
      stateHash: hash,
      status: failure === undefined ? 'ok' : 'error',
      attempts: outcome.attempts,
      ...(failure !== undefined
        ? {
            errorKind: errorKindOf(kind, failure),
            ...(failure.status !== undefined ? { httpStatus: failure.status } : {}),
          }
        : {}),
    };

    const raised = failure !== undefined ? this.#toError(kind, request.stage, failure, signal) : undefined;

    // The log entry is appended before any error is raised (Requirement 12 criterion 8).
    try {
      await this.#callLog.append(entry);
    } catch (writeError) {
      throw new StageError(
        request.stage,
        writeError,
        raised !== undefined ? { callError: raised } : undefined,
      );
    }

    if (raised !== undefined) throw raised;
    // `result` is defined whenever `failure` is not.
    const ok = result as RawSystemOneResult;
    if (!this.#modelIds.includes(ok.model)) this.#modelIds.push(ok.model);
    return {
      model: ok.model,
      answers: ok.answers as Jev_Response['answers'],
      usage: entry.usage,
    };
  }

  /**
   * Attempt loop. Today it makes one attempt. The pacing and retry logic plugs in at the marked
   * seam: decide from the classified failure whether to wait and try again, and bump `attempts`
   * only for attempts that sent an HTTP request.
   */
  async #attemptLoop(
    request: Jev_Request,
    kind: RequestKind,
    signal: AbortSignal | undefined,
  ): Promise<CallOutcome> {
    let attempts = 0;
    let rateLimitRetries = 0;
    let transientRetries = 0;
    for (;;) {
      if (signal?.aborted === true) {
        return { ok: false, failure: { category: 'abort', cause: signal.reason, sent: false }, attempts };
      }
      const attempt = await this.#attemptOnce(request, kind, signal);
      if (attempt.ok) return { ok: true, result: attempt.result, attempts: attempts + 1 };
      if (attempt.failure.sent) attempts += 1;

      const failure = attempt.failure;
      let delay: number | undefined;
      if (failure.category === 'rate_limit') {
        if (rateLimitRetries < this.pacing.maxRateLimitRetries) {
          delay = failure.retryAfterMs ?? backoffMs(rateLimitRetries);
          rateLimitRetries += 1;
        }
      } else if (
        kind === 'text' &&
        (failure.category === 'timeout' ||
          failure.category === 'connection' ||
          failure.category === 'server')
      ) {
        if (transientRetries < this.pacing.maxTransientRetries) {
          delay = failure.retryAfterMs ?? backoffMs(transientRetries);
          transientRetries += 1;
        }
      }
      if (delay === undefined || delay > MAX_RETRY_DELAY_MS) {
        return { ok: false, failure, attempts };
      }
      const completed = await this.#wait(delay, signal);
      if (!completed) {
        return {
          ok: false,
          failure: { category: 'abort', cause: signal?.reason, sent: false },
          attempts,
        };
      }
    }
  }

  /** Waits `ms`. Resolves false when the signal aborts first. */
  #wait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
    if (signal?.aborted === true) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(false);
      };
      const done = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (this.#customSleep !== undefined) {
        this.#customSleep(ms).then(done, done);
      } else {
        timer = setTimeout(done, ms);
      }
    });
  }

  async #attemptOnce(
    request: Jev_Request,
    kind: RequestKind,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; result: RawSystemOneResult } | { ok: false; failure: Failure }> {
    try {
      const result =
        kind === 'image'
          ? await this.#jsonTransport.send(request, {
              timeoutMs: this.pacing.imageTimeoutMs,
              ...(signal ? { signal } : {}),
            })
          : await this.#sdkTransport.send(request, {
              timeoutMs: this.pacing.textTimeoutMs,
              ...(signal ? { signal } : {}),
            });
      return { ok: true, result };
    } catch (error) {
      const failure = classifyError(error);
      // A caller abort wins over any other classification of the same failure.
      if (signal?.aborted === true && failure.category !== 'invalid_image') {
        return { ok: false, failure: { category: 'abort', cause: signal.reason, sent: failure.sent } };
      }
      return { ok: false, failure };
    }
  }

  #toError(kind: RequestKind, stage: Stage, failure: Failure, signal: AbortSignal | undefined): Error {
    if (failure.category === 'auth') return new StageError(stage, failure.cause);
    if (kind === 'image') {
      // Never wrap a JevImageError in a StageError.
      if (failure.cause instanceof JevImageError) return failure.cause;
      const reason = IMAGE_REASON[failure.category];
      return new JevImageError(reason, {
        ...(failure.category === 'rate_limit' ? { status: failure.status ?? 429 } : {}),
        ...(failure.category !== 'rate_limit' && failure.status !== undefined
          ? { status: failure.status }
          : {}),
        ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
      });
    }
    if (failure.category === 'abort') {
      return new StageError(stage, signal?.aborted === true ? signal.reason : failure.cause);
    }
    if (failure.category === 'rate_limit') {
      return new StageError(stage, new RateLimitError(failure.retryAfterMs));
    }
    return new StageError(stage, failure.cause);
  }
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

/**
 * The model requested per provider when `jev.model` comes from the default source.
 * `typesafe` is UNVERIFIED: not tested against the live direct provider (blocked:
 * TYPESAFE_API_KEY not set), so the model form is unconfirmed. Tracked in
 * https://github.com/rfxlamia/ce/issues/25 ("Verify direct typesafe provider").
 * See `docs/journal/v0.0/jev-gateway-verification.md`.
 */
export const PINNED_MODELS = {
  openrouter: 'typesafe/jev-1.14',
  typesafe: 'typesafe/jev-1.14',
} as const satisfies Record<'openrouter' | 'typesafe', string>;

export const BASE_URLS = {
  openrouter: 'https://openrouter.ai/api',
  typesafe: 'https://api.typesafe.ai',
} as const;

const KEY_NAMES = {
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
} as const;

const OPENROUTER_MODEL_FORM = /^~?typesafe\/.+$/;

export interface CreateJevGatewayOptions {
  /**
   * Where Call_Log entries go. Default: a no-op log, so a caller that does not pass one
   * writes no file. The run pipeline passes `createJsonlCallLog(<evidence dir>/jev-calls.jsonl)`.
   */
  callLog?: CallLog;
  /** Test injection for both transports. */
  fetch?: SdkFetch;
}

export type CreateJevGatewayResult =
  | { ok: true; gateway: HybridJevGateway }
  | { ok: false; errors: ValidationError[] };

const NOOP_CALL_LOG: CallLog = { append: () => Promise.resolve() };

/**
 * Builds a HybridJevGateway from a loaded config. Returns the credential failure unchanged when
 * the key is missing (no transport is built, no network call). Decides no Outcome.
 */
export function createJevGateway(
  loaded: LoadedConfig,
  env: Record<string, string | undefined>,
  options: CreateJevGatewayOptions = {},
): CreateJevGatewayResult {
  const credentials = requireJevCredentials(loaded, env);
  if (!credentials.ok) return credentials;

  const provider = loaded.config.jev?.provider ?? ConfigDefaults.jev?.provider ?? 'openrouter';
  const modelSource = loaded.meta.sources['jev.model'] ?? 'default';
  const configuredModel = loaded.config.jev?.model;
  const requestedModel =
    modelSource === 'default' || configuredModel === undefined
      ? PINNED_MODELS[provider]
      : configuredModel;

  if (provider === 'openrouter' && !OPENROUTER_MODEL_FORM.test(requestedModel)) {
    return {
      ok: false,
      errors: [
        {
          path: 'jev.model',
          value: requestedModel,
          expected:
            'a model of the form typesafe/<name> or ~typesafe/<name> (jev-preview is not valid on OpenRouter)',
          source: modelSource,
        },
      ],
    };
  }

  // The credential check passed, so the key is present and non-empty.
  const apiKey = (env[KEY_NAMES[provider]] ?? '').trim();
  const baseURL = BASE_URLS[provider];
  const sdkFetch = options.fetch !== undefined ? { fetch: options.fetch } : {};
  const jsonFetch = options.fetch !== undefined ? { fetch: options.fetch as JsonFetch } : {};
  return {
    ok: true,
    gateway: new HybridJevGateway({
      sdkTransport: createSdkTransport({ baseURL, apiKey, requestedModel, ...sdkFetch }),
      jsonTransport: createJsonTransport({
        baseURL,
        apiKey,
        requestedModel,
        provider,
        ...jsonFetch,
      }),
      callLog: options.callLog ?? NOOP_CALL_LOG,
      provider,
      requestedModel,
    }),
  };
}
