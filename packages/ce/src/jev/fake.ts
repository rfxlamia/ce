/**
 * Fake Jev gateway. Replays recorded answers keyed by `(id@version, stateHash, question name)`.
 *
 * It makes no network call, never calls `fetch`, reads no environment variable and needs no key.
 * A requested question with no matching Recording (including a Recording of another version of
 * the same entry) throws `FakeRecordingMissingError`. It never returns a default answer.
 */
import type { BoxResponse, ChoiceResponse, NoulResponse, ScoreResponse } from '@typesafe-ai/sdk';
import { StageError } from '../errors.js';
import { JevImageError, RateLimitError } from './errors.js';
import { isImageRequest, toAnswerLog } from './gateway.js';
import type { AskOptions, JevGateway, Jev_Response } from './gateway.js';
import { stateHash } from './hash.js';
import type { CallLog, CallLogEntry } from './log.js';
import type { Jev_Request } from './types.js';

export type ScriptedFailure =
  | 'image-multipart-400'
  | 'image-timeout'
  | 'image-rate-limit'
  | 'rate-limit'
  | 'unauthorized';

export interface Recording {
  /** `${id}@${version}`, for example `claim.is_behavior@1`. */
  idVersion: string;
  stateHash: string;
  /** Question name within the request. */
  question: string;
  answer?: NoulResponse | ChoiceResponse | ScoreResponse | BoxResponse;
  scriptedFailure?: ScriptedFailure;
  model?: string;
  usage?: { input_tokens: number | null; output_tokens: number | null };
}

export class FakeRecordingMissingError extends Error {
  readonly idVersion: string;
  readonly question: string;
  readonly stateHash: string;

  constructor(idVersion: string, question: string, stateHash: string) {
    super(
      `No fake recording for ${idVersion}, question "${question}", state hash ${stateHash}`,
    );
    this.name = 'FakeRecordingMissingError';
    this.idVersion = idVersion;
    this.question = question;
    this.stateHash = stateHash;
  }
}

export const FAKE_MODEL_ID = 'typesafe/jev-1.14-fake';

export interface FakeJevGatewayOptions {
  callLog?: CallLog;
}

type Usage = { input_tokens: number | null; output_tokens: number | null };

const DEFAULT_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

function keyOf(idVersion: string, hash: string, question: string): string {
  return JSON.stringify([idVersion, hash, question]);
}

/** Stand-in for the authentication error of an HTTP 401. Carries no secret. */
class FakeAuthenticationError extends Error {
  constructor() {
    super('Jev authentication failed (HTTP 401)');
    this.name = 'AuthenticationError';
  }
}

export class FakeJevGateway implements JevGateway {
  readonly #recordings = new Map<string, Recording>();
  readonly #callLog: CallLog | undefined;

  constructor(recordings: Recording[], options: FakeJevGatewayOptions = {}) {
    for (const recording of recordings) {
      this.#recordings.set(
        keyOf(recording.idVersion, recording.stateHash, recording.question),
        recording,
      );
    }
    this.#callLog = options.callLog;
  }

  async ask(request: Jev_Request, options: AskOptions = {}): Promise<Jev_Response> {
    const signal = options.signal;
    const kind = isImageRequest(request) ? 'image' : 'text';
    // Requirement 1 criteria 10, 11 and 12: an aborted signal wins before any Recording.
    if (signal?.aborted === true) {
      const error = this.#abortError(kind, request.stage, signal);
      await this.#log(request, 'abort', 'error', {}, null, DEFAULT_USAGE, error);
      throw error;
    }

    const hash = stateHash(request.state);
    const names = Object.keys(request.questions);

    const found: Array<{ name: string; recording: Recording }> = [];
    for (const name of names) {
      const built = request.questions[name];
      if (built === undefined) continue;
      const recording = this.#recordings.get(keyOf(built.idVersion, hash, name));
      if (recording === undefined) {
        const missing = new FakeRecordingMissingError(built.idVersion, name, hash);
        await this.#log(request, 'other', 'error', {}, null, DEFAULT_USAGE, missing);
        throw missing;
      }
      found.push({ name, recording });
    }

    for (const { recording } of found) {
      if (recording.scriptedFailure !== undefined) {
        const failure = this.#scriptedError(recording.scriptedFailure, request);
        await this.#log(
          request,
          failure.kind,
          'error',
          {},
          null,
          DEFAULT_USAGE,
          failure.error,
          failure.status,
        );
        throw failure.error;
      }
    }

    const answers: Jev_Response['answers'] = {};
    const logged: CallLogEntry['answers'] = {};
    let model: string | undefined;
    let usage: Usage | undefined;
    for (const { name, recording } of found) {
      const built = request.questions[name];
      if (built === undefined || recording.answer === undefined) {
        const missing = new FakeRecordingMissingError(
          built?.idVersion ?? 'unknown',
          name,
          hash,
        );
        await this.#log(request, 'other', 'error', {}, null, DEFAULT_USAGE, missing);
        throw missing;
      }
      answers[name] = recording.answer;
      const entry = toAnswerLog(built, recording.answer);
      if (entry !== undefined) logged[name] = entry;
      model ??= recording.model;
      usage ??= recording.usage;
    }

    const resolvedModel = model ?? FAKE_MODEL_ID;
    const resolvedUsage: Usage = usage ?? DEFAULT_USAGE;

    // The signal may have aborted during the awaited log writes above (Requirement 1 criterion 11).
    if (signal !== undefined && (signal as AbortSignal).aborted) {
      const error = this.#abortError(kind, request.stage, signal);
      await this.#log(request, 'abort', 'error', {}, null, DEFAULT_USAGE, error);
      throw error;
    }
    await this.#log(request, undefined, 'ok', logged, resolvedModel, resolvedUsage);
    return { model: resolvedModel, answers, usage: resolvedUsage };
  }

  #abortError(kind: 'image' | 'text', stage: Jev_Request['stage'], signal: AbortSignal): Error {
    return kind === 'image'
      ? new JevImageError('timeout')
      : new StageError(stage, signal.reason);
  }

  #scriptedError(
    failure: ScriptedFailure,
    request: Jev_Request,
  ): { error: Error; kind: NonNullable<CallLogEntry['errorKind']>; status?: number } {
    switch (failure) {
      case 'image-multipart-400':
        return {
          error: new JevImageError('bad_request', {
            status: 400,
            message: 'invalid content-type: multipart/form-data',
          }),
          kind: 'bad_request',
          status: 400,
        };
      case 'image-timeout':
        return { error: new JevImageError('timeout'), kind: 'timeout' };
      case 'image-rate-limit':
        return {
          error: new JevImageError('rate_limited', { status: 429 }),
          kind: 'rate_limited',
          status: 429,
        };
      case 'rate-limit':
        return {
          error: new StageError(request.stage, new RateLimitError(undefined)),
          kind: 'rate_limit',
          status: 429,
        };
      case 'unauthorized':
        return {
          error: new StageError(request.stage, new FakeAuthenticationError()),
          kind: 'auth',
          status: 401,
        };
    }
  }

  async #log(
    request: Jev_Request,
    errorKind: CallLogEntry['errorKind'],
    status: 'ok' | 'error',
    answers: CallLogEntry['answers'],
    model: string | null,
    usage: Usage,
    callError?: unknown,
    httpStatus?: number,
  ): Promise<void> {
    if (this.#callLog === undefined) return;
    const entry: CallLogEntry = {
      timestamp: new Date().toISOString(),
      stage: request.stage,
      transport: 'fake',
      provider: 'openrouter',
      requestedModel: FAKE_MODEL_ID,
      model,
      questions: Object.values(request.questions).map((built) => ({
        id: built.id,
        version: built.version,
        type: built.type,
      })),
      answers,
      latencyMs: 0,
      usage,
      stateHash: stateHash(request.state),
      status,
      attempts: 0,
      ...(errorKind !== undefined ? { errorKind } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
    try {
      await this.#callLog.append(entry);
    } catch (writeError) {
      throw new StageError(
        request.stage,
        writeError,
        callError !== undefined ? { callError } : undefined,
      );
    }
  }
}
